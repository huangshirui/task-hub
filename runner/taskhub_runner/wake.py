from __future__ import annotations

import json
import random
import threading
from typing import Any, Callable
from urllib.parse import quote, urlsplit, urlunsplit


def websocket_url(base_url: str, runner_id: str) -> str:
    parsed = urlsplit(base_url.rstrip("/"))
    scheme = "wss" if parsed.scheme == "https" else "ws"
    path = f"{parsed.path.rstrip('/')}/runners/{quote(runner_id, safe='')}/events"
    return urlunsplit((scheme, parsed.netloc, path, "", ""))


def jittered_interval(seconds: float, ratio: float, random_value: Callable[[], float] = random.random) -> float:
    return seconds * (1 - ratio + (2 * ratio * random_value()))


class WakeListener:
    def __init__(
        self,
        *,
        base_url: str,
        runner_id: str,
        credential: str,
        app_factory: Callable[..., Any] | None = None,
    ):
        self._url = websocket_url(base_url, runner_id)
        self._credential = credential
        self._app_factory = app_factory or _default_app_factory
        self._wake = threading.Event()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self._active_app: Any | None = None
        self._lock = threading.Lock()

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(target=self._run, name="taskhub-wake", daemon=True)
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._wake.set()
        with self._lock:
            app = self._active_app
        if app is not None:
            try:
                app.close()
            except Exception:
                pass
        if self._thread is not None and self._thread is not threading.current_thread():
            self._thread.join(timeout=5)
        self._thread = None

    def interrupt(self) -> None:
        self._wake.set()

    def wait(self, timeout: float) -> bool:
        signaled = self._wake.wait(timeout=max(0, timeout))
        if signaled:
            self._wake.clear()
        return signaled

    def handle_message(self, message: str) -> None:
        try:
            event = json.loads(message)
        except (TypeError, json.JSONDecodeError):
            return
        if isinstance(event, dict) and event.get("type") == "task_available" and isinstance(event.get("taskId"), str):
            self._wake.set()

    def _run(self) -> None:
        attempt = 0
        while not self._stop.is_set():
            connected = threading.Event()
            app = self._app_factory(
                self._url,
                header=[f"Authorization: Bearer {self._credential}"],
                on_open=lambda _app: connected.set(),
                on_message=lambda _app, message: self.handle_message(message),
            )
            with self._lock:
                self._active_app = app
            try:
                app.run_forever(ping_interval=30, ping_timeout=10)
            except Exception:
                pass
            finally:
                with self._lock:
                    if self._active_app is app:
                        self._active_app = None
            if self._stop.is_set():
                break
            attempt = 0 if connected.is_set() else min(attempt + 1, 6)
            delays = (1, 2, 5, 10, 30, 60, 60)
            self._stop.wait(jittered_interval(delays[attempt], 0.1))


def _default_app_factory(url: str, **kwargs: Any) -> Any:
    try:
        import websocket
    except ImportError as exc:
        raise RuntimeError("websocket-client is required for Runner wake notifications") from exc
    return websocket.WebSocketApp(url, **kwargs)
