from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import threading
from typing import Any

from .handlers import HandlerContext, HandlerResult, TaskHandler


class TaskRunner:
    def __init__(
        self,
        client: Any,
        handlers: dict[str, TaskHandler],
        workspace_root: Path,
        runner_id: str = "",
        heartbeat_interval_seconds: float = 20,
    ):
        self._client = client
        self._handlers = handlers
        self._workspace_root = workspace_root
        self._runner_id = runner_id
        self._heartbeat_interval_seconds = heartbeat_interval_seconds

    def run_once(self) -> bool:
        claim = self._client.claim()
        if claim is None:
            return False

        task_id = claim["taskId"]
        lease_id = claim["leaseId"]
        task_type = claim["type"]
        workspace = self._workspace_root / task_id
        workspace.mkdir(parents=True, exist_ok=True)
        handler = self._handlers.get(task_type)

        if handler is None:
            self._client.complete(
                task_id,
                lease_id,
                {"status": "failed", "error": f"no handler registered for task type {task_type}"},
            )
            return True

        heartbeat = LeaseHeartbeat(
            lambda: self._client.heartbeat(task_id, lease_id),
            self._heartbeat_interval_seconds,
        )
        heartbeat.start()
        try:
            result = handler.run(
                claim.get("payload", {}),
                HandlerContext(
                    task_id=task_id,
                    workspace=workspace,
                    timeout_seconds=int(claim.get("timeoutSeconds", 60)),
                    runner_id=self._runner_id,
                    enabled_handlers=sorted(self._handlers.keys()),
                ),
            )
            heartbeat.stop()
            self._upload_process_logs(task_id, lease_id, result)
            self._upload_heartbeat_errors(task_id, lease_id, heartbeat.errors)
            self._client.complete(
                task_id,
                lease_id,
                {
                    "status": result.status,
                    "exitCode": result.exit_code,
                    "result": result.result,
                    "error": result.error,
                },
            )
        except Exception as exc:
            heartbeat.stop()
            self._upload_heartbeat_errors(task_id, lease_id, heartbeat.errors)
            self._client.complete(task_id, lease_id, {"status": "failed", "error": str(exc)})
        finally:
            heartbeat.stop()
        return True

    def _upload_process_logs(self, task_id: str, lease_id: str, result: HandlerResult) -> None:
        entries = []
        timestamp = datetime.now(timezone.utc).isoformat()
        if result.stdout:
            entries.append({"stream": "stdout", "message": result.stdout, "timestamp": timestamp})
        if result.stderr:
            entries.append({"stream": "stderr", "message": result.stderr, "timestamp": timestamp})
        if entries:
            self._client.upload_logs(task_id, lease_id, entries)

    def _upload_heartbeat_errors(self, task_id: str, lease_id: str, errors: list[str]) -> None:
        if not errors:
            return
        timestamp = datetime.now(timezone.utc).isoformat()
        self._client.upload_logs(
            task_id,
            lease_id,
            [{"stream": "system", "message": error, "timestamp": timestamp} for error in errors],
        )


class LeaseHeartbeat:
    def __init__(self, send: Any, interval_seconds: float):
        self._send = send
        self._interval_seconds = interval_seconds
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.errors: list[str] = []

    def start(self) -> None:
        self._thread = threading.Thread(target=self._run, name="taskhub-heartbeat", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None and self._thread is not threading.current_thread():
            self._thread.join(timeout=max(35, self._interval_seconds + 35))
        self._thread = None

    def _run(self) -> None:
        while not self._stop.wait(self._interval_seconds):
            try:
                self._send()
            except Exception as exc:
                self.errors.append(f"task heartbeat failed: {exc}")
