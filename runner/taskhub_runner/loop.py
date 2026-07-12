from __future__ import annotations

import random
from typing import Any, Callable

from .wake import jittered_interval


def run_runner_loop(
    runner: Any,
    wake_listener: Any,
    *,
    fallback_poll_interval_seconds: float,
    jitter_ratio: float,
    stop_requested: Callable[[], bool],
    random_value: Callable[[], float] = random.random,
) -> None:
    wake_listener.start()
    try:
        while not stop_requested():
            did_work = runner.run_once()
            if not did_work:
                wake_listener.wait(jittered_interval(fallback_poll_interval_seconds, jitter_ratio, random_value))
    finally:
        wake_listener.stop()
