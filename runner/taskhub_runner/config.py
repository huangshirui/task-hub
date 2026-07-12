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
    fallback_poll_interval_seconds: float = 600.0
    heartbeat_interval_seconds: float = 20.0
    fallback_jitter_ratio: float = 0.1
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

    fallback_poll_interval_seconds = _positive_number(raw, "fallbackPollIntervalSeconds", 600)
    heartbeat_interval_seconds = _positive_number(raw, "heartbeatIntervalSeconds", 20)
    fallback_jitter_ratio = float(raw.get("fallbackJitterRatio", 0.1))
    if not 0 <= fallback_jitter_ratio <= 1:
        raise ValueError("fallbackJitterRatio must be between 0 and 1")

    return RunnerConfig(
        base_url=_required_string(raw, "baseUrl"),
        runner_id=_required_string(raw, "runnerId"),
        credential=_load_credential(raw),
        workspace_root=workspace_root,
        fallback_poll_interval_seconds=fallback_poll_interval_seconds,
        heartbeat_interval_seconds=heartbeat_interval_seconds,
        fallback_jitter_ratio=fallback_jitter_ratio,
        handler_paths=handler_paths,
        script_registry_path=resolved_script_registry_path,
    )


def _required_string(raw: dict, key: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{key} is required")
    return value


def _positive_number(raw: dict, key: str, default: float) -> float:
    value = float(raw.get(key, default))
    if value <= 0:
        raise ValueError(f"{key} must be greater than 0")
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
