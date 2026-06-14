from __future__ import annotations

import threading
import time
import traceback
from pathlib import Path
from typing import Any, Callable, Literal


RunnerStatus = Literal["stopped", "running", "stopping", "error"]


class RunnerLoopController:
    def __init__(
        self,
        runner: Any,
        poll_interval_seconds: float,
        log_path: Path,
        sleeper: Callable[[float], None] = time.sleep,
    ):
        self._runner = runner
        self._poll_interval_seconds = poll_interval_seconds
        self._log_path = log_path
        self._sleeper = sleeper
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
            while not self._stop_requested.is_set():
                did_work = self._runner.run_once()
                if not did_work:
                    self._sleeper(self._poll_interval_seconds)
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
