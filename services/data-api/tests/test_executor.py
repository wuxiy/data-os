"""执行器单测：契约校验、行级授权、占位渲染。"""
from __future__ import annotations

import pytest

from executor import (ParameterError, enforce_hospital_scope, parameters_json_of,
                      render, validate_parameters)

CONTRACTS = [
    {"name": "start_date", "type": "date", "required": True},
    {"name": "hospital_code", "type": "string", "required": False, "values": ["H001", "H002"]},
    {"name": "limit", "type": "number", "required": False, "defaultValue": "10"},
    {"name": "verbose", "type": "boolean", "required": False},
]


def test_required_missing_rejected():
    with pytest.raises(ParameterError, match="start_date"):
        validate_parameters(CONTRACTS, {})


def test_type_validation():
    values = validate_parameters(CONTRACTS, {"start_date": "2026-08-01"})
    assert values["start_date"] == "2026-08-01"
    assert values["limit"] == 10  # default 填充并转数值
    with pytest.raises(ParameterError, match="日期"):
        validate_parameters(CONTRACTS, {"start_date": "2026/08/01"})
    with pytest.raises(ParameterError, match="数值"):
        validate_parameters(CONTRACTS, {"start_date": "2026-08-01", "limit": "abc"})
    with pytest.raises(ParameterError, match="布尔"):
        validate_parameters(CONTRACTS, {"start_date": "2026-08-01", "verbose": "yes"})


def test_unknown_parameter_rejected():
    with pytest.raises(ParameterError, match="未声明"):
        validate_parameters(CONTRACTS, {"start_date": "2026-08-01", "evil": "1"})


def test_enum_restriction():
    with pytest.raises(ParameterError, match="允许取值"):
        validate_parameters(CONTRACTS, {"start_date": "2026-08-01", "hospital_code": "H999"})


def test_hospital_scope_enforced():
    values = {"hospital_code": "H001"}
    enforce_hospital_scope(values, CONTRACTS, ["H001", "H002"])
    enforce_hospital_scope(values, CONTRACTS, ["*"])
    with pytest.raises(PermissionError):
        enforce_hospital_scope({"hospital_code": "H003"}, CONTRACTS, ["H001", "H002"])


def test_render_binds_in_order_and_never_concatenates():
    sql, args = render(
        "SELECT :b AS x, :a AS y FROM t WHERE d BETWEEN :a AND :b",
        {"a": "2026-08-01", "b": "2026-08-31"})
    assert sql == "SELECT %s AS x, %s AS y FROM t WHERE d BETWEEN %s AND %s"
    assert args == ("2026-08-31", "2026-08-01", "2026-08-01", "2026-08-31")


def test_parameters_json_is_stable():
    assert parameters_json_of({"b": "1", "a": "2"}) == '{"a": "2", "b": "1"}'
