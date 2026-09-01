from __future__ import annotations

import hashlib
import hmac
import re
from typing import Any

from sqlalchemy import create_engine, text
from sqlalchemy.exc import OperationalError, ProgrammingError


_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_\.]*$")
_SENSITIVE = re.compile(r"(name|patient|person|phone|mobile|id_card|identity|address|encounter|visit|record)", re.I)


def _is_missing_table(exc: Exception) -> bool:
    """MySQL/Doris 1146（表不存在）与 sqlite『no such table』归为缺表。"""
    original = getattr(exc, "orig", None)
    args = getattr(original, "args", ())
    if args and (args[0] == 1146 or getattr(args[0], "errno", None) == 1146):
        return True
    message = str(original or exc).lower()
    return "no such table" in message or "doesn't exist" in message or "unknown table" in message


def _identifier(value: str) -> str:
    if not _IDENTIFIER.fullmatch(value):
        raise ValueError("invalid evidence identifier")
    return value


def _mask(key: str, value: Any, classification: str | None = None,
          hash_key: str = "") -> Any:
    if value is None:
        return None
    text_value = str(value)
    policy = (classification or ("IDENTIFIER" if _SENSITIVE.search(key) else "SAFE")).upper()
    if policy == "IDENTIFIER":
        if hash_key:
            digest = hmac.new(hash_key.encode("utf-8"), text_value.encode("utf-8"), hashlib.sha256).hexdigest()
            return "hmac-sha256:" + digest[:24]
        return "sha256:" + hashlib.sha256(text_value.encode("utf-8")).hexdigest()[:16]
    if policy == "REDACTED":
        return "[REDACTED]"
    return text_value[:128]


class EvidenceReader:
    """失败样本读取：只消费 dbt --store-failures 落在审计库的
    ``<namespace>__<selector>`` 失败表——判定谓词的权威在 dbt 工程的
    YAML 声明里，这里不重新实现规则语义，只做投影与脱敏。"""

    def __init__(self, host: str, port: int, audit_database: str,
                 user: str, password: str, limit: int,
                 cleanup_user: str = "", cleanup_password: str = "", hash_key: str = ""):
        self.limit = limit
        self.audit_database = audit_database
        self.hash_key = hash_key
        self.enabled = bool(host and user and password)
        self.engine = None
        self.cleanup_engine = None
        if self.enabled:
            self.engine = create_engine(
                f"mysql+pymysql://{user}:{password}@{host}:{port}/{audit_database}",
                pool_pre_ping=True, pool_size=2, max_overflow=1,
            )
        if host and cleanup_user and cleanup_password:
            self.cleanup_engine = create_engine(
                f"mysql+pymysql://{cleanup_user}:{cleanup_password}@{host}:{port}/{audit_database}",
                pool_pre_ping=True, pool_size=1, max_overflow=0,
            )

    def read(self, selector: str, evidence: dict[str, Any],
             tenant_namespace: str = "") -> list[dict[str, Any]]:
        if not self.enabled or self.engine is None:
            return []
        kind = str(evidence.get("kind", "")).lower()
        column = _identifier(str(evidence.get("column", "")))
        column_policies = self._column_policies(evidence.get("columns", []))
        if not kind or not column or not column_policies:
            return []
        # dbt 1.10 通用测试的失败表形状（dbt-adapters global_project
        # generic_test_sql）：not_null 存整行；unique/accepted_values 存
        # (值, n_records) 聚合；relationships 只存孤儿值列。
        if kind == "not_null":
            projection = ", ".join(column_policies)
        elif kind in {"unique", "accepted_values"}:
            value_column = "unique_field" if kind == "unique" else "value_field"
            projection = f"{value_column} AS {column}, n_records"
        elif kind == "relationships":
            projection = f"from_field AS {column}"
        else:
            return []
        table = (tenant_namespace + "__" + selector) if tenant_namespace else selector
        if not _IDENTIFIER.fullmatch(table):
            return []
        query = text(f"SELECT {projection} FROM {table} LIMIT :limit")
        params: dict[str, Any] = {"limit": self.limit}
        with self.engine.connect() as connection:
            try:
                rows = connection.execute(query, params).mappings().all()
            except (ProgrammingError, OperationalError) as exc:
                # dbt 测试本身 error（非数据失败）时没有失败表：此时
                # 结论与诊断信息由 dbt 输出承载，证据留空。权限类错误
                # 照常上抛——静默吞掉会掩盖授权配置问题。
                if _is_missing_table(exc):
                    return []
                raise
        hash_key = self._tenant_hash_key(tenant_namespace)
        policies = dict(column_policies)
        policies.setdefault("n_records", "SAFE")
        return [{key: _mask(key, value, policies.get(key, "REDACTED"), hash_key)
                 for key, value in row.items()} for row in rows[: self.limit]]

    def _tenant_hash_key(self, tenant_namespace: str) -> str:
        if not self.hash_key:
            return ""
        return hmac.new(self.hash_key.encode("utf-8"), tenant_namespace.encode("utf-8"), hashlib.sha256).hexdigest()

    def _column_policies(self, raw_columns: Any) -> dict[str, str]:
        if not isinstance(raw_columns, list):
            return {}
        policies: dict[str, str] = {}
        for item in raw_columns:
            if isinstance(item, str):
                name, classification = item, "REDACTED"
            elif isinstance(item, dict):
                name = str(item.get("name", ""))
                classification = str(item.get("classification", "REDACTED")).upper()
            else:
                continue
            if _IDENTIFIER.fullmatch(name) and classification in {"IDENTIFIER", "CATEGORY", "SAFE", "REDACTED"}:
                policies[name] = classification
        return policies

    def cleanup_failure_tables(self, selector: str, tenant_namespace: str = "") -> int:
        """Drop only dbt's exact registered selector table after evidence capture."""
        if self.cleanup_engine is None or not _IDENTIFIER.fullmatch(selector):
            return 0
        dropped = 0
        with self.cleanup_engine.begin() as connection:
            rows = connection.execute(text(f"SHOW TABLES FROM `{self.audit_database}`")).all()
            for row in rows:
                table = str(row[0]) if row else ""
                if not _IDENTIFIER.fullmatch(table):
                    continue
                expected = (tenant_namespace + "__" + selector) if tenant_namespace else selector
                allowed = {expected, expected + "__dbt_tmp"}
                # Startup cleanup has no tenant list. Only registered selector
                # names, optionally prefixed by a generated tenant namespace,
                # are eligible; arbitrary audit tables are never touched.
                if table in allowed or (not tenant_namespace and table.endswith("__" + selector)):
                    connection.execute(text(f"DROP TABLE IF EXISTS `{self.audit_database}`.`{table}`"))
                    dropped += 1
        return dropped

    def cleanup_registered_failure_tables(self, selectors: list[str]) -> int:
        return sum(self.cleanup_failure_tables(selector) for selector in selectors)
