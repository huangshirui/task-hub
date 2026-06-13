from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any
from urllib import request


@dataclass(frozen=True)
class RunnerClient:
    base_url: str
    runner_id: str
    credential: str

    def claim(self) -> dict[str, Any] | None:
        response = self._post(f"/runners/{self.runner_id}/claim", {})
        return response if response else None

    def upload_logs(self, task_id: str, lease_id: str, entries: list[dict[str, Any]]) -> None:
        self._post(
            f"/tasks/{task_id}/logs",
            {"leaseId": lease_id, "runnerId": self.runner_id, "entries": entries},
        )

    def complete(self, task_id: str, lease_id: str, body: dict[str, Any]) -> None:
        payload = {"leaseId": lease_id, "runnerId": self.runner_id, **body}
        self._post(f"/tasks/{task_id}/complete", payload)

    def _post(self, path: str, body: dict[str, Any]) -> dict[str, Any] | None:
        payload = json.dumps(body).encode("utf-8")
        req = request.Request(
            f"{self.base_url.rstrip('/')}{path}",
            data=payload,
            method="POST",
            headers={
                "authorization": f"Bearer {self.credential}",
                "content-type": "application/json",
            },
        )
        with request.urlopen(req, timeout=30) as response:
            data = response.read()
            return json.loads(data.decode("utf-8")) if data else None
