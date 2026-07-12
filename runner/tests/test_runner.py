import tempfile
import threading
import time
import unittest
from pathlib import Path

from taskhub_runner.core import TaskRunner
from taskhub_runner.handlers import HandlerContext, HandlerResult, TaskHandler


class FakeHandler(TaskHandler):
    task_type = "shell"

    def run(self, payload: dict, context: HandlerContext) -> HandlerResult:
        context.workspace.joinpath("result.txt").write_text(payload["message"])
        return HandlerResult(status="succeeded", exit_code=0, result={"file": "result.txt"})


class FakeClient:
    def __init__(self):
        self.completed = []
        self.logs = []
        self.claimed = False
        self.heartbeats = []
        self.heartbeat_seen = threading.Event()

    def claim(self):
        if self.claimed:
            return None
        self.claimed = True
        return {
            "taskId": "task_1",
            "leaseId": "lease_1",
            "type": "shell",
            "payload": {"message": "done"},
            "timeoutSeconds": 10,
        }

    def upload_logs(self, task_id, lease_id, entries):
        self.logs.append((task_id, lease_id, entries))

    def heartbeat(self, task_id, lease_id):
        self.heartbeats.append((task_id, lease_id))
        self.heartbeat_seen.set()

    def complete(self, task_id, lease_id, body):
        self.completed.append((task_id, lease_id, body))


class TaskRunnerTest(unittest.TestCase):
    def test_runner_claims_executes_and_completes_task(self):
        client = FakeClient()
        with tempfile.TemporaryDirectory() as tmp:
            runner = TaskRunner(client=client, handlers={"shell": FakeHandler()}, workspace_root=Path(tmp))

            executed = runner.run_once()

            self.assertTrue(executed)
            self.assertEqual(len(client.completed), 1)
            task_id, lease_id, body = client.completed[0]
            self.assertEqual(task_id, "task_1")
            self.assertEqual(lease_id, "lease_1")
            self.assertEqual(body["status"], "succeeded")
            self.assertEqual(body["result"], {"file": "result.txt"})

    def test_runner_renews_the_lease_while_a_handler_is_running(self):
        client = FakeClient()

        class BlockingHandler(TaskHandler):
            task_type = "shell"

            def run(self, payload, context):
                self.assert_heartbeat = client.heartbeat_seen.wait(timeout=1)
                return HandlerResult(status="succeeded", exit_code=0)

        handler = BlockingHandler()
        with tempfile.TemporaryDirectory() as tmp:
            runner = TaskRunner(
                client=client,
                handlers={"shell": handler},
                workspace_root=Path(tmp),
                heartbeat_interval_seconds=0.01,
            )

            self.assertTrue(runner.run_once())
            heartbeat_count_at_complete = len(client.heartbeats)
            time.sleep(0.03)

        self.assertTrue(handler.assert_heartbeat)
        self.assertGreaterEqual(heartbeat_count_at_complete, 1)
        self.assertEqual(len(client.heartbeats), heartbeat_count_at_complete)
        self.assertEqual(client.heartbeats[0], ("task_1", "lease_1"))


if __name__ == "__main__":
    unittest.main()
