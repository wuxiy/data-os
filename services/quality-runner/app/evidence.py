from __future__ import annotations

import hashlib
import re
from typing import Any

from sqlalchemy import create_engine, text


_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_\.]*$")
_SENSITIVE = re.compile(r"(name|patient|person|phone|mobile|id_card|identity|address|encounter|visit|record)", re.I)


def _identifier(value: str) -> str:
    if not _IDENTIFIER.fullmatch(value):
        raise ValueError("invalid evidence identifier")
    return value


def _mask(key: str, value: Any) -> Any:
    if value is None:
        return None
    text_value = str(value)
    if _SENSITIVE.search(key):
        return "sha256:" + hashlib.sha256(text_value.encode("utf-8")).hexdigest()[:16]
    return text_value[:128]


class EvidenceReader:
    def __init__(self, host: str, port: int, database: str, audit_database: str,
                 user: str, password: str, limit: int,
                 cleanup_user: str = "", cleanup_password: str = ""):
        self.limit = limit
        self.database = database
        self.audit_database = audit_database
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

    def read(self, evidence: dict[str, Any]) -> list[dict[str, Any]]:
        if not self.enabled or self.engine is None:
            return []
        table = _identifier(str(evidence.get("table", "")))
        kind = str(evidence.get("kind", "")).lower()
        column = _identifier(str(evidence.get("column", "")))
        columns = [_identifier(str(item)) for item in evidence.get("columns", [])]
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
        return [{key: _mask(key, value) for key, value in row.items()} for row in rows[: self.limit]]

    def cleanup_failure_tables(self, selector: str) -> int:
        """Drop only dbt's exact registered selector table after evidence capture."""
        if self.cleanup_engine is None or not _IDENTIFIER.fullmatch(selector):
            return 0
        dropped = 0
        with self.cleanup_engine.begin() as connection:
            rows = connection.execute(text(f"SHOW TABLES FROM `{self.audit_database}` LIKE :pattern"),
                                      {"pattern": selector + "%"}).all()
            for row in rows:
                table = str(row[0]) if row else ""
                if table == selector or table == selector + "__dbt_tmp":
                    connection.execute(text(f"DROP TABLE IF EXISTS `{self.audit_database}`.`{table}`"))
                    dropped += 1
        return dropped
