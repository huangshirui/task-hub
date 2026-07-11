import os
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from taskhub_runner.config import load_runner_config
from taskhub_runner.platforms.windows.setup import default_app_dir, default_config_path, setup_user_runner
from taskhub_runner.platforms.windows.tray import setup_command


ROOT = Path(__file__).resolve().parents[2]


class PlatformLayoutTest(unittest.TestCase):
    def test_windows_example_config_resolves_platform_local_paths(self):
        config_path = ROOT / "runner" / "platforms" / "windows" / "config" / "runner.example.json"

        with patch.dict(os.environ, {"TASK_HUB_RUNNER_TOKEN": "secret"}):
            config = load_runner_config(config_path)

        self.assertEqual(config.runner_id, "runner_windows_dev")
        self.assertEqual(
            config.script_registry_path,
            ROOT / "runner" / "platforms" / "windows" / "config" / "scripts.example.json",
        )
        self.assertEqual(
            config.handler_paths,
            [ROOT / "runner" / "handlers" / "builtin_shell"],
        )

    def test_windows_pyinstaller_spec_references_tray_entrypoint(self):
        spec_path = ROOT / "runner" / "platforms" / "windows" / "packaging" / "taskhub-windows-runner.spec"

        content = spec_path.read_text(encoding="utf-8")

        self.assertIn("tray_app.py", content)
        self.assertIn("taskhub-windows-runner", content)

    def test_windows_default_config_path_uses_current_user_localappdata(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.dict(os.environ, {"LOCALAPPDATA": tmp}):
                app_dir = default_app_dir()

            self.assertEqual(app_dir, Path(tmp) / "TaskHubRunner")
            self.assertEqual(default_config_path(app_dir), Path(tmp) / "TaskHubRunner" / "runner.json")

    def test_windows_setup_writes_per_user_runner_files(self):
        with tempfile.TemporaryDirectory() as tmp:
            app_dir = Path(tmp) / "TaskHubRunner"

            config_path = setup_user_runner(
                app_dir=app_dir,
                base_url="https://task-hub.example.workers.dev",
                runner_id="runner_alice",
                runner_token="runner-secret",
            )

            config = json.loads(config_path.read_text(encoding="utf-8"))
            env_content = (app_dir / "runner.env").read_text(encoding="utf-8")
            self.assertEqual(config_path, app_dir / "runner.json")
            self.assertEqual(config["runnerId"], "runner_alice")
            self.assertEqual(config["workspaceRoot"], str(app_dir / "workspaces"))
            self.assertEqual(config["handlerPaths"], [str(ROOT / "runner" / "handlers" / "builtin_selfcheck")])
            self.assertEqual(config["scriptRegistryPath"], str(app_dir / "scripts.json"))
            self.assertTrue((app_dir / "installed-handlers").is_dir())
            self.assertTrue((app_dir / "logs").is_dir())
            self.assertIn("TASK_HUB_RUNNER_TOKEN=runner-secret", env_content)

    def test_windows_setup_persists_worker_generated_runner_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            app_dir = Path(tmp) / "TaskHubRunner"
            with patch.dict(
                os.environ,
                {
                    "TASK_HUB_RUNNER_TOKEN": "runner-secret",
                    "TASK_HUB_REGISTRATION_TOKEN": "registration-secret",
                },
            ), patch(
                "taskhub_runner.platforms.windows.tray.register_runner",
                return_value="runner_generated_01",
            ):
                result = setup_command(
                    [
                        "--base-url",
                        "https://task-hub.example.workers.dev",
                        "--app-dir",
                        str(app_dir),
                    ]
                )

            config = json.loads((app_dir / "runner.json").read_text(encoding="utf-8"))
            self.assertEqual(result, 0)
            self.assertEqual(config["runnerId"], "runner_generated_01")


if __name__ == "__main__":
    unittest.main()
