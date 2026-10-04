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

# 类型 → 证据 kind（失败表形状，见 evidence.py）；第二刀新增类型全部整行形状
KIND_BY_TYPE = {
    "NOT_NULL": "not_null",
    "UNIQUE": "unique",
    "VAL_SET": "accepted_values",
    "VAL_MINMAX": "not_null",
    "VAL_LEN": "not_null",
    "STR_REGEX": "not_null",
    "FK_REF": "relationships",
    "SQL": "not_null",
    "CROSS_VAL_COMPARE": "not_null",
    "STAT_VAL_COMPARE": "not_null",
    "SQL_STAT_VAL": "not_null",
    "DETAIL_STAT": "not_null",
    "FIELD_LOGIC": "not_null",
    "UPDATE_TIME": "not_null",
    "TIME_CONTINUITY": "not_null",
}
DIMENSION_BY_TYPE = {
    "NOT_NULL": "完整性", "UNIQUE": "完整性", "FK_REF": "完整性",
    "VAL_SET": "规范性", "VAL_MINMAX": "规范性", "VAL_LEN": "规范性", "STR_REGEX": "规范性",
    "SQL": "准确性",
    "CROSS_VAL_COMPARE": "一致性", "STAT_VAL_COMPARE": "一致性",
    "SQL_STAT_VAL": "一致性", "DETAIL_STAT": "一致性",
    "FIELD_LOGIC": "准确性", "UPDATE_TIME": "及时性", "TIME_CONTINUITY": "稳定性",
}
STAT_OPS = {"SUM", "AVG", "COUNT", "MAX", "MIN"}
TIME_UNIT_SECONDS = {"SECOND": 1, "MINUTE": 60, "HOUR": 3600, "DAY": 86400}
# 目标列可缺省的类型：谓词不落在单列上（SQL 自带目标；SQL_STAT_VAL 双 SQL 各自携带）
COLUMN_OPTIONAL_TYPES = {"SQL", "SQL_STAT_VAL"}
# 计算形状类型：失败行列名由编译器决定，证据白名单服务端派生（全 SAFE）
COMPUTED_EVIDENCE_TYPES = {"STAT_VAL_COMPARE", "SQL_STAT_VAL", "DETAIL_STAT", "TIME_CONTINUITY"}


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
        if self.rule_type not in COLUMN_OPTIONAL_TYPES and not _IDENTIFIER.fullmatch(self.column or ""):
            raise ValueError(f"非法目标列：{self.column}")
        if self.rule_type not in COMPUTED_EVIDENCE_TYPES and not self.evidence_columns:
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
        # —— 第二刀：跨表/统计/时间宏 ——
        if self.rule_type == "CROSS_VAL_COMPARE":
            _require_dataset(params.get("refDataset"))
            _require_identifier(params.get("refColumn"), "参照列")
            keys = _join_keys(params)
        if self.rule_type == "STAT_VAL_COMPARE":
            _require_stat_op(params.get("op"), "检查表统计函数")
            _require_stat_op(params.get("refOp"), "参照表统计函数")
            _require_dataset(params.get("refDataset"))
            if str(params.get("refOp", "")) != "COUNT":
                _require_identifier(params.get("refColumn"), "参照列")
        if self.rule_type == "SQL_STAT_VAL":
            check_sql = str(params.get("checkSql", "")).strip()
            ref_sql = str(params.get("refSql", "")).strip()
            if not check_sql or not ref_sql:
                raise ValueError("SQL_STAT_VAL 需要 checkSql 与 refSql（各返回单个统计值）")
            assert_readonly_select(check_sql)
            assert_readonly_select(ref_sql)
        if self.rule_type == "DETAIL_STAT":
            _require_stat_op(params.get("refOp"), "明细表统计函数")
            _require_dataset(params.get("refDataset"))
            _require_identifier(params.get("refColumn"), "明细值列")
            _join_keys(params)
        if self.rule_type == "FIELD_LOGIC":
            logic = str(params.get("logic", "")).strip()
            if not logic:
                raise ValueError("FIELD_LOGIC 需要 logic 逻辑表达式")
            if any(mark in logic for mark in (";", "--", "/*")):
                raise ValueError("逻辑表达式不允许分号或注释片段")
        if self.rule_type == "UPDATE_TIME":
            _require_identifier(params.get("ingestColumn"), "入库时间列")
            threshold = params.get("threshold")
            if isinstance(threshold, bool) or not isinstance(threshold, int) or threshold < 0:
                raise ValueError("UPDATE_TIME 需要 threshold 非负整数")
            if str(params.get("timeUnit", "")) not in TIME_UNIT_SECONDS:
                raise ValueError("UPDATE_TIME 需要 timeUnit（SECOND/MINUTE/HOUR/DAY）")

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
        # —— 第二刀：跨表/统计/时间宏 ——
        if self.rule_type == "CROSS_VAL_COMPARE":
            ref_db, _, ref_table = str(params["refDataset"]).partition(".")
            joins = " AND ".join(
                f"t.`{tk}` = r.`{rk}`" for tk, rk in _join_keys(params))
            return (f"SELECT {prefixed_projection(self.evidence_columns)} FROM {target} t "
                    f"JOIN `{ref_db}`.`{ref_table}` r ON {joins} "
                    f"WHERE t.{column} <> r.`{str(params['refColumn'])}`")
        if self.rule_type in {"STAT_VAL_COMPARE", "SQL_STAT_VAL"}:
            if self.rule_type == "SQL_STAT_VAL":
                check_side = f"({str(params['checkSql']).strip().rstrip(';')})"
                ref_side = f"({str(params['refSql']).strip().rstrip(';')})"
            else:
                ref_db, _, ref_table = str(params["refDataset"]).partition(".")
                ref_column = "*" if str(params["refOp"]) == "COUNT" else f"`{str(params['refColumn'])}`"
                check_side = f"(SELECT {stat_call(str(params['op']), column)} FROM {target})"
                ref_side = f"(SELECT {stat_call(str(params['refOp']), ref_column)} FROM `{ref_db}`.`{ref_table}`)"
            return (f"SELECT c.check_value, r.ref_value FROM {check_side} c "
                    f"JOIN {ref_side} r "
                    f"WHERE c.check_value <> r.ref_value OR c.check_value IS NULL OR r.ref_value IS NULL")
        if self.rule_type == "DETAIL_STAT":
            ref_db, _, ref_table = str(params["refDataset"]).partition(".")
            keys = _join_keys(params)
            ref_column = f"`{str(params['refColumn'])}`"
            target_keys = ", ".join(f"`{tk}`" for tk, _ in keys)
            ref_keys = ", ".join(f"`{rk}` AS `{tk}`" for tk, rk in keys)
            ref_group = ", ".join(f"`{rk}`" for _, rk in keys)
            join_on = " AND ".join(f"c.`{tk}` = r.`{tk}`" for tk, _ in keys)
            return (f"SELECT {target_keys}, c.check_value, r.ref_value FROM "
                    f"(SELECT {target_keys}, {column} AS check_value FROM {target}) c "
                    f"JOIN (SELECT {ref_keys}, {stat_call(str(params['refOp']), ref_column)} "
                    f"AS ref_value FROM `{ref_db}`.`{ref_table}` GROUP BY {ref_group}) r "
                    f"ON {join_on} WHERE c.check_value <> r.ref_value "
                    f"OR c.check_value IS NULL OR r.ref_value IS NULL")
        if self.rule_type == "FIELD_LOGIC":
            return f"SELECT {row_projection} FROM {target} WHERE NOT ({str(params['logic']).strip()})"
        if self.rule_type == "UPDATE_TIME":
            threshold = int(params["threshold"]) * TIME_UNIT_SECONDS[str(params["timeUnit"])]
            ingest = f"`{str(params['ingestColumn'])}`"
            return (f"SELECT {row_projection} FROM {target} "
                    f"WHERE {ingest} IS NOT NULL AND {column} IS NOT NULL "
                    f"AND TIMESTAMPDIFF(SECOND, {column}, {ingest}) > {threshold}")
        if self.rule_type == "TIME_CONTINUITY":
            return (f"SELECT prev_period, cur_period FROM ("
                    f"SELECT LAG(p) OVER (ORDER BY p) AS prev_period, p AS cur_period FROM "
                    f"(SELECT DISTINCT {column} AS p FROM {target} WHERE {column} IS NOT NULL) d) g "
                    f"WHERE prev_period IS NOT NULL AND TIMESTAMPDIFF(DAY, prev_period, cur_period) > 1")
        raise ValueError(f"不支持的规则类型：{self.rule_type}")

    def evidence_contract(self) -> dict[str, Any]:
        return {
            "kind": KIND_BY_TYPE[self.rule_type],
            "column": self.column if self.rule_type not in COLUMN_OPTIONAL_TYPES else "check_value",
            "columns": [dict(item) for item in self.derived_evidence_columns()],
        }

    def derived_evidence_columns(self) -> list[dict[str, str]]:
        """计算形状类型的失败列由编译器决定（全 SAFE）；其余用调用方白名单。"""
        if self.rule_type in {"STAT_VAL_COMPARE", "SQL_STAT_VAL"}:
            return [{"name": "check_value", "classification": "SAFE"},
                    {"name": "ref_value", "classification": "SAFE"}]
        if self.rule_type == "DETAIL_STAT":
            columns = [{"name": tk, "classification": "SAFE"} for tk, _ in _join_keys(self.params or {})]
            columns += [{"name": "check_value", "classification": "SAFE"},
                        {"name": "ref_value", "classification": "SAFE"}]
            return columns
        if self.rule_type == "TIME_CONTINUITY":
            return [{"name": "prev_period", "classification": "SAFE"},
                    {"name": "cur_period", "classification": "SAFE"}]
        return self.evidence_columns


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _require_identifier(value: Any, label: str) -> str:
    text = str(value or "").strip()
    if not _IDENTIFIER.fullmatch(text):
        raise ValueError(f"非法{label}：{value}")
    return text


