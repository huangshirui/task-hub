from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Protocol


@dataclass(frozen=True)
class HandlerContext:
    task_id: str
    workspace: Path
    timeout_seconds: int


@dataclass(frozen=True)
class HandlerResult:
    status: str
    exit_code: int | None = None
    result: dict = field(default_factory=dict)
    error: str | None = None
    stdout: str = ""
    stderr: str = ""


class TaskHandler(Protocol):
    task_type: str

    def run(self, payload: dict, context: HandlerContext) -> HandlerResult:
        raise NotImplementedError


class ShellHandler:
    task_type = "shell"

    def __init__(self, scripts: dict[str, dict]):
        self._scripts = scripts

    def run(self, payload: dict, context: HandlerContext) -> HandlerResult:
        script_id = payload.get("scriptId")
        if not isinstance(script_id, str) or script_id not in self._scripts:
            raise ValueError(f"shell script {script_id!r} is not registered")

        command = self._scripts[script_id].get("command")
        if not isinstance(command, list) or not all(isinstance(part, str) for part in command):
            raise ValueError(f"shell script {script_id!r} has an invalid command")

        context.workspace.mkdir(parents=True, exist_ok=True)
        completed = subprocess.run(
            command,
            cwd=context.workspace,
            capture_output=True,
            text=True,
            timeout=context.timeout_seconds,
            check=False,
        )
        status = "succeeded" if completed.returncode == 0 else "failed"
        return HandlerResult(
            status=status,
            exit_code=completed.returncode,
            result={"scriptId": script_id},
            stdout=completed.stdout,
            stderr=completed.stderr,
            error=None if completed.returncode == 0 else f"script exited with {completed.returncode}",
        )
