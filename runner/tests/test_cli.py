import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from taskhub_runner.cli import build_runner, main


class FakeClient:
    def __init__(self, base_url, runner_id, credential):
        self.base_url = base_url
        self.runner_id = runner_id
        self.credential = credential
        self.claims = 0
        self.completed = []

    def claim(self):
        self.claims += 1
        return None

    def upload_logs(self, task_id, lease_id, entries):
        raise AssertionError("no logs expected")

    def complete(self, task_id, lease_id, body):
        self.completed.append((task_id, lease_id, body))


class CliTest(unittest.TestCase):
    def test_build_runner_wires_client_handlers_and_workspace(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "runner.json"
            plugin_dir = Path(tmp) / "builtin_shell"
            plugin_dir.mkdir()
            plugin_dir.joinpath("handler.json").write_text(
                """
                {
                  "name": "builtin-shell",
                  "version": "1.0.0",
                  "taskTypes": ["shell"],
                  "platforms": ["linux", "windows"],
                  "capabilities": ["shell.registered_scripts"],
                  "entrypoint": "taskhub_runner.handlers:ShellHandler",
                  "timeoutMaxSeconds": 60
                }
                """,
                encoding="utf-8",
            )
            Path(tmp, "scripts.json").write_text(
                """
                {
                  "noop": { "command": ["python", "-c", "print('noop')"] }
                }
                """,
                encoding="utf-8",
            )
            config_path.write_text(
                """
                {
                  "baseUrl": "https://task-hub.example.workers.dev",
                  "runnerId": "runner_local",
                  "credential": "secret",
                  "workspaceRoot": "workspaces",
                  "pollIntervalSeconds": 1,
                  "handlerPaths": ["builtin_shell"],
                  "scriptRegistryPath": "scripts.json"
                }
                """,
                encoding="utf-8",
            )

            runner = build_runner(config_path, client_factory=FakeClient)

            self.assertFalse(runner.run_once())

    def test_main_once_exits_zero_after_single_poll(self):
        with tempfile.TemporaryDirectory() as tmp:
            config_path = Path(tmp) / "runner.json"
            config_path.write_text(
                """
                {
                  "baseUrl": "https://task-hub.example.workers.dev",
                  "runnerId": "runner_local",
                  "credentialEnv": "TASK_HUB_RUNNER_TOKEN",
                  "workspaceRoot": "workspaces",
                  "handlerPaths": []
                }
                """,
                encoding="utf-8",
            )

            with patch.dict("os.environ", {"TASK_HUB_RUNNER_TOKEN": "secret"}):
                exit_code = main(["--config", str(config_path), "--once"], client_factory=FakeClient)

            self.assertEqual(exit_code, 0)


if __name__ == "__main__":
    unittest.main()
