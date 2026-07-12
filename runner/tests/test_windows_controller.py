import tempfile
import threading
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


class FakeWake:
    def __init__(self):
        self.started = False
        self.stopped = False
        self.waits = []
        self._interrupted = threading.Event()

    def start(self):
        self.started = True

    def stop(self):
        self.stopped = True
        self._interrupted.set()

    def interrupt(self):
        self._interrupted.set()

    def wait(self, timeout):
        self.waits.append(timeout)
        self._interrupted.wait(timeout=timeout)
        return False


class WindowsRunnerLoopControllerTest(unittest.TestCase):
    def test_start_only_starts_one_background_loop_and_stop_is_idempotent(self):
        with tempfile.TemporaryDirectory() as tmp:
            runner = FakeRunner([False, False])
            wake = FakeWake()
            controller = RunnerLoopController(
                runner=runner,
                wake_listener=wake,
                fallback_poll_interval_seconds=0.01,
                log_path=Path(tmp) / "runner.log",
            )

            self.assertTrue(controller.start())
            self.assertFalse(controller.start())
            time.sleep(0.05)

            controller.stop(timeout_seconds=1)
            controller.stop(timeout_seconds=1)

            self.assertEqual(controller.status, "stopped")
            self.assertGreaterEqual(runner.calls, 1)
            self.assertTrue(wake.started)
            self.assertTrue(wake.stopped)

    def test_stop_interrupts_a_long_fallback_wait(self):
        with tempfile.TemporaryDirectory() as tmp:
            wake = FakeWake()
            controller = RunnerLoopController(
                runner=FakeRunner([False]),
                wake_listener=wake,
                fallback_poll_interval_seconds=600,
                log_path=Path(tmp) / "runner.log",
            )
            controller.start()
            time.sleep(0.02)

            controller.stop(timeout_seconds=1)

            self.assertEqual(controller.status, "stopped")
            self.assertTrue(wake.stopped)

    def test_background_error_is_recorded_and_status_becomes_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            log_path = Path(tmp) / "runner.log"
            controller = RunnerLoopController(
                runner=FakeRunner([RuntimeError("boom")]),
                wake_listener=FakeWake(),
                fallback_poll_interval_seconds=0.01,
                log_path=log_path,
            )

            controller.start()
            controller.wait(timeout_seconds=1)

            self.assertEqual(controller.status, "error")
            self.assertIn("boom", log_path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
