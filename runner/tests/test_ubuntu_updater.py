import json
import os
import shutil
import stat
import subprocess
import tempfile
import unittest
from contextlib import contextmanager
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
UPDATER = ROOT / "runner" / "platforms" / "ubuntu_server" / "update.sh"
BASH = shutil.which("bash") or next(
    (path for path in (r"C:\Program Files\Git\bin\bash.exe", r"C:\Program Files\Git\usr\bin\bash.exe") if Path(path).exists()),
    None,
)


@contextmanager
def bash_temporary_directory():
    path = Path(tempfile.mkdtemp(prefix="taskhub-updater-"))
    try:
        yield str(path)
    finally:
        shutil.rmtree(path, ignore_errors=True)


def write_executable(path: Path, content: str) -> None:
    path.write_text(content, encoding="utf-8", newline="\n")
    path.chmod(path.stat().st_mode | stat.S_IXUSR)


class UbuntuUpdaterTest(unittest.TestCase):
    def setUp(self):
        if BASH is None:
            self.skipTest("bash is required for Ubuntu updater integration tests")

    def run_updater(self, *args: str, env=None):
        return subprocess.run(
            [BASH, str(UPDATER), *args],
            cwd=ROOT,
            env=env,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=30,
        )

    def test_requires_exactly_one_version_selector(self):
        missing = self.run_updater("--dry-run")
        both = self.run_updater("--version", "v2.0.0", "--ref", "deadbeef", "--dry-run")

        self.assertNotEqual(missing.returncode, 0)
        self.assertIn("exactly one of --version or --ref", missing.stderr)
        self.assertNotEqual(both.returncode, 0)
        self.assertIn("exactly one of --version or --ref", both.stderr)

    def test_dry_run_discovers_accounts_without_mutating_services_or_checkout(self):
        with bash_temporary_directory() as tmp:
            fixture = self.make_fixture(Path(tmp))
            before = self.git(fixture["repo"], "rev-parse", "HEAD")

            result = self.run_updater(
                "--version", "v2.0.0", "--install-dir", str(fixture["repo"]), "--dry-run", env=fixture["env"]
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Accounts: alice bob", result.stdout)
            self.assertEqual(self.git(fixture["repo"], "rev-parse", "HEAD"), before)
            service_calls = fixture["systemctl_log"].read_text(encoding="utf-8").splitlines()
            self.assertTrue(all(call.startswith("is-enabled ") for call in service_calls))
            self.assertFalse(fixture["apt_log"].exists())

    def test_upgrade_preserves_config_and_custom_handler_and_refreshes_managed_handlers(self):
        with bash_temporary_directory() as tmp:
            fixture = self.make_fixture(Path(tmp))
            configs_before = {
                account: (fixture["config_root"] / account / "runner.json").read_bytes()
                for account in ("alice", "bob")
            }
            env_before = (fixture["config_root"] / "alice" / "runner.env").read_bytes()

            result = self.run_updater(
                "--version", "v2.0.0", "--install-dir", str(fixture["repo"]), env=fixture["env"]
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Runner version:", result.stdout)
            self.assertIn("Shared handlers: 2", result.stdout)
            self.assertEqual(self.git(fixture["repo"], "describe", "--tags", "--exact-match"), "v2.0.0")
            self.assertEqual(
                (fixture["data_root"] / "alice" / "installed-handlers" / "builtin_shell" / "VERSION").read_text(), "v2"
            )
            self.assertEqual((fixture["custom_handler"] / "VERSION").read_text(), "custom")
            for account, content in configs_before.items():
                self.assertEqual((fixture["config_root"] / account / "runner.json").read_bytes(), content)
            self.assertEqual((fixture["config_root"] / "alice" / "runner.env").read_bytes(), env_before)
            calls = fixture["systemctl_log"].read_text(encoding="utf-8")
            self.assertIn("stop taskhub-runner@alice", calls)
            self.assertIn("start taskhub-runner@alice", calls)
            self.assertNotIn("enable taskhub-runner@bob", calls)
            self.assertNotIn("start taskhub-runner@bob", calls)
            self.assertNotIn("registration-secret", result.stdout + result.stderr)

    def test_relative_custom_handler_is_resolved_from_account_config_directory(self):
        with bash_temporary_directory() as tmp:
            fixture = self.make_fixture(Path(tmp))
            bob_config_path = fixture["config_root"] / "bob" / "runner.json"
            bob_config = json.loads(bob_config_path.read_text(encoding="utf-8"))
            relative_handler = bob_config_path.parent / "custom-relative"
            self.write_handler(relative_handler, "custom-relative")
            bob_config["handlerPaths"].append("custom-relative")
            bob_config_path.write_text(json.dumps(bob_config), encoding="utf-8")

            result = self.run_updater(
                "--version", "v2.0.0", "--install-dir", str(fixture["repo"]), env=fixture["env"]
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((relative_handler / "VERSION").read_text(), "custom-relative")

    def test_custom_handler_inside_account_handler_directory_is_not_overwritten(self):
        with bash_temporary_directory() as tmp:
            fixture = self.make_fixture(Path(tmp))
            alice_config_path = fixture["config_root"] / "alice" / "runner.json"
            alice_config = json.loads(alice_config_path.read_text(encoding="utf-8"))
            custom_managed_path = fixture["data_root"] / "alice" / "installed-handlers" / "custom_private"
            self.write_handler(custom_managed_path, "private-v1")
            alice_config["handlerPaths"].append(str(custom_managed_path))
            alice_config_path.write_text(json.dumps(alice_config), encoding="utf-8")

            result = self.run_updater(
                "--version", "v2.0.0", "--install-dir", str(fixture["repo"]), env=fixture["env"]
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((custom_managed_path / "VERSION").read_text(), "private-v1")

    def test_fresh_accounts_with_only_shared_selfcheck_can_upgrade(self):
        with bash_temporary_directory() as tmp:
            fixture = self.make_fixture(Path(tmp))
            for account in ("alice", "bob"):
                config_path = fixture["config_root"] / account / "runner.json"
                config = json.loads(config_path.read_text(encoding="utf-8"))
                config["handlerPaths"] = [str(fixture["repo"] / "runner" / "handlers" / "builtin_selfcheck")]
                config_path.write_text(json.dumps(config), encoding="utf-8")
                shutil.rmtree(fixture["data_root"] / account / "installed-handlers")

            result = self.run_updater(
                "--version", "v2.0.0", "--install-dir", str(fixture["repo"]), env=fixture["env"]
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("Managed handlers: 0", result.stdout)
            self.assertIn("Shared handlers: 2", result.stdout)

    def test_upgrade_fetches_version_tag_from_origin(self):
        with bash_temporary_directory() as tmp:
            fixture = self.make_fixture(Path(tmp), remote_only_target=True)

            result = self.run_updater(
                "--version", "v2.0.0", "--install-dir", str(fixture["repo"]), env=fixture["env"]
            )

            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(self.git(fixture["repo"], "describe", "--tags", "--exact-match"), "v2.0.0")

    def test_rejects_invalid_version_dirty_checkout_and_missing_configs(self):
        with bash_temporary_directory() as tmp:
            fixture = self.make_fixture(Path(tmp))
            invalid = self.run_updater(
                "--version", "v9.9.9", "--install-dir", str(fixture["repo"]), "--dry-run", env=fixture["env"]
            )
            self.assertNotEqual(invalid.returncode, 0)
            self.assertIn("version tag not found", invalid.stderr)

            (fixture["repo"] / "dirty.txt").write_text("dirty", encoding="utf-8")
            dirty = self.run_updater(
                "--version", "v2.0.0", "--install-dir", str(fixture["repo"]), "--dry-run", env=fixture["env"]
            )
            self.assertNotEqual(dirty.returncode, 0)
            self.assertIn("uncommitted changes", dirty.stderr)
            (fixture["repo"] / "dirty.txt").unlink()

            shutil.rmtree(fixture["config_root"])
            missing = self.run_updater(
                "--version", "v2.0.0", "--install-dir", str(fixture["repo"]), "--dry-run", env=fixture["env"]
            )
            self.assertNotEqual(missing.returncode, 0)
            self.assertIn("runner config root not found", missing.stderr)

    def test_damaged_target_handler_is_rejected_before_services_stop(self):
        with bash_temporary_directory() as tmp:
            fixture = self.make_fixture(Path(tmp), damaged_target_manifest=True)

            result = self.run_updater(
                "--version", "v2.0.0", "--install-dir", str(fixture["repo"]), env=fixture["env"]
            )

            self.assertNotEqual(result.returncode, 0)
            calls = fixture["systemctl_log"].read_text(encoding="utf-8")
            self.assertNotIn("stop ", calls)

    def test_dependency_failure_rolls_back_checkout_handlers_and_services(self):
        with bash_temporary_directory() as tmp:
            fixture = self.make_fixture(Path(tmp), fail_dependencies=True)
            old_sha = self.git(fixture["repo"], "rev-parse", "HEAD")

            result = self.run_updater(
                "--version", "v2.0.0", "--install-dir", str(fixture["repo"]), env=fixture["env"]
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Rollback: successful", result.stdout + result.stderr)
            self.assertEqual(self.git(fixture["repo"], "rev-parse", "HEAD"), old_sha)
            self.assertEqual(
                (fixture["data_root"] / "alice" / "installed-handlers" / "builtin_shell" / "VERSION").read_text(),
                "v1",
            )
            self.assertIn("start taskhub-runner@alice", fixture["systemctl_log"].read_text(encoding="utf-8"))

    def test_second_service_health_failure_rolls_back_git_handlers_and_original_service_state(self):
        with bash_temporary_directory() as tmp:
            fixture = self.make_fixture(Path(tmp), fail_account="bob", enabled_accounts=("alice", "bob"))
            old_sha = self.git(fixture["repo"], "rev-parse", "HEAD")

            result = self.run_updater(
                "--ref", fixture["target_sha"], "--install-dir", str(fixture["repo"]), env=fixture["env"]
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Rollback: successful", result.stdout + result.stderr)
            self.assertEqual(self.git(fixture["repo"], "rev-parse", "HEAD"), old_sha)
            self.assertEqual(
                (fixture["data_root"] / "alice" / "installed-handlers" / "builtin_shell" / "VERSION").read_text(), "v1"
            )
            calls = fixture["systemctl_log"].read_text(encoding="utf-8")
            self.assertGreaterEqual(calls.count("start taskhub-runner@alice"), 2)
            self.assertGreaterEqual(calls.count("start taskhub-runner@bob"), 2)

    def test_stop_failure_restores_services_that_were_already_stopped(self):
        with bash_temporary_directory() as tmp:
            fixture = self.make_fixture(
                Path(tmp), fail_stop_account="bob", enabled_accounts=("alice", "bob")
            )

            result = self.run_updater(
                "--version", "v2.0.0", "--install-dir", str(fixture["repo"]), env=fixture["env"]
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Rollback: successful", result.stdout + result.stderr)
            calls = fixture["systemctl_log"].read_text(encoding="utf-8")
            self.assertIn("start taskhub-runner@alice", calls)
            self.assertIn("start taskhub-runner@bob", calls)

    def make_fixture(
        self,
        root: Path,
        fail_account: str = "",
        fail_stop_account: str = "",
        enabled_accounts=("alice",),
        remote_only_target: bool = False,
        damaged_target_manifest: bool = False,
        fail_dependencies: bool = False,
    ):
        repo = root / "repo"
        repo.mkdir()
        self.git(repo, "init")
        self.git(repo, "config", "user.email", "test@example.com")
        self.git(repo, "config", "user.name", "Task Hub Test")
        self.write_repo_version(repo, "v1")
        self.git(repo, "add", ".")
        self.git(repo, "commit", "-m", "v1")
        old_sha = self.git(repo, "rev-parse", "HEAD")
        self.write_repo_version(repo, "v2")
        if damaged_target_manifest:
            (repo / "runner" / "handlers" / "builtin_shell" / "handler.json").write_text(
                json.dumps({"name": "builtin-shell", "version": "v2"}), encoding="utf-8"
            )
        self.git(repo, "add", ".")
        self.git(repo, "commit", "-m", "v2")
        self.git(repo, "tag", "v2.0.0")
        target_sha = self.git(repo, "rev-parse", "HEAD")
        remote = root / "origin.git"
        subprocess.run(["git", "clone", "--bare", str(repo), str(remote)], check=True, capture_output=True)
        self.git(repo, "remote", "add", "origin", str(remote))
        self.git(repo, "checkout", "--detach", old_sha)
        if remote_only_target:
            self.git(repo, "tag", "-d", "v2.0.0")

        config_root = root / "etc" / "runners"
        data_root = root / "data" / "runners"
        custom_handler = root / "custom-handler"
        self.write_handler(custom_handler, "custom")
        for account in ("alice", "bob"):
            account_config = config_root / account
            account_config.mkdir(parents=True)
            account_data = data_root / account / "installed-handlers" / "builtin_shell"
            self.write_handler(account_data, "v1")
            paths = [str(repo / "runner" / "handlers" / "builtin_selfcheck"), str(account_data)]
            if account == "alice":
                paths.append(str(custom_handler))
            (account_config / "runner.json").write_text(json.dumps({
                "baseUrl": "https://example.invalid",
                "runnerId": f"runner_{account}",
                "credentialEnv": "TASK_HUB_RUNNER_TOKEN",
                "workspaceRoot": str(data_root / account / "workspaces"),
                "handlerPaths": paths,
            }), encoding="utf-8")
            (account_config / "runner.env").write_text(
                "TASK_HUB_RUNNER_TOKEN=registration-secret\n", encoding="utf-8"
            )

        fake_bin = root / "bin"
        fake_bin.mkdir()
        systemctl_log = root / "systemctl.log"
        apt_log = root / "apt.log"
        write_executable(fake_bin / "id", "#!/usr/bin/env bash\n[[ \"${1:-}\" == '-u' ]] && echo 0\n")
        write_executable(
            fake_bin / "apt-get",
            "#!/usr/bin/env bash\n"
            "echo \"$*\" >>\"$TEST_APT_LOG\"\n"
            "[[ \"${TEST_FAIL_DEPENDENCIES:-0}\" != '1' ]]\n",
        )
        write_executable(fake_bin / "chown", "#!/usr/bin/env bash\nexit 0\n")
        write_executable(fake_bin / "systemctl", '''#!/usr/bin/env bash
set -e
echo "$*" >>"$TEST_SYSTEMCTL_LOG"
cmd="${1:-}"; service="${2:-}"
case "$cmd" in
  is-enabled) [[ " $TEST_ENABLED_ACCOUNTS " == *" ${service#taskhub-runner@} "* ]] ;;
  stop)
    [[ "$service" != "taskhub-runner@$TEST_FAIL_STOP_ACCOUNT" ]]
    ;;
  is-active)
    if [[ "$service" == "taskhub-runner@$TEST_FAIL_ACCOUNT" && ! -f "$TEST_FAIL_MARKER" ]]; then
      touch "$TEST_FAIL_MARKER"
      exit 1
    fi
    [[ "$service" == "taskhub-runner@alice" ]]
    ;;
  *) exit 0 ;;
esac
''')
        env = os.environ.copy()
        bash_path = subprocess.run(
            [BASH, "-lc", 'printf "%s" "$PATH"'], text=True, encoding="utf-8", errors="replace",
            capture_output=True, check=True
        ).stdout
        fake_bin_posix = subprocess.run(
            [BASH, "-lc", 'cygpath -u "$1"', "bash", str(fake_bin)],
            text=True, encoding="utf-8", errors="replace", capture_output=True, check=True,
        ).stdout.strip()
        env.update({
            "PATH": fake_bin_posix + ":" + bash_path,
            "TASK_HUB_CONFIG_ROOT": str(config_root),
            "TASK_HUB_DATA_ROOT": str(data_root),
            "TEST_SYSTEMCTL_LOG": str(systemctl_log),
            "TEST_APT_LOG": str(apt_log),
            "TEST_FAIL_DEPENDENCIES": "1" if fail_dependencies else "0",
            "TEST_FAIL_ACCOUNT": fail_account,
            "TEST_FAIL_STOP_ACCOUNT": fail_stop_account,
            "TEST_ENABLED_ACCOUNTS": " ".join(enabled_accounts),
            "TEST_FAIL_MARKER": str(root / "fail.marker"),
            # Git Bash sandboxing recognizes the Windows temp root but not a /c/ alias for the workspace.
            "TASK_HUB_TMPDIR": os.environ.get("TEMP", str(root / "tmp")) if os.name == "nt" else str(root / "tmp"),
            "TASK_HUB_ID_BIN": str(fake_bin / "id"),
            "TASK_HUB_SYSTEMCTL_BIN": str(fake_bin / "systemctl"),
            "TASK_HUB_APT_GET_BIN": str(fake_bin / "apt-get"),
            "TASK_HUB_CHOWN_BIN": str(fake_bin / "chown"),
        })
        return locals()

    def write_repo_version(self, repo: Path, version: str):
        handler = repo / "runner" / "handlers" / "builtin_shell"
        self.write_handler(handler, version)
        self.write_handler(repo / "runner" / "handlers" / "builtin_selfcheck", version)
        package = repo / "runner" / "taskhub_runner"
        package.mkdir(parents=True, exist_ok=True)
        if package.exists():
            shutil.rmtree(package)
        shutil.copytree(ROOT / "runner" / "taskhub_runner", package)

    @staticmethod
    def write_handler(path: Path, version: str):
        path.mkdir(parents=True, exist_ok=True)
        (path / "VERSION").write_text(version, encoding="utf-8")
        (path / "handler.json").write_text(json.dumps({
            "name": path.name,
            "version": version,
            "taskTypes": ["shell"],
            "platforms": ["linux"],
            "capabilities": ["shell"],
            "entrypoint": "taskhub_runner.handlers:ShellHandler",
            "timeoutMaxSeconds": 60,
        }), encoding="utf-8")

    @staticmethod
    def git(repo: Path, *args: str) -> str:
        result = subprocess.run(["git", "-C", str(repo), *args], text=True, capture_output=True, check=True)
        return result.stdout.strip()


if __name__ == "__main__":
    unittest.main()
