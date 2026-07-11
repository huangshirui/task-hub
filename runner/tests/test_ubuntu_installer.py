import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
INSTALLER = ROOT / "runner" / "platforms" / "ubuntu_server" / "install.sh"
HANDLER_INSTALLER = ROOT / "runner" / "platforms" / "ubuntu_server" / "install-handler.sh"
README = ROOT / "runner" / "platforms" / "ubuntu_server" / "README.md"


class UbuntuInstallerTest(unittest.TestCase):
    def test_installer_registers_runner_with_registration_token(self):
        content = INSTALLER.read_text(encoding="utf-8")

        self.assertIn("TASK_HUB_REGISTRATION_TOKEN", content)
        self.assertIn("/runners/register", content)
        self.assertIn('"platform": "linux"', content)
        self.assertIn('"labels": ["ubuntu-server"]', content)
        self.assertIn('"taskTypes": ["selfcheck"]', content)
        self.assertIn('"capabilities": ["runner.selfcheck"]', content)
        self.assertIn('handlerPaths": [str(install_dir / "runner" / "handlers" / "builtin_selfcheck")]', content)

    def test_installer_supports_manual_registration_fallback(self):
        content = INSTALLER.read_text(encoding="utf-8")

        self.assertIn("--no-register", content)
        self.assertIn("NO_REGISTER", content)
        self.assertIn('[[ "$NO_REGISTER" -eq 0 || -n "$RUNNER_ID" ]]', content)

    def test_installer_persists_worker_generated_runner_id(self):
        content = INSTALLER.read_text(encoding="utf-8")

        self.assertNotIn('[[ -n "$RUNNER_ID" ]] || die "--runner-id is required"', content)
        self.assertIn('RUNNER_ID="$(python3 - "$BASE_URL"', content)
        self.assertIn('registered_runner_id = result.get("runnerId")', content)
        self.assertIn('print(registered_runner_id)', content)

    def test_installer_uses_account_scoped_paths_and_template_service(self):
        content = INSTALLER.read_text(encoding="utf-8")

        self.assertIn('ACCOUNT="taskhub"', content)
        self.assertIn("--account", content)
        self.assertIn('CONFIG_DIR="/etc/task-hub/runners/$ACCOUNT"', content)
        self.assertIn('CONFIG_PATH="$CONFIG_DIR/runner.json"', content)
        self.assertIn('ENV_PATH="/etc/task-hub/runners/$ACCOUNT/runner.env"', content)
        self.assertIn('/var/lib/task-hub/runners/$ACCOUNT/workspaces', content)
        self.assertIn('/var/lib/task-hub/runners/$ACCOUNT/installed-handlers', content)
        self.assertIn('taskhub-runner@.service', content)
        self.assertIn('$SERVICE_NAME@$ACCOUNT', content)
        self.assertIn("User=%i", content)

    def test_readme_documents_registration_token_not_runner_token_for_one_line_install(self):
        content = README.read_text(encoding="utf-8")
        one_line_section = content.split("## Install from source", 1)[0]
        default_install_section = one_line_section.split("To skip cloud registration", 1)[0]

        self.assertIn("TASK_HUB_REGISTRATION_TOKEN", one_line_section)
        self.assertNotIn("TASK_HUB_RUNNER_TOKEN='replace-with-runner-secret'", default_install_section)

    def test_ubuntu_handler_installer_installs_shell_handler(self):
        content = HANDLER_INSTALLER.read_text(encoding="utf-8")

        self.assertIn("install_handler", content)
        self.assertIn('ACCOUNT="taskhub"', content)
        self.assertIn("--account", content)
        self.assertIn("TASK_HUB_REGISTRATION_TOKEN", content)
        self.assertIn("/runners/register", content)
        self.assertIn('/etc/task-hub/runners/$ACCOUNT/runner.json', content)
        self.assertIn('/var/lib/task-hub/runners/$ACCOUNT/installed-handlers', content)
        self.assertIn('systemctl restart "taskhub-runner@$ACCOUNT"', content)
        self.assertIn("--no-register", content)


if __name__ == "__main__":
    unittest.main()
