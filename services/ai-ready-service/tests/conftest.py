"""共享测试件：Stub 探针与全 PASS 基线指标。"""
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
REPO = REPO_ROOT / "ai-ready"


def all_pass_metrics() -> dict[str, float]:
    return {
        "null_ratio": 0.0, "trusted_ratio": 1.0, "coverage_ratio": 1.0,
        "hours_since_update": 1.0, "plaintext_hit_ratio": 0.0,
        "semantic_documentation": 1.0, "lineage_completeness": 1.0, "pii_classification": 1.0,
    }


class StubDoris:
    """按 check.sql 的指标列名返回固定值；table_exists 受控。"""

    def __init__(self, metrics: dict[str, float], existing_tables: set[str] | None = None):
        self._metrics = metrics
        self._existing = existing_tables or set()

    def table_exists(self, database: str, table: str) -> bool:
        return f"{database}.{table}" in self._existing

    def metric(self, sql: str) -> float:
        return self._metrics[self._metric_name(sql)]

    @staticmethod
    def _metric_name(sql: str) -> str:
        for line in sql.splitlines():
            if " AS " in line:
                return line.split(" AS ")[-1].strip()
        raise AssertionError("check.sql 未命名指标列")


class StubOm:
    def __init__(self, metrics: dict[str, float]):
        self._metrics = metrics

    def table_description_coverage(self, check: dict) -> float:
        return self._metrics["semantic_documentation"]

    def lineage_edge_coverage(self, check: dict) -> float:
        return self._metrics["lineage_completeness"]

    def pii_tag_coverage(self, check: dict) -> float:
        return self._metrics["pii_classification"]
