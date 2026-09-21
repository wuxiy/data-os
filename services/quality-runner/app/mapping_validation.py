"""映射聚合验证（G23，同步只读契约）：POST /api/v1/mapping-validations。

只接受已登记数据集（settings.mapping_datasets）与安全标识符列名；
只做聚合查询——类型兼容性（information_schema 对拍目标类型）、空值率、
值域覆盖率与未映射值 TOP N、数据时间；绝不返回原始行、患者标识或任意
SQL 结果。标识符经严格正则后内插（Doris 标识符不可参数化），值域比对
在进程内完成，不把任何调用方值拼进 SQL。
"""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable

import pymysql
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from security import Principal, check_scope, principal
from settings import settings as runtime_settings

IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,127}$")
DATASET = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,127}\.[A-Za-z_][A-Za-z0-9_]{0,127}$")
ALLOWED_TRANSFORMS = {"COPY", "TRIM", "UPPER", "DATE_FORMAT", "VALUE_MAP"}
UNMAPPED_TOP_N = 10
DISTINCT_LIMIT = 200

# Doris DATA_TYPE → 标准数据元类型族
_TYPE_FAMILY = {
    "varchar": "STRING", "text": "STRING", "string": "STRING", "char": "STRING",
    "int": "INTEGER", "bigint": "INTEGER", "smallint": "INTEGER", "tinyint": "INTEGER",
    "decimal": "DECIMAL", "double": "DECIMAL", "float": "DECIMAL",
    "date": "DATE", "datetime": "DATETIME", "timestamp": "DATETIME",
    "boolean": "BOOLEAN",
}


class MappingValidationItem(BaseModel):
    sourceColumn: str
    targetType: str
    transform: str
    transformParam: str | None = None
    allowedValues: list[str] | None = None


class MappingValidationRequest(BaseModel):
    dataset: str
    items: list[MappingValidationItem] = Field(min_length=1)


def router(doris_query: Callable[[str], list[tuple]]) -> APIRouter:
    api = APIRouter(prefix="/api/v1")

    @api.post("/mapping-validations")
    def validate_mapping(request: MappingValidationRequest,
                         current: Principal = Depends(principal)) -> dict[str, Any]:
        check_scope(current, "quality:read")
        dataset = request.dataset.strip()
        if dataset not in runtime_settings.mapping_datasets:
            raise HTTPException(status_code=400, detail=f"数据集未登记映射验证白名单: {dataset}")
        if not DATASET.match(dataset):
            raise HTTPException(status_code=400, detail=f"数据集名非法: {dataset}")
        database, table = dataset.split(".")
        rows = doris_query(
            "SELECT COLUMN_NAME, DATA_TYPE FROM information_schema.columns "
            f"WHERE TABLE_SCHEMA = '{database}' AND TABLE_NAME = '{table}'")
        if not rows:
            raise HTTPException(status_code=400, detail=f"数据集不存在: {dataset}")
        column_types = {name: (dtype or "").lower() for name, dtype in rows}

        total_row = doris_query(f"SELECT COUNT(*) FROM {database}.{table}")
        row_count = int(total_row[0][0]) if total_row else 0

        results = []
        for item in request.items:
            column = item.sourceColumn.strip()
            if not IDENTIFIER.match(column):
                raise HTTPException(status_code=400, detail=f"列名非法: {column}")
            if column not in column_types:
                raise HTTPException(status_code=400, detail=f"列不存在于 {dataset}: {column}")
            if item.transform.upper() not in ALLOWED_TRANSFORMS:
                raise HTTPException(status_code=400, detail=f"非法转换: {item.transform}")
            source_family = _TYPE_FAMILY.get(column_types[column], "STRING")
            target = item.targetType.upper()
            compatible = _compatible(source_family, target, item.transform.upper())
            null_rate = _null_rate(doris_query, database, table, column)
            entry: dict[str, Any] = {
                "sourceColumn": column,
                "sourceType": column_types[column],
                "targetType": target,
                "compatible": compatible,
                "nullRate": null_rate,
            }
            if target == "CODE":
                domain = _code_domain(item)
                value_counts = _top_values(doris_query, database, table, column)
                if domain is not None and value_counts:
                    in_domain = sum(count for value, count in value_counts if value in domain)
                    total_values = sum(count for _, count in value_counts)
                    entry["coverage"] = (in_domain / total_values) if total_values else 1.0
                    entry["unmappedTop"] = [
                        {"value": value, "count": count}
                        for value, count in value_counts
                        if value not in domain
                    ][:UNMAPPED_TOP_N]
                else:
                    entry["coverage"] = None
            results.append(entry)

        return {
            "asOf": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "dataset": dataset,
            "rowCount": row_count,
            "items": results,
        }

    return api


def _compatible(source_family: str, target: str, transform: str) -> bool:
    if target == "CODE":
        return source_family == "STRING"
    if transform == "COPY":
        return source_family == target
    # 显式转换（TRIM/UPPER/DATE_FORMAT/VALUE_MAP）按目标类型族的源可表达性判断
    expressible = {
        "STRING": {"STRING"},
        "INTEGER": {"INTEGER"},
        "DECIMAL": {"DECIMAL", "INTEGER"},
        "DATE": {"DATE", "DATETIME", "STRING"},
        "DATETIME": {"DATE", "DATETIME", "STRING"},
        "BOOLEAN": {"BOOLEAN"},
    }
    return source_family in expressible.get(target, set())


def _code_domain(item: MappingValidationItem) -> frozenset[str] | None:
    """值域：VALUE_MAP 取映射键；COPY/CODE 取标准 allowedValues。"""
    if item.transform.upper() == "VALUE_MAP" and item.transformParam:
        import json
        try:
            return frozenset(str(key) for key in json.loads(item.transformParam))
        except ValueError:
            return None
    if item.allowedValues:
        return frozenset(item.allowedValues)
    return None


def _null_rate(query: Callable[[str], list[tuple]], database: str, table: str,
               column: str) -> float:
    rows = query(f"SELECT AVG(CASE WHEN {column} IS NULL THEN 1 ELSE 0 END) "
                 f"FROM {database}.{table}")
    value = rows[0][0] if rows else None
    return float(value) if value is not None else 0.0


def _top_values(query: Callable[[str], list[tuple]], database: str, table: str,
                column: str) -> list[tuple[str, int]]:
    rows = query(f"SELECT CAST({column} AS STRING) AS v, COUNT(*) AS c "
                 f"FROM {database}.{table} WHERE {column} IS NOT NULL "
                 f"GROUP BY CAST({column} AS STRING) ORDER BY c DESC LIMIT {DISTINCT_LIMIT}")
    return [(str(value), int(count)) for value, count in rows]


def doris_query_factory(settings: Any) -> Callable[[str], list[tuple]]:
    """每次验证一条短连接（验证是低频操作；与 EvidenceReader 同款连接纪律）。"""

    def execute(sql: str) -> list[tuple]:
        connection = pymysql.connect(
            host=settings.doris_host, port=settings.doris_port,
            user=settings.doris_user, password=settings.doris_password,
            connect_timeout=5, read_timeout=60, charset="utf8mb4",
            cursorclass=pymysql.cursors.Cursor,
        )
        try:
            with connection.cursor() as cursor:
                cursor.execute(sql)
                return list(cursor.fetchall())
        finally:
            connection.close()

    return execute
