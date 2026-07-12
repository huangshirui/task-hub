from __future__ import annotations

import argparse
import signal
import sys
from pathlib import Path
from typing import Callable

from .client import RunnerClient
from .config import RunnerConfig, load_runner_config
from .core import TaskRunner
from .loop import run_runner_loop
from .plugin_loader import load_handlers
from .wake import WakeListener

ClientFactory = Callable[[str, str, str], object]


def build_runner(config_path: Path, client_factory: ClientFactory = RunnerClient) -> TaskRunner:
    config = load_runner_config(config_path)
    client = client_factory(config.base_url, config.runner_id, config.credential)
    handlers = build_handlers(config)
    return TaskRunner(
        client=client,
        handlers=handlers,
        workspace_root=config.workspace_root,
        runner_id=config.runner_id,
        heartbeat_interval_seconds=config.heartbeat_interval_seconds,
    )


def build_wake_listener(config: RunnerConfig) -> WakeListener:
    return WakeListener(base_url=config.base_url, runner_id=config.runner_id, credential=config.credential)


def build_handlers(config: RunnerConfig):
    return load_handlers(config.handler_paths, config.script_registry_path)


def main(argv: list[str] | None = None, client_factory: ClientFactory = RunnerClient) -> int:
    parser = argparse.ArgumentParser(description="Run a Task Hub runner.")
    parser.add_argument("--config", required=True, help="Path to runner JSON config.")
    parser.add_argument("--once", action="store_true", help="Poll once and exit.")
    args = parser.parse_args(argv)

    config_path = Path(args.config)
    config = load_runner_config(config_path)
    runner = build_runner(config_path, client_factory=client_factory)
    wake_listener = build_wake_listener(config)
    stop_requested = False

    def request_stop(signum, frame):
        nonlocal stop_requested
        stop_requested = True
        wake_listener.interrupt()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    if args.once:
        runner.run_once()
        return 0

    run_runner_loop(
        runner,
        wake_listener,
        fallback_poll_interval_seconds=config.fallback_poll_interval_seconds,
        jitter_ratio=config.fallback_jitter_ratio,
        stop_requested=lambda: stop_requested,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
