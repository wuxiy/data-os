"""Doris 熔断器（P8，H3）：连续失败保护。

CLOSED（正常）→ 连续 N 次执行失败 → OPEN（拒绝，立即 503）
→ 冷却 T 秒 → HALF_OPEN（放行一次试探）→ 成功回 CLOSED / 失败回 OPEN。
query 与 export 共用同一实例；阈值内单次失败不影响（瞬时抖动容忍）。
"""
from __future__ import annotations

import threading
import time


class DorisBreaker:
    def __init__(self, failure_threshold: int = 5, open_seconds: float = 30.0):
        self._failure_threshold = max(failure_threshold, 1)
        self._open_seconds = max(open_seconds, 0.0)
        self._consecutive_failures = 0
        self._opened_at = 0.0
        self._half_open_probe = False
        self._lock = threading.Lock()

    def allow(self) -> bool:
        """是否放行一次执行；OPEN 到期后放行单次试探（HALF_OPEN）。"""
        with self._lock:
            if self._consecutive_failures < self._failure_threshold:
                return True
            if time.monotonic() - self._opened_at >= self._open_seconds:
                if not self._half_open_probe:
                    self._half_open_probe = True
                    return True  # 半开试探
                return False  # 试探已在途
            return False

    def record_success(self) -> None:
        with self._lock:
            self._consecutive_failures = 0
            self._half_open_probe = False

    def record_failure(self) -> None:
        with self._lock:
            self._consecutive_failures += 1
            if self._consecutive_failures >= self._failure_threshold:
                self._opened_at = time.monotonic()
                self._half_open_probe = False

    @property
    def state(self) -> str:
        with self._lock:
            if self._consecutive_failures < self._failure_threshold:
                return "CLOSED"
            if time.monotonic() - self._opened_at >= self._open_seconds:
                return "HALF_OPEN" if self._half_open_probe else "OPEN-ELAPSED"
            return "OPEN"
