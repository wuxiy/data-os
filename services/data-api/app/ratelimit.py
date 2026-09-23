"""进程内滑动窗口限流（G26 verified-queries 面）：按服务代码每分钟 N 次。

不落跨实例计数（与 DorisBreaker 同口径：执行面单实例语义）；超限即 429，
拒答不触达 Doris。多实例部署时按实例数放大阈值即可（配置项声明）。
"""
from __future__ import annotations

import threading
import time
from collections import deque


class SlidingWindowLimiter:
    def __init__(self, limit_per_minute: int) -> None:
        self._limit = max(1, limit_per_minute)
        self._window_seconds = 60.0
        self._lock = threading.Lock()
        self._hits: dict[str, deque[float]] = {}

    def allow(self, key: str, now: float | None = None) -> bool:
        moment = time.monotonic() if now is None else now
        with self._lock:
            hits = self._hits.setdefault(key, deque())
            horizon = moment - self._window_seconds
            while hits and hits[0] <= horizon:
                hits.popleft()
            if len(hits) >= self._limit:
                return False
            hits.append(moment)
            return True
