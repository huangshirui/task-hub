from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path


@dataclass(frozen=True)
class RunnerConfig:
    base_url: str
    runner_id: str
    credential: str
    workspace_root: Path
    poll_interval_seconds: float = 5.0
    handler_paths: list[Path] = field(default_factory=list)
    script_registry_path: Path | None = None


def load_runner_config(path: Path) -> RunnerConfig:
    raw = json.loads(path.read_text(encoding="utf-8"))
    if "scripts" in raw:
        raise ValueError("scripts must be configured via scriptRegistryPath")

    base_dir = path.parent
    workspace_root = Path(raw.get("workspaceRoot", "runner-workspaces"))
    if not workspace_root.is_absolute():
        workspace_root = base_dir / workspace_root

    handler_paths = []
    for handler_path in raw.get("handlerPaths", []):
        resolved = Path(handler_path)
        if not resolved.is_absolute():
            resolved = base_dir / resolved
        handler_paths.append(resolved.resolve())

    script_registry_path = raw.get("scriptRegistryPath")
    resolved_script_registry_path = None
    if script_registry_path:
        resolved_script_registry_path = Path(script_registry_path)
        if not resolved_script_registry_path.is_absolute():
            resolved_script_registry_path = base_dir / resolved_script_registry_path
        resolved_script_registry_path = resolved_script_registry_path.resolve()

    return RunnerConfig(
        base_url=_required_string(raw, "baseUrl"),
        runner_id=_required_string(raw, "runnerId"),
        credential=_load_credential(raw),
        workspace_root=workspace_root,
        poll_interval_seconds=float(raw.get("pollIntervalSeconds", 5)),
        handler_paths=handler_paths,
        script_registry_path=resolved_script_registry_path,
    )


def _required_string(raw: dict, key: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{key} is required")
    return value


def _load_credential(raw: dict) -> str:
    credential = raw.get("credential")
    if isinstance(credential, str) and credential:
        return credential

    credential_env = raw.get("credentialEnv")
    if isinstance(credential_env, str) and credential_env:
        value = os.environ.get(credential_env)
        if not value:
            raise ValueError(f"environment variable {credential_env} is required")
        return value

    raise ValueError("credential or credentialEnv is required")
