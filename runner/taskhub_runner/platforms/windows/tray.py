from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib import error, request

from ...cli import build_runner
from ...config import load_runner_config
from ...handler_installer import describe_config_handlers, install_handler
from .controller import RunnerLoopController
from .setup import default_app_dir, default_config_path, default_env_path, setup_user_runner


def main(argv: list[str] | None = None) -> int:
    argv = list(argv) if argv is not None else sys.argv[1:]
    if argv and argv[0] == "setup":
        return setup_command(argv[1:])
    if argv and argv[0] == "install-handler":
        return install_handler_command(argv[1:])

    parser = argparse.ArgumentParser(description="Run Task Hub as a Windows tray app.")
    parser.add_argument("--config", help="Path to the Windows runner JSON config.")
    parser.add_argument("--log-path", help="Path to the tray runner log file.")
    args = parser.parse_args(argv)

    config_path = Path(args.config) if args.config else default_config_path()
    config = load_runner_config(config_path)
    log_path = Path(args.log_path) if args.log_path else default_log_path()
    controller = RunnerLoopController(
        runner=build_runner(config_path),
        poll_interval_seconds=config.poll_interval_seconds,
        log_path=log_path,
    )

    return run_tray(controller, log_path)


def setup_command(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Set up the current Windows user's Task Hub runner.")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--runner-id", required=True)
    parser.add_argument("--runner-token")
    parser.add_argument("--registration-token")
    parser.add_argument("--no-register", action="store_true")
    parser.add_argument("--app-dir")
    args = parser.parse_args(argv)

    runner_token = args.runner_token or os.environ.get("TASK_HUB_RUNNER_TOKEN")
    if not runner_token:
        raise SystemExit("runner token is required; set TASK_HUB_RUNNER_TOKEN or pass --runner-token")

    app_dir = Path(args.app_dir) if args.app_dir else default_app_dir()
    config_path = setup_user_runner(
        app_dir=app_dir,
        base_url=args.base_url,
        runner_id=args.runner_id,
        runner_token=runner_token,
    )

    if not args.no_register:
        registration_token = args.registration_token or os.environ.get("TASK_HUB_REGISTRATION_TOKEN")
        if not registration_token:
            raise SystemExit("registration token is required; set TASK_HUB_REGISTRATION_TOKEN or pass --registration-token")
        register_current_config(config_path, runner_token, registration_token)

    print(f"Config: {config_path}")
    return 0


def install_handler_command(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description="Install a handler for the current Windows user's runner.")
    parser.add_argument("handler")
    parser.add_argument("--registration-token")
    parser.add_argument("--no-register", action="store_true")
    parser.add_argument("--app-dir")
    args = parser.parse_args(argv)

    app_dir = Path(args.app_dir) if args.app_dir else default_app_dir()
    config_path = default_config_path(app_dir)
    install_handler(
        args.handler,
        catalog_dir=runner_root() / "handlers",
        install_dir=app_dir / "installed-handlers",
        config_path=config_path,
        platform="windows",
    )

    if not args.no_register:
        registration_token = args.registration_token or os.environ.get("TASK_HUB_REGISTRATION_TOKEN")
        runner_token = _read_env_file(default_env_path(app_dir)).get("TASK_HUB_RUNNER_TOKEN")
        if not registration_token:
            raise SystemExit("registration token is required; set TASK_HUB_REGISTRATION_TOKEN or pass --registration-token")
        if not runner_token:
            raise SystemExit("runner token is required in runner.env")
        register_current_config(config_path, runner_token, registration_token)

    print(f"Handler {args.handler} installed.")
    return 0


def register_current_config(config_path: Path, runner_token: str, registration_token: str) -> None:
    config = json.loads(config_path.read_text(encoding="utf-8"))
    handler_info = describe_config_handlers(config_path)
    payload = {
        "runnerId": config["runnerId"],
        "credential": runner_token,
        "platform": "windows",
        "labels": ["windows-user"],
        "taskTypes": handler_info.task_types,
        "capabilities": handler_info.capabilities,
    }
    body = json.dumps(payload).encode("utf-8")
    req = request.Request(
        f"{config['baseUrl'].rstrip('/')}/runners/register",
        data=body,
        method="POST",
        headers={
            "authorization": f"Bearer {registration_token}",
            "content-type": "application/json",
        },
    )
    try:
        with request.urlopen(req, timeout=30) as response:
            response.read()
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"runner registration failed: HTTP {exc.code} {details}") from exc


def default_log_path() -> Path:
    return default_app_dir() / "logs" / "windows-runner.log"


def runner_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _read_env_file(path: Path) -> dict[str, str]:
    values = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key] = value
    return values


def run_tray(controller: RunnerLoopController, log_path: Path) -> int:
    try:
        import pystray
        from PIL import Image, ImageDraw
    except ImportError as exc:
        raise SystemExit("Windows tray dependencies are missing. Install runner/platforms/windows/requirements.txt.") from exc

    def start_runner(icon, item):
        controller.start()
        icon.update_menu()

    def stop_runner(icon, item):
        controller.stop()
        icon.update_menu()

    def open_logs(icon, item):
        log_path.parent.mkdir(parents=True, exist_ok=True)
        os.startfile(str(log_path.parent))

    def exit_app(icon, item):
        controller.stop()
        icon.stop()

    def status_text(item):
        return f"Status: {controller.status}"

    image = _build_icon_image(Image, ImageDraw)
    menu = pystray.Menu(
        pystray.MenuItem(status_text, None, enabled=False),
        pystray.MenuItem("Start", start_runner, enabled=lambda item: controller.status in ("stopped", "error")),
        pystray.MenuItem("Stop", stop_runner, enabled=lambda item: controller.status == "running"),
        pystray.MenuItem("Open Logs", open_logs),
        pystray.MenuItem("Exit", exit_app),
    )
    icon = pystray.Icon("taskhub-runner", image, "Task Hub Runner", menu)
    controller.start()
    icon.run()
    return 0


def _build_icon_image(image_module, image_draw_module):
    image = image_module.new("RGB", (64, 64), color=(36, 44, 52))
    draw = image_draw_module.Draw(image)
    draw.rounded_rectangle((10, 10, 54, 54), radius=8, fill=(46, 134, 171))
    draw.rectangle((20, 20, 44, 28), fill=(246, 247, 249))
    draw.rectangle((20, 36, 44, 44), fill=(246, 247, 249))
    return image


if __name__ == "__main__":
    sys.exit(main())
