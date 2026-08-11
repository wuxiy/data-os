from __future__ import annotations

import hashlib
import hmac
import re
from typing import Any

from sqlalchemy import create_engine, text


_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_\.]*$")
_SENSITIVE = re.compile(r"(name|patient|person|phone|mobile|id_card|identity|address|encounter|visit|record)", re.I)


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
    def __init__(self, host: str, port: int, database: str, audit_database: str,
                 user: str, password: str, limit: int,
                 cleanup_user: str = "", cleanup_password: str = "", hash_key: str = ""):
        self.limit = limit
        self.database = database
        self.audit_database = audit_database
        self.hash_key = hash_key
        self.enabled = bool(host and user and password)
        self.engine = None
        self.cleanup_engine = None
        if self.enabled:
            self.engine = create_engine(
                f"mysql+pymysql://{user}:{password}@{host}:{port}/{database}",
                pool_pre_ping=True, pool_size=2, max_overflow=1,
            )
        if host and cleanup_user and cleanup_password:
            self.cleanup_engine = create_engine(
                f"mysql+pymysql://{cleanup_user}:{cleanup_password}@{host}:{port}/{audit_database}",
                pool_pre_ping=True, pool_size=1, max_overflow=0,
            )

    def read(self, evidence: dict[str, Any], tenant_namespace: str = "") -> list[dict[str, Any]]:
        if not self.enabled or self.engine is None:
            return []
        table = _identifier(str(evidence.get("table", "")))
        kind = str(evidence.get("kind", "")).lower()
        column = _identifier(str(evidence.get("column", "")))
        column_policies = self._column_policies(evidence.get("columns", []))
        columns = list(column_policies)
        if not table or not column or not columns:
            return []
        projection = ", ".join(columns)
        if kind == "not_null":
            query = text(f"SELECT {projection} FROM {table} WHERE {column} IS NULL LIMIT :limit")
            params: dict[str, Any] = {"limit": self.limit}
        elif kind == "accepted_values":
            values = evidence.get("values", [])
            if not isinstance(values, list) or not values or len(values) > 64:
                return []
            placeholders = ", ".join(f":value_{idx}" for idx in range(len(values)))
            query = text(f"SELECT {projection} FROM {table} WHERE {column} NOT IN ({placeholders}) LIMIT :limit")
            params = {f"value_{idx}": value for idx, value in enumerate(values)}
            params["limit"] = self.limit
        elif kind == "unique":
            query = text(
                f"SELECT {projection} FROM {table} WHERE {column} IN "
                f"(SELECT {column} FROM {table} GROUP BY {column} HAVING COUNT(*) > 1) LIMIT :limit"
            )
            params = {"limit": self.limit}
        else:
            return []
        with self.engine.connect() as connection:
            rows = connection.execute(query, params).mappings().all()
        hash_key = self._tenant_hash_key(tenant_namespace)
        return [{key: _mask(key, value, column_policies.get(key, "REDACTED"), hash_key)
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
