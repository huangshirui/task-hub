import tempfile
import unittest
from pathlib import Path

from taskhub_runner.handlers import HandlerContext, ShellHandler


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


if __name__ == "__main__":
    unittest.main()
