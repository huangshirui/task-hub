from __future__ import annotations

import importlib
import json
from pathlib import Path

from .handlers import ShellHandler, TaskHandler
from .manifest import HandlerManifest, load_manifest


def load_handlers(handler_paths: list[Path], script_registry_path: Path | None) -> dict[str, TaskHandler]:
    scripts = _load_script_registry(script_registry_path)
    handlers: dict[str, TaskHandler] = {}

    for handler_path in handler_paths:
        manifest = load_manifest(handler_path / "handler.json")
        handler = _instantiate_handler(manifest, scripts)
        for task_type in manifest.task_types:
            handlers[task_type] = handler

    return handlers


def _load_script_registry(script_registry_path: Path | None) -> dict[str, dict]:
    if script_registry_path is None:
        return {}
    try:
        raw = json.loads(script_registry_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"script registry not found at {script_registry_path}") from exc
    if not isinstance(raw, dict):
        raise ValueError("script registry must be a JSON object")
    return raw


def _instantiate_handler(manifest: HandlerManifest, scripts: dict[str, dict]) -> TaskHandler:
    module_name, separator, class_name = manifest.entrypoint.partition(":")
    if not separator:
        raise ValueError(f"invalid handler entrypoint {manifest.entrypoint!r}")

    module = importlib.import_module(module_name)
    handler_class = getattr(module, class_name)
    if handler_class is ShellHandler:
        return handler_class(scripts)
    return handler_class()
