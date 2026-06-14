from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from ...cli import build_runner
from ...config import load_runner_config
from .controller import RunnerLoopController


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run Task Hub as a Windows tray app.")
    parser.add_argument("--config", required=True, help="Path to the Windows runner JSON config.")
    parser.add_argument("--log-path", help="Path to the tray runner log file.")
    args = parser.parse_args(argv)

    config_path = Path(args.config)
    config = load_runner_config(config_path)
    log_path = Path(args.log_path) if args.log_path else default_log_path()
    controller = RunnerLoopController(
        runner=build_runner(config_path),
        poll_interval_seconds=config.poll_interval_seconds,
        log_path=log_path,
    )

    return run_tray(controller, log_path)


def default_log_path() -> Path:
    base = Path(os.environ.get("LOCALAPPDATA", Path.home()))
    return base / "TaskHubRunner" / "logs" / "windows-runner.log"


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
