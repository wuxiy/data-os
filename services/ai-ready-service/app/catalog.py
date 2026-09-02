"""声明仓库加载器：ai-ready/ 的 YAML 是评分口径唯一来源。

只做解析与一致性校验（requirement 引用、profile 覆盖、阈值齐全），
不做业务判断——聚合与门禁在 engine。
"""
from __future__ import annotations

import os
from dataclasses import dataclass

import yaml

from models import ProfileDef, RequirementDef


class CatalogError(RuntimeError):
    pass


@dataclass(frozen=True)
class Catalog:
    requirements: dict[str, RequirementDef]
    profiles: dict[str, ProfileDef]
    policy: dict

    def requirement_ids(self, profile_id: str) -> list[str]:
        profile = self.profiles.get(profile_id)
        if profile is None:
            raise CatalogError(f"未知 Profile：{profile_id}")
        missing = [rid for rid in profile.requirements if rid not in self.requirements]
        if missing:
            raise CatalogError(f"Profile {profile_id} 引用了未定义的 requirement：{missing}")
        return list(profile.requirements.keys())

    def gate_thresholds(self, profile_id: str) -> dict[str, float]:
        profile = self.profiles[profile_id]
        policy_gate = self.policy.get("gate", {})
        return {
            "fail_below": profile.thresholds.get("fail_below", policy_gate.get("fail_below", 0.70)),
            "review_below": profile.thresholds.get("review_below", policy_gate.get("review_below", 0.85)),
        }


def _load_yaml(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


def _check_thresholds(check: dict, rid: str) -> None:
    for key in ("direction", "pass", "warn"):
        if key not in check:
            raise CatalogError(f"requirement {rid} 的 check 缺少 {key}")
    if check["direction"] not in ("higher_better", "lower_better"):
        raise CatalogError(f"requirement {rid} 的 direction 非法：{check['direction']}")


# om_probe 各探针的必需键（与 adapters 的消费面一致）：声明 typo 在装载期
# 即爆，而不是评估期坍缩成「数据质量 FAIL」。
_PROBE_REQUIRED_KEYS = {
    "table_description_coverage": ("service", "schemas"),
    "lineage_edge_coverage": ("service", "root"),
    "pii_tag_coverage": ("service", "table", "columns"),
}


def _check_shape(check: dict, rid: str) -> None:
    _check_thresholds(check, rid)
    check_type = check.get("type")
    if check_type == "doris_metric":
        metric = check.get("metric")
        if not isinstance(metric, str) or not metric.strip():
            raise CatalogError(f"requirement {rid} 的 doris_metric check 缺少 metric")
        if not check.get("sql_file") and not check.get("requires_table"):
            raise CatalogError(
                f"requirement {rid} 的 doris_metric check 须声明 sql_file 或 requires_table（N/A 条件）")
    elif check_type == "om_probe":
        probe = check.get("probe")
        required = _PROBE_REQUIRED_KEYS.get(probe)
        if required is None:
            raise CatalogError(f"requirement {rid} 的 om_probe 探针未知：{probe}"
                               f"（已知：{sorted(_PROBE_REQUIRED_KEYS)}）")
        for key in required:
            value = check.get(key)
            if value is None or value == "" or value == []:
                raise CatalogError(f"requirement {rid} 的 {probe} 探针缺少 {key}")
    else:
        raise CatalogError(f"requirement {rid} 的 check.type 非法：{check_type}"
                           f"（已知：doris_metric / om_probe）")


def load_catalog(repo_dir: str) -> Catalog:
    requirements: dict[str, RequirementDef] = {}
    req_root = os.path.join(repo_dir, "requirements")
    for dimension in sorted(os.listdir(req_root)):
        dim_dir = os.path.join(req_root, dimension)
        if not os.path.isdir(dim_dir):
            continue
        for name in sorted(os.listdir(dim_dir)):
            req_dir = os.path.join(dim_dir, name)
            manifest = os.path.join(req_dir, "requirement.yaml")
            if not os.path.isfile(manifest):
                continue
            doc = _load_yaml(manifest)
            _check_shape(doc.get("check", {}), doc.get("id", name))
            req = RequirementDef(**doc, dir_path=req_dir)
            if req.id in requirements:
                raise CatalogError(f"requirement 重复定义：{req.id}")
            sql_file = req.check.get("sql_file")
            if req.check.get("type") == "doris_metric" and sql_file:
                if not os.path.isfile(os.path.join(req_dir, sql_file)):
                    raise CatalogError(f"requirement {req.id} 的 check.sql 不存在：{sql_file}")
            requirements[req.id] = req

    profiles: dict[str, ProfileDef] = {}
    profile_root = os.path.join(repo_dir, "profiles")
    for name in sorted(os.listdir(profile_root)):
        if not name.endswith(".yaml"):
            continue
        doc = _load_yaml(os.path.join(profile_root, name))
        profile = ProfileDef(**doc)
        profiles[profile.id] = profile

    policy_dir = os.path.join(repo_dir, "policies")
    policy: dict = {}
    for name in sorted(os.listdir(policy_dir)) if os.path.isdir(policy_dir) else []:
        if name.endswith(".yaml"):
            policy = _load_yaml(os.path.join(policy_dir, name))

    if not requirements or not profiles:
        raise CatalogError("声明仓库不完整：requirements/profiles 为空")

    # 每个 requirement 至少被一个 profile 引用（防孤儿声明）
    referenced: set[str] = set()
    for profile in profiles.values():
        referenced.update(profile.requirements)
    orphans = sorted(set(requirements) - referenced)
    if orphans:
        raise CatalogError(f"未被任何 Profile 引用的 requirement：{orphans}")

    return Catalog(requirements=requirements, profiles=profiles, policy=policy)
