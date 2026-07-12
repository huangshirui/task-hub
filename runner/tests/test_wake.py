import json
import unittest

from taskhub_runner.wake import WakeListener, jittered_interval, websocket_url


class WakeListenerTest(unittest.TestCase):
    def test_builds_secure_runner_events_url(self):
        self.assertEqual(
            websocket_url("https://task-hub.example.workers.dev/", "runner-a"),
            "wss://task-hub.example.workers.dev/runners/runner-a/events",
        )

    def test_task_available_message_releases_waiter(self):
        listener = WakeListener(
            base_url="https://task-hub.example.workers.dev",
            runner_id="runner-a",
            credential="secret",
        )

        listener.handle_message(json.dumps({"type": "task_available", "taskId": "task-1"}))

        self.assertTrue(listener.wait(0))
        self.assertFalse(listener.wait(0))

    def test_jitter_is_bounded_around_the_fallback_interval(self):
        self.assertEqual(jittered_interval(600, 0.1, lambda: 0.0), 540)
        self.assertEqual(jittered_interval(600, 0.1, lambda: 0.5), 600)
        self.assertEqual(jittered_interval(600, 0.1, lambda: 1.0), 660)


if __name__ == "__main__":
    unittest.main()
