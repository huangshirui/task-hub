import os
import unittest
from pathlib import Path
from unittest.mock import patch

from taskhub_runner.config import load_runner_config


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


if __name__ == "__main__":
    unittest.main()