def _require_dataset(value: Any) -> str:
    database, _, table = str(value or "").partition(".")
    if not table or not _IDENTIFIER.fullmatch(database) or not _IDENTIFIER.fullmatch(table):
        raise ValueError(f"dataset 必须是「库.表」形态的标识符：{value}")
    return f"{database}.{table}"


def _require_stat_op(value: Any, label: str) -> str:
    text = str(value or "").strip().upper()
    if text not in STAT_OPS:
        raise ValueError(f"{label}必须是 {'/'.join(sorted(STAT_OPS))}：{value}")
    return text


def _join_keys(params: dict[str, Any]) -> list[tuple[str, str]]:
    """关联键对（目标列, 参照列）；两列清单须等长且均为标识符。"""
    target_keys = params.get("targetJoinCols")
    ref_keys = params.get("refJoinCols")
    if not isinstance(target_keys, list) or not isinstance(ref_keys, list) or not target_keys:
        raise ValueError("需要 targetJoinCols/refJoinCols 关联键清单")
    if len(target_keys) != len(ref_keys):
        raise ValueError("目标/参照关联键数量不一致")
    return [(_require_identifier(tk, "目标关联键"), _require_identifier(rk, "参照关联键"))
            for tk, rk in zip(target_keys, ref_keys)]


def stat_call(op: str, column: str) -> str:
    if op == "COUNT":
        return "COUNT(*)"
    return f"{op}({column})"


def prefixed_projection(evidence_columns: list[dict[str, str]], prefix: str = "t") -> str:
    return ", ".join(f"{prefix}.`{item['name']}`" for item in evidence_columns)


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
