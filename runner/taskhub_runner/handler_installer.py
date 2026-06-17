from __future__ import annotations

import argparse
import json
import shutil
import sys
from dataclasses import dataclass
from pathlib import Path

from .manifest import load_manifest

INSTALLABLE_HANDLERS = {
    "shell": "builtin_shell",
}


@dataclass(frozen=True)
class InstalledHandler:
    name: str
    path: Path
    task_types: list[str]
    capabilities: list[str]


def install_handler(handler_name: str, *, catalog_dir: Path, install_dir: Path, config_path: Path, platform: str) -> InstalledHandler:
    catalog_name = INSTALLABLE_HANDLERS.get(handler_name)
    if catalog_name is None:
        raise ValueError(f"handler {handler_name!r} is not installable")

    source = catalog_dir / catalog_name
    if not source.exists():
        raise ValueError(f"handler catalog entry not found at {source}")

    manifest = load_manifest(source / "handler.json")
    if platform not in manifest.platforms:
        raise ValueError(f"handler {handler_name!r} does not support platform {platform}")

    destination = install_dir / catalog_name
    if destination.exists():
        shutil.rmtree(destination)
    install_dir.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination)

    installed_manifest = load_manifest(destination / "handler.json")
    _add_handler_path(config_path, destination.resolve())

    return InstalledHandler(
        name=handler_name,
        path=destination.resolve(),
        task_types=installed_manifest.task_types,
        capabilities=installed_manifest.capabilities,
    )


def describe_config_handlers(config_path: Path) -> InstalledHandler:
    config = _load_config(config_path)
    task_types: list[str] = []
    capabilities: list[str] = []

    for raw_path in config.get("handlerPaths", []):
        handler_path = Path(raw_path)
        if not handler_path.is_absolute():
            handler_path = config_path.parent / handler_path
        manifest = load_manifest(handler_path / "handler.json")
        task_types.extend(manifest.task_types)
        capabilities.extend(manifest.capabilities)

    return InstalledHandler(
        name="config",
        path=config_path,
        task_types=_dedupe(task_types),
        capabilities=_dedupe(capabilities),
    )


def _add_handler_path(config_path: Path, handler_path: Path) -> None:
    config = _load_config(config_path)
    existing = config.get("handlerPaths", [])
    if not isinstance(existing, list) or not all(isinstance(item, str) for item in existing):
        raise ValueError("handlerPaths must be a string list")

    normalized = str(handler_path)
    config["handlerPaths"] = _dedupe([*existing, normalized])
    config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")


def _load_config(config_path: Path) -> dict:
    try:
        raw = json.loads(config_path.read_text(encoding="utf-8"))
    except FileNotFoundError as exc:
        raise ValueError(f"runner config not found at {config_path}") from exc
    if not isinstance(raw, dict):
        raise ValueError("runner config must be a JSON object")
    return raw


def _dedupe(values: list[str]) -> list[str]:
    seen = set()
    result = []
    for value in values:
        if value not in seen:
            seen.add(value)
            result.append(value)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Install Task Hub runner handlers.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    install_parser = subparsers.add_parser("install")
    install_parser.add_argument("handler")
    install_parser.add_argument("--catalog-dir", required=True)
    install_parser.add_argument("--install-dir", required=True)
    install_parser.add_argument("--config", required=True)
    install_parser.add_argument("--platform", default="linux")

    describe_parser = subparsers.add_parser("describe-config")
    describe_parser.add_argument("--config", required=True)

    args = parser.parse_args(argv)

    if args.command == "install":
        installed = install_handler(
            args.handler,
            catalog_dir=Path(args.catalog_dir),
            install_dir=Path(args.install_dir),
            config_path=Path(args.config),
            platform=args.platform,
        )
    else:
        installed = describe_config_handlers(Path(args.config))

    print(json.dumps({"taskTypes": installed.task_types, "capabilities": installed.capabilities}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
