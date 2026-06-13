from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class HandlerManifest:
    name: str
    version: str
    task_types: list[str]
    platforms: list[str]
    capabilities: list[str]
    entrypoint: str
    timeout_max_seconds: int


def load_manifest(path: Path) -> HandlerManifest:
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
        return HandlerManifest(
            name=_required_string(raw, "name"),
            version=_required_string(raw, "version"),
            task_types=_required_string_list(raw, "taskTypes"),
            platforms=_required_string_list(raw, "platforms"),
            capabilities=_required_string_list(raw, "capabilities"),
            entrypoint=_required_string(raw, "entrypoint"),
            timeout_max_seconds=int(raw["timeoutMaxSeconds"]),
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise ValueError(f"invalid handler manifest at {path}: {exc}") from exc


def _required_string(raw: dict, key: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"{key} is required")
    return value


def _required_string_list(raw: dict, key: str) -> list[str]:
    value = raw.get(key)
    if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
        raise ValueError(f"{key} must be a string list")
    return value
