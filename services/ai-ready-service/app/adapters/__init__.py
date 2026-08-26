"""评估探针的数据面 Adapter：Doris（只读 SQL 指标）与 OpenMetadata（元数据探针）。

两者都以最小接口暴露给 engine：DorisAdapter.metric(sql) 与
OpenMetadataAdapter 上的三个探针方法。连接参数全部来自 settings。
"""
from __future__ import annotations

import time
from typing import Any

import httpx
import pymysql


class DorisAdapter:
    """只读 SQL 指标面：check.sql 必须返回单行单列数值。"""

    def __init__(self, settings: Any):
        self._settings = settings

    def table_exists(self, database: str, table: str) -> bool:
        sql = "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = %s AND table_name = %s"
        rows = self.query(sql, (database, table))
        return bool(rows and int(rows[0][0]) > 0)

    def metric(self, sql: str) -> float:
        rows = self.query(sql, ())
        if not rows or len(rows[0]) != 1:
            raise RuntimeError("check.sql 必须返回单行单列数值指标")
        return float(rows[0][0])

    def query(self, sql: str, args: tuple) -> list[tuple]:
        connection = pymysql.connect(
            host=self._settings.doris_host,
            port=self._settings.doris_port,
            user=self._settings.doris_user,
            password=self._settings.doris_password,
            connect_timeout=int(self._settings.doris_connect_timeout_s),
            charset="utf8mb4",
            cursorclass=pymysql.cursors.Cursor,
        )
        try:
            with connection.cursor() as cursor:
                cursor.execute(sql, args)
                return list(cursor.fetchall())
        finally:
            connection.close()


class OpenMetadataAdapter:
    """OM 1.5 只读探针：client credentials 自签令牌（dataos-om-ingest 同模式）。"""

    def __init__(self, settings: Any, client: httpx.Client | None = None):
        self._settings = settings
        self._token = ""
        self._token_expires_at = 0.0
        self._client = client or httpx.Client(verify=False, timeout=10.0)

    def _ensure_token(self) -> str:
        if self._token and self._token_expires_at > time.time() + 30:
            return self._token
        response = self._client.post(self._settings.om_token_uri, data={
            "grant_type": "client_credentials",
            "client_id": self._settings.om_client_id,
            "client_secret": self._settings.om_client_secret,
        })
        response.raise_for_status()
        payload = response.json()
        self._token = str(payload["access_token"])
        self._token_expires_at = time.time() + float(payload.get("expires_in", 300))
        return self._token

    def _get(self, path: str) -> dict:
        response = self._client.get(
            self._settings.om_base_url.rstrip("/") + path,
            headers={"Authorization": f"Bearer {self._ensure_token()}"},
        )
        response.raise_for_status()
        return response.json()

    # ---- 探针实现（engine 按 requirement.check.probe 路由）----

    def table_description_coverage(self, check: dict) -> float:
        """schema 清单内表描述非空占比。"""
        service = check["service"]
        database_segment = check.get("database", "default")
        described = total = 0
        for schema in check["schemas"]:
            data = self._get(
                f"/tables?database={service}.{database_segment}.{schema}&limit=100").get("data", [])
            total += len(data)
            described += sum(1 for table in data if str(table.get("description") or "").strip())
        return described / total if total else 0.0

    def lineage_edge_coverage(self, check: dict) -> float:
        """根表下游血缘边覆盖：实际边数 / 期望边数（封顶 1.0）。"""
        graph = self._get(
            f"/lineage/table/name/{check['root']}?upstreamDepth=0&downstreamDepth=2")
        edges = graph.get("downstreamEdges", []) or []
        expected = max(int(check.get("expected_edges", 1)), 1)
        return min(len(edges) / expected, 1.0)

    def pii_tag_coverage(self, check: dict) -> float:
        """声明列中被打上目标分类标签的占比。"""
        table = self._get(f"/tables/name/{check['table']}?fields=columns,tags")
        tag_prefix = str(check.get("tag", "PersonalData"))
        wanted = list(check.get("columns", []))
        tagged = 0
        for column in table.get("columns", []):
            if column.get("name") not in wanted:
                continue
            fqns = [str(t.get("tagFQN") or t.get("fullyQualifiedName") or "")
                    for t in column.get("tags", []) or []]
            if any(fqn == tag_prefix or fqn.startswith(tag_prefix + ".") for fqn in fqns):
                tagged += 1
        return tagged / len(wanted) if wanted else 0.0
