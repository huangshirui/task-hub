import tempfile
import unittest
from pathlib import Path

from taskhub_runner.handlers import HandlerContext, SelfCheckHandler, ShellHandler


class ShellHandlerTest(unittest.TestCase):
    def test_shell_handler_only_runs_registered_scripts(self):
        with tempfile.TemporaryDirectory() as tmp:
            marker = Path(tmp) / "marker.txt"
            handler = ShellHandler(
                {
                    "write-marker": {
                        "command": [
                            "python",
                            "-c",
                            f"from pathlib import Path; Path({str(marker)!r}).write_text('ok')",
                        ],
                    }
                }
            )

            result = handler.run(
                {"scriptId": "write-marker"},
                HandlerContext(task_id="task_1", workspace=Path(tmp), timeout_seconds=10),
            )

            self.assertEqual(result.status, "succeeded")
            self.assertEqual(marker.read_text(), "ok")

            with self.assertRaisesRegex(ValueError, "not registered"):
                handler.run(
                    {"scriptId": "missing"},
                    HandlerContext(task_id="task_2", workspace=Path(tmp), timeout_seconds=10),
                )


class SelfCheckHandlerTest(unittest.TestCase):
    def test_selfcheck_returns_runner_environment(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = SelfCheckHandler().run(
                {},
                HandlerContext(
                    task_id="task_selfcheck",
                    workspace=Path(tmp),
                    timeout_seconds=10,
                    runner_id="runner_ubuntu_01",
                    enabled_handlers=["selfcheck"],
                ),
            )

            self.assertEqual(result.status, "succeeded")
            self.assertEqual(result.exit_code, 0)
            self.assertEqual(result.result["runnerId"], "runner_ubuntu_01")
            self.assertEqual(result.result["taskId"], "task_selfcheck")
            self.assertEqual(result.result["workspace"], str(Path(tmp)))
            self.assertEqual(result.result["enabledHandlers"], ["selfcheck"])
            self.assertIn("runnerVersion", result.result)
            self.assertIn("platform", result.result)
            self.assertIn("pythonVersion", result.result)
            self.assertIn("currentUser", result.result)
            self.assertIn("cwd", result.result)


if __name__ == "__main__":
    unittest.main()
