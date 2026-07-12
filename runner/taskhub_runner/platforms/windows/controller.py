from __future__ import annotations

import threading
import traceback
from pathlib import Path
from typing import Any, Callable, Literal

from ...loop import run_runner_loop


RunnerStatus = Literal["stopped", "running", "stopping", "error"]


class RunnerLoopController:
    def __init__(
        self,
        runner: Any,
        wake_listener: Any,
        fallback_poll_interval_seconds: float,
        log_path: Path,
        jitter_ratio: float = 0.1,
    ):
        self._runner = runner
        self._wake_listener = wake_listener
        self._fallback_poll_interval_seconds = fallback_poll_interval_seconds
        self._jitter_ratio = jitter_ratio
        self._log_path = log_path
        self._lock = threading.Lock()
        self._stop_requested = threading.Event()
        self._thread: threading.Thread | None = None
        self._status: RunnerStatus = "stopped"

    @property
    def status(self) -> RunnerStatus:
        with self._lock:
            return self._status

    def start(self) -> bool:
        with self._lock:
            if self._thread is not None and self._thread.is_alive():
                return False
            self._stop_requested.clear()
            self._status = "running"
            self._thread = threading.Thread(target=self._run_loop, name="taskhub-runner", daemon=True)
            self._thread.start()
            return True

    def stop(self, timeout_seconds: float | None = 5) -> None:
        thread = None
        with self._lock:
            if self._status == "running":
                self._status = "stopping"
            self._stop_requested.set()
            self._wake_listener.interrupt()
            thread = self._thread
        if thread is not None:
            thread.join(timeout=timeout_seconds)
        with self._lock:
            if thread is None or not thread.is_alive():
                if self._status != "error":
                    self._status = "stopped"
                self._thread = None

    def wait(self, timeout_seconds: float | None = None) -> None:
        thread = None
        with self._lock:
            thread = self._thread
        if thread is not None:
            thread.join(timeout=timeout_seconds)

    def _run_loop(self) -> None:
        try:
            run_runner_loop(
                self._runner,
                self._wake_listener,
                fallback_poll_interval_seconds=self._fallback_poll_interval_seconds,
                jitter_ratio=self._jitter_ratio,
                stop_requested=self._stop_requested.is_set,
            )
        except Exception:
            self._record_exception()
            with self._lock:
                self._status = "error"
        else:
            with self._lock:
                self._status = "stopped"

    def _record_exception(self) -> None:
        self._log_path.parent.mkdir(parents=True, exist_ok=True)
        with self._log_path.open("a", encoding="utf-8") as handle:
            handle.write(traceback.format_exc())
            handle.write("\n")
