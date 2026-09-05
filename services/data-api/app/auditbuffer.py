"""审计回写持久缓冲（P8，H3）：控制面不可达期间的审计 JSONL 落盘。

- 每条含 Idempotency-Key：崩溃窗口（POST 成功但未及改写文件）重放时
  由控制面 idempotency_key 去重，不产生重复审计；
- 超龄（默认 72h）丢弃——陈旧审计的价值让位于无限堆积的磁盘风险；
- 单文件 JSONL 追加 + 全量重写（条目量级为失败审计，非调用主流）。
"""
from __future__ import annotations

import json
import logging
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class AuditBuffer:
    def __init__(self, path: Path, max_age_hours: int = 72):
        self._path = Path(path)
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._max_age = timedelta(hours=max_age_hours)
        self._lock = threading.Lock()
        self._in_flight: set[str] = set()  # 本次进程内已入队的幂等键（去重）

    def append(self, payload: dict[str, Any], headers: dict[str, str]) -> bool:
        """失败审计入队；同幂等键已在队列中则返回 False（不重复排队）。"""
        key = str(headers.get("Idempotency-Key", ""))
        with self._lock:
            if key and key in self._in_flight:
                return False
            if key:
                self._in_flight.add(key)
            with self._path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"payload": payload, "headers": headers,
                                         "queuedAt": datetime.now(timezone.utc).isoformat()},
                                        ensure_ascii=False) + "\n")
        return True

    def drain(self) -> list[tuple[dict[str, Any], dict[str, str]]]:
        """取走全部待重放条目（文件清空）；超龄条目直接丢弃并计数。"""
        now = datetime.now(timezone.utc)
        pending: list[tuple[dict[str, Any], dict[str, str]]] = []
        dropped_aged = 0
        with self._lock:
            if not self._path.exists():
                return []
            lines = self._path.read_text(encoding="utf-8").splitlines()
            for line in lines:
                try:
                    entry = json.loads(line)
                    queued_at = datetime.fromisoformat(entry["queuedAt"])
                except (ValueError, KeyError):
                    dropped_aged += 1  # 损坏行按丢弃处理
                    continue
                if now - queued_at > self._max_age:
                    dropped_aged += 1
                    continue
                pending.append((entry["payload"], entry["headers"]))
            self._path.write_text("", encoding="utf-8")
            self._in_flight.clear()
        if dropped_aged:
            logger.warning("审计缓冲丢弃 %d 条（超龄/损坏）", dropped_aged)
        return pending

    def requeue(self, payload: dict[str, Any], headers: dict[str, str]) -> None:
        """重放仍失败的条目回到队列（保留原 queuedAt，超龄丢弃口径不变）。"""
        with self._lock:
            with self._path.open("a", encoding="utf-8") as handle:
                handle.write(json.dumps({"payload": payload, "headers": headers,
                                         "queuedAt": datetime.now(timezone.utc).isoformat()},
                                        ensure_ascii=False) + "\n")

    def __len__(self) -> int:
        with self._lock:
            if not self._path.exists():
                return 0
            return sum(1 for line in self._path.read_text(encoding="utf-8").splitlines() if line)
