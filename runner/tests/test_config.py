import tempfile
import unittest
from unittest.mock import patch
from pathlib import Path

from taskhub_runner.config import load_runner_config


class RunnerConfigTest(unittest.TestCase):
    def test_load_runner_config_normalizes_paths_and_credential_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "runner.json"
            workspace = Path(tmp) / "workspaces"
            handlers = Path(tmp) / "handlers"
            scripts = Path(tmp) / "scripts.json"
            config_path.write_text(
                """
                {
                  "baseUrl": "https://task-hub.example.workers.dev",
                  "runnerId": "runner_local",
                  "credentialEnv": "TASK_HUB_RUNNER_TOKEN",
                  "workspaceRoot": "workspaces",
                  "fallbackPollIntervalSeconds": 600,
                  "heartbeatIntervalSeconds": 20,
                  "handlerPaths": ["handlers"],
                  "scriptRegistryPath": "scripts.json"
                }
                """,
                encoding="utf-8",
            )

            with patch.dict("os.environ", {"TASK_HUB_RUNNER_TOKEN": "secret"}):
                config = load_runner_config(config_path)

            self.assertEqual(config.base_url, "https://task-hub.example.workers.dev")
            self.assertEqual(config.runner_id, "runner_local")
            self.assertEqual(config.credential, "secret")
            self.assertEqual(config.workspace_root, workspace)
            self.assertEqual(config.fallback_poll_interval_seconds, 600)
            self.assertEqual(config.heartbeat_interval_seconds, 20)
            self.assertEqual(config.handler_paths, [handlers])
            self.assertEqual(config.script_registry_path, scripts)

    def test_load_runner_config_rejects_inline_scripts(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "runner.json"
            config_path.write_text(
                """
                {
                  "baseUrl": "https://task-hub.example.workers.dev",
                  "runnerId": "runner_local",
                  "credential": "secret",
                  "scripts": {
                    "backup": { "command": ["python", "-c", "print('backup')"] }
                  }
                }
                """,
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "scripts must be configured via scriptRegistryPath"):
                load_runner_config(config_path)

    def test_load_runner_config_requires_credential_or_credential_env(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "runner.json"
            config_path.write_text(
                """
                {
                  "baseUrl": "https://task-hub.example.workers.dev",
                  "runnerId": "runner_local"
                }
                """,
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "credential or credentialEnv is required"):
                load_runner_config(config_path)

    def test_load_runner_config_rejects_invalid_timing_values(self):
        invalid_values = (
            ('"fallbackPollIntervalSeconds": 0', "fallbackPollIntervalSeconds must be greater than 0"),
            ('"heartbeatIntervalSeconds": -1', "heartbeatIntervalSeconds must be greater than 0"),
            ('"fallbackJitterRatio": 1.1', "fallbackJitterRatio must be between 0 and 1"),
        )
        for field, message in invalid_values:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as tmp:
                config_path = Path(tmp) / "runner.json"
                config_path.write_text(
                    f'''{{
                      "baseUrl": "https://task-hub.example.workers.dev",
                      "runnerId": "runner_local",
                      "credential": "secret",
                      {field}
                    }}''',
                    encoding="utf-8",
                )

                with self.assertRaisesRegex(ValueError, message):
                    load_runner_config(config_path)


if __name__ == "__main__":
    unittest.main()
