"""动态质量规则编译器（G2G 批次 2 首刀）。

把门户配置的规则意图（类型 + 目标「库.表」+ 列 + 参数）编译为 dbt
singular test——一个返回失败行的 SELECT，落 ``tests/dynamic/<selector>.sql``
后与静态声明的 generic test 同走 ``dbt test --select <selector>
--store-failures``，执行/监督/证据/复检链零改动。

失败表形状与 evidence.py 的投影契约对齐：
- 聚合形状（UNIQUE/VAL_SET）：``(值, n_records)``；
- 孤儿形状（FK_REF）：``from_field`` 单列；
- 整行形状（NOT_NULL/VAL_MINMAX/VAL_LEN/STR_REGEX/SQL）：按证据白名单列投影。

规则类型语义参考 nema dqp RuleType（101/102/301/302/304/305/103/402），
生成物是 Doris（MySQL）方言。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

_IDENTIFIER = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
_RULE_ID = re.compile(r"^[a-z0-9][a-z0-9_\.\-]{2,199}$")
_LINE_COMMENT = re.compile(r"--[^\n\r]*")
_BLOCK_COMMENT = re.compile(r"/\*.*?\*/", re.DOTALL)

# 类型 → 证据 kind（失败表形状，见 evidence.py）
KIND_BY_TYPE = {
    "NOT_NULL": "not_null",
    "UNIQUE": "unique",
    "VAL_SET": "accepted_values",
    "VAL_MINMAX": "not_null",
    "VAL_LEN": "not_null",
    "STR_REGEX": "not_null",
    "FK_REF": "relationships",
    "SQL": "not_null",
}
DIMENSION_BY_TYPE = {
    "NOT_NULL": "完整性", "UNIQUE": "完整性", "FK_REF": "完整性",
    "VAL_SET": "规范性", "VAL_MINMAX": "规范性", "VAL_LEN": "规范性", "STR_REGEX": "规范性",
    "SQL": "准确性",
}


def selector_for(rule_id: str) -> str:
    """selector = dynamic_<规范化>；证据清理按标识符匹配，禁用连字符等字符。"""
    normalized = re.sub(r"[^A-Za-z0-9_]", "_", rule_id)
    return "dynamic_" + normalized


@dataclass
class DynamicRuleSpec:
    rule_id: str
    rule_type: str
    dataset_id: str
    column: str = ""
    params: dict[str, Any] = field(default_factory=dict)
    evidence_columns: list[dict[str, str]] = field(default_factory=list)

    def validate(self) -> "DynamicRuleSpec":
        if not _RULE_ID.fullmatch(self.rule_id):
            raise ValueError(f"非法 rule_id：{self.rule_id}")
        self.rule_type = str(self.rule_type or "").strip().upper()
        if self.rule_type not in KIND_BY_TYPE:
            raise ValueError(f"不支持的规则类型：{self.rule_type}")
        database, _, table = self.dataset_id.partition(".")
        if not table or not _IDENTIFIER.fullmatch(database) or not _IDENTIFIER.fullmatch(table):
            raise ValueError(f"dataset_id 必须是「库.表」形态的标识符：{self.dataset_id}")
        self.dataset_id = f"{database}.{table}"
        if self.rule_type != "SQL" and not _IDENTIFIER.fullmatch(self.column or ""):
            raise ValueError(f"非法目标列：{self.column}")
        if not self.evidence_columns:
            raise ValueError("证据列白名单不能为空")
        for item in self.evidence_columns:
            name = str(item.get("name", ""))
            classification = str(item.get("classification", "REDACTED")).upper()
            if not _IDENTIFIER.fullmatch(name) or classification not in {
                "IDENTIFIER", "CATEGORY", "SAFE", "REDACTED"
            }:
                raise ValueError(f"非法证据列策略：{name}")
            item["name"] = name
            item["classification"] = classification
        self._validate_params()
        return self

    def _validate_params(self) -> None:
        params = self.params or {}
        if self.rule_type == "VAL_SET":
            values = params.get("values")
            if not isinstance(values, list) or not values:
                raise ValueError("VAL_SET 需要 values 值集")
            for value in values:
                if isinstance(value, bool) or not isinstance(value, (int, float, str)):
                    raise ValueError(f"非法值集元素：{value!r}")
        if self.rule_type == "VAL_MINMAX":
            has_min = _is_number(params.get("minVal"))
            has_max = _is_number(params.get("maxVal"))
            if not (has_min or has_max):
                raise ValueError("VAL_MINMAX 至少需要 minVal/maxVal 之一")
        if self.rule_type == "VAL_LEN":
            has_min = isinstance(params.get("minLen"), int) and not isinstance(params.get("minLen"), bool)
            has_max = isinstance(params.get("maxLen"), int) and not isinstance(params.get("maxLen"), bool)
            if not (has_min or has_max):
                raise ValueError("VAL_LEN 至少需要 minLen/maxLen 之一")
        if self.rule_type == "STR_REGEX":
            if not str(params.get("regex", "")).strip():
                raise ValueError("STR_REGEX 需要 regex")
        if self.rule_type == "FK_REF":
            ref = str(params.get("refDataset", ""))
            ref_column = str(params.get("refColumn", ""))
            ref_db, _, ref_table = ref.partition(".")
            if not ref_table or not _IDENTIFIER.fullmatch(ref_db) or not _IDENTIFIER.fullmatch(ref_table):
                raise ValueError(f"FK_REF 需要 refDataset「库.表」形态：{ref}")
            if not _IDENTIFIER.fullmatch(ref_column):
                raise ValueError(f"FK_REF 需要 refColumn 标识符：{ref_column}")
        if self.rule_type == "SQL":
            sql = str(params.get("sql", "")).strip()
            if not sql:
                raise ValueError("SQL 规则需要查询语句")
            assert_readonly_select(sql)

    # —— 编译 ——

    def compile_sql(self) -> str:
        database, _, table = self.dataset_id.partition(".")
        target = f"`{database}`.`{table}`"
        column = f"`{self.column}`"
        row_projection = ", ".join(f"`{item['name']}`" for item in self.evidence_columns)
        params = self.params or {}
        if self.rule_type == "NOT_NULL":
            predicate = f"{column} IS NULL"
            if params.get("checkBlank") is True:
                predicate += f" OR {column} = ''"
            return f"SELECT {row_projection} FROM {target} WHERE {predicate}"
        if self.rule_type == "UNIQUE":
            return (f"SELECT {column} AS unique_field, COUNT(*) AS n_records FROM {target} "
                    f"WHERE {column} IS NOT NULL GROUP BY {column} HAVING COUNT(*) > 1")
        if self.rule_type == "VAL_SET":
            values = ", ".join(sql_literal(value) for value in params["values"])
            return (f"SELECT {column} AS value_field, COUNT(*) AS n_records FROM {target} "
                    f"WHERE {column} IS NOT NULL AND {column} NOT IN ({values}) "
                    f"GROUP BY {column}")
        if self.rule_type == "VAL_MINMAX":
            predicate = []
            if _is_number(params.get("minVal")):
                predicate.append(f"{column} < {format_number(params['minVal'])}")
            if _is_number(params.get("maxVal")):
                predicate.append(f"{column} > {format_number(params['maxVal'])}")
            return (f"SELECT {row_projection} FROM {target} "
                    f"WHERE {column} IS NOT NULL AND ({' OR '.join(predicate)})")
        if self.rule_type == "VAL_LEN":
            predicate = []
            if isinstance(params.get("minLen"), int) and not isinstance(params.get("minLen"), bool):
                predicate.append(f"CHAR_LENGTH({column}) < {int(params['minLen'])}")
            if isinstance(params.get("maxLen"), int) and not isinstance(params.get("maxLen"), bool):
                predicate.append(f"CHAR_LENGTH({column}) > {int(params['maxLen'])}")
            return (f"SELECT {row_projection} FROM {target} "
                    f"WHERE {column} IS NOT NULL AND ({' OR '.join(predicate)})")
        if self.rule_type == "STR_REGEX":
            regex = sql_string(str(params["regex"]))
            return (f"SELECT {row_projection} FROM {target} "
                    f"WHERE {column} IS NOT NULL AND {column} NOT REGEXP {regex}")
        if self.rule_type == "FK_REF":
            ref_db, _, ref_table = str(params["refDataset"]).partition(".")
            ref_column = f"`{str(params['refColumn'])}`"
            return (f"SELECT a.{column} AS from_field FROM {target} a "
                    f"LEFT JOIN `{ref_db}`.`{ref_table}` r ON a.{column} = r.{ref_column} "
                    f"WHERE a.{column} IS NOT NULL AND r.{ref_column} IS NULL "
                    f"GROUP BY a.{column}")
        if self.rule_type == "SQL":
            return str(params["sql"]).strip().rstrip(";").strip()
        raise ValueError(f"不支持的规则类型：{self.rule_type}")

    def evidence_contract(self) -> dict[str, Any]:
        return {
            "kind": KIND_BY_TYPE[self.rule_type],
            "column": self.column or "value",
            "columns": [dict(item) for item in self.evidence_columns],
        }


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def format_number(value: float | int) -> str:
    """整数值不带小数点（0 而非 0.0），保持生成 SQL 的可读稳定。"""
    number = float(value)
    if number.is_integer():
        return str(int(number))
    return repr(number)


def sql_literal(value: Any) -> str:
    """数字原样、字符串转义加引号（值集内嵌 SQL 的注入防线）。"""
    if isinstance(value, bool):
        raise ValueError("布尔值不在值集支持范围")
    if isinstance(value, (int, float)):
        return repr(value)
    return sql_string(str(value))


def sql_string(value: str) -> str:
    return "'" + value.replace("\\", "\\\\").replace("'", "''") + "'"


def assert_readonly_select(sql: str) -> None:
    """单条只读 SELECT/WITH（剥注释后判定）；分号只允许出现在结尾。"""
    without_block = _BLOCK_COMMENT.sub(" ", sql)
    inspectable = _LINE_COMMENT.sub(" ", without_block).strip()
    statement = inspectable.rstrip(";").strip()
    if not statement:
        raise ValueError("查询语句不能为空")
    lowered = statement.lower()
    if not (lowered.startswith("select") or lowered.startswith("with")):
        raise ValueError("仅支持只读查询（SELECT / WITH 开头）")
    if ";" in statement:
        raise ValueError("仅支持单条查询语句")
