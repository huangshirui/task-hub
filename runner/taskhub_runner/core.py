from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .handlers import HandlerContext, HandlerResult, TaskHandler


class TaskRunner:
    def __init__(self, client: Any, handlers: dict[str, TaskHandler], workspace_root: Path):
        self._client = client
        self._handlers = handlers
        self._workspace_root = workspace_root

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

        try:
            result = handler.run(
                claim.get("payload", {}),
                HandlerContext(
                    task_id=task_id,
                    workspace=workspace,
                    timeout_seconds=int(claim.get("timeoutSeconds", 60)),
                ),
            )
            self._upload_process_logs(task_id, lease_id, result)
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
            self._client.complete(task_id, lease_id, {"status": "failed", "error": str(exc)})
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
