from __future__ import annotations

import json
import os
from pathlib import Path


def default_app_dir() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA", Path.home()))
    return base / "TaskHubRunner"


def default_config_path(app_dir: Path | None = None) -> Path:
    return (app_dir or default_app_dir()) / "runner.json"


def default_env_path(app_dir: Path | None = None) -> Path:
    return (app_dir or default_app_dir()) / "runner.env"


def setup_user_runner(*, app_dir: Path, base_url: str, runner_id: str, runner_token: str) -> Path:
    app_dir.mkdir(parents=True, exist_ok=True)
    workspace_root = app_dir / "workspaces"
    installed_handlers = app_dir / "installed-handlers"
    logs = app_dir / "logs"
    workspace_root.mkdir(parents=True, exist_ok=True)
    installed_handlers.mkdir(parents=True, exist_ok=True)
    logs.mkdir(parents=True, exist_ok=True)

    scripts_path = app_dir / "scripts.json"
    if not scripts_path.exists():
        scripts_path.write_text("{}\n", encoding="utf-8")

    config_path = app_dir / "runner.json"
    config = {
        "baseUrl": base_url,
        "runnerId": runner_id,
        "credentialEnv": "TASK_HUB_RUNNER_TOKEN",
        "workspaceRoot": str(workspace_root),
        "fallbackPollIntervalSeconds": 600,
        "fallbackJitterRatio": 0.1,
        "heartbeatIntervalSeconds": 20,
        "handlerPaths": [str(_runner_root() / "handlers" / "builtin_selfcheck")],
        "scriptRegistryPath": str(scripts_path),
    }
    config_path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
    (app_dir / "runner.env").write_text(f"TASK_HUB_RUNNER_TOKEN={runner_token}\n", encoding="utf-8")
    return config_path


def _runner_root() -> Path:
    return Path(__file__).resolve().parents[3]
