"""查询执行器：参数契约校验 + :name 占位到 pymysql %s 的有序绑定 + 限额执行。

安全模型：SQL 模板已在控制面发布时通过静态校验（SELECT-only）；本层只做
参数校验与绑定传输，参数值永不拼接进 SQL 文本。
"""
from __future__ import annotations

import json
import re
import time
from typing import Any

import pymysql

PLACEHOLDER = re.compile(r":([A-Za-z_][A-Za-z0-9_]*)")
DATE_PATTERN = re.compile(r"^\d{4}-\d{2}-\d{2}$")


class ParameterError(ValueError):
    """参数契约不满足（400 PARAM_INVALID），message 携带字段级原因。"""


def validate_parameters(parameter_contracts: list[dict[str, Any]], payload: dict[str, Any]) -> dict[str, Any]:
    """返回校验后的取值 dict（含默认值填充）；违规抛 ParameterError。"""
    contracts = {str(item["name"]): item for item in parameter_contracts}
    unknown = [name for name in payload if name not in contracts]
    if unknown:
        raise ParameterError(f"未声明的参数: {', '.join(sorted(unknown))}")
    values: dict[str, Any] = {}
    errors: list[str] = []
    for name, contract in contracts.items():
        raw = payload.get(name, contract.get("defaultValue"))
        if raw is None or raw == "":
            if contract.get("required"):
                errors.append(f"{name}: 必填")
            continue
        kind = str(contract.get("type", "string"))
        allowed = contract.get("values") or []
        if allowed and str(raw) not in [str(item) for item in allowed]:
            errors.append(f"{name}: 不在允许取值内")
            continue
        if kind == "number":
            try:
                values[name] = float(raw) if "." in str(raw) else int(raw)
            except (TypeError, ValueError):
                errors.append(f"{name}: 须为数值")
        elif kind == "date":
            if not DATE_PATTERN.match(str(raw)):
                errors.append(f"{name}: 须为 YYYY-MM-DD 日期")
            else:
                values[name] = str(raw)
        elif kind == "boolean":
            if isinstance(raw, bool):
                values[name] = raw
            elif str(raw).lower() in ("true", "false"):
                values[name] = str(raw).lower() == "true"
            else:
                errors.append(f"{name}: 须为布尔")
        else:
            values[name] = str(raw)
    if errors:
        raise ParameterError("; ".join(errors))
    return values


def enforce_hospital_scope(values: dict[str, Any], parameter_contracts: list[dict[str, Any]],
                           allowed_hospitals: list[str]) -> None:
    """行级医院授权：Key 授权非 '*' 时，hospital_code 参数必须落在授权集合内。"""
    if "*" in allowed_hospitals or "hospital_code" not in values:
        return
    if str(values.get("hospital_code")) not in [str(item) for item in allowed_hospitals]:
        raise PermissionError("hospital_code 超出该 Key 的医院授权范围")


def render(sql_template: str, values: dict[str, Any]) -> tuple[str, tuple]:
    """:name 占位按出现顺序转为 %s，返回 (sql, args)。"""
    args: list[Any] = []

    def replace(match: re.Match[str]) -> str:
        args.append(values[match.group(1)])
        return "%s"

    return PLACEHOLDER.sub(replace, sql_template), tuple(args)


def execute(sql_template: str, values: dict[str, Any], service: dict[str, Any],
            settings: Any) -> dict[str, Any]:
    """执行并返回 {columns, rows, truncated, elapsedMs}；行数上限与超时按服务定义。"""
    sql, args = render(sql_template, values)
    max_rows = int(service.get("maxRows", 1000))
    timeout_s = int(service.get("timeoutSeconds", 30))
    started = time.monotonic()
    connection = pymysql.connect(
        host=settings.doris_host,
        port=settings.doris_port,
        user=settings.doris_user,
        password=settings.doris_password,
        connect_timeout=settings.doris_connect_timeout_s,
        read_timeout=timeout_s,
        write_timeout=timeout_s,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.Cursor,
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute(sql, args)
            columns = [column[0] for column in cursor.description or []]
            fetched = cursor.fetchmany(max_rows + 1)
    finally:
        connection.close()
    truncated = len(fetched) > max_rows
    rows = fetched[:max_rows]
    return {
        "columns": columns,
        "rows": [list(row) for row in rows],
        "rowCount": len(rows),
        "truncated": truncated,
        "elapsedMs": int((time.monotonic() - started) * 1000),
    }


def parameters_json_of(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, sort_keys=True)
