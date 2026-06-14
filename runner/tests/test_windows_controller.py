import tempfile
import time
import unittest
from pathlib import Path

from taskhub_runner.platforms.windows.controller import RunnerLoopController


class FakeRunner:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = 0

    def run_once(self):
        self.calls += 1
        if self.outcomes:
            outcome = self.outcomes.pop(0)
            if isinstance(outcome, Exception):
                raise outcome
            return outcome
        return False


class WindowsRunnerLoopControllerTest(unittest.TestCase):
    def test_start_only_starts_one_background_loop_and_stop_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            runner = FakeRunner([False, False])
            controller = RunnerLoopController(
                runner=runner,
                poll_interval_seconds=0.01,
                log_path=Path(tmp) / "runner.log",
            )

            self.assertTrue(controller.start())
            self.assertFalse(controller.start())
            time.sleep(0.05)

            controller.stop(timeout_seconds=1)
            controller.stop(timeout_seconds=1)

            self.assertEqual(controller.status, "stopped")
            self.assertGreaterEqual(runner.calls, 1)

    def test_background_error_is_recorded_and_status_becomes_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "runner.log"
            controller = RunnerLoopController(
                runner=FakeRunner([RuntimeError("boom")]),
                poll_interval_seconds=0.01,
                log_path=log_path,
            )

            controller.start()
            controller.wait(timeout_seconds=1)

            self.assertEqual(controller.status, "error")
            self.assertIn("boom", log_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
