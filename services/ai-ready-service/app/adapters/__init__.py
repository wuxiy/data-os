"""评估探针的数据面 Adapter：Doris（只读 SQL 指标）、OpenMetadata（元数据探针）
与 RustFS（S3 兼容产物面对拍）。

三者都以最小接口暴露给 engine：DorisAdapter.metric(sql)、OpenMetadataAdapter /
RustFSAdapter 上的探针方法。连接参数全部来自 settings。
"""
from __future__ import annotations

import os
import time
from typing import Any

import httpx
import pymysql
import yaml


def rustfs_client(settings: Any):
    """S3 兼容客户端（RustFS）：端点/凭据 env 优先、settings 兜底。
    构建面（api /build）与评估探针（RustFSAdapter）共用同一装配口径。"""
    import boto3
    endpoint = (os.environ.get("DATAOS_RUSTFS_ENDPOINT")
                or getattr(settings, "rustfs_endpoint", "http://rustfs:9000"))
    return boto3.client(
        "s3", endpoint_url=endpoint,
        aws_access_key_id=os.environ.get("DATAOS_RUSTFS_ACCESS_KEY", ""),
        aws_secret_access_key=os.environ.get("DATAOS_RUSTFS_SECRET_KEY", ""),
        region_name="us-east-1")


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

    def execute_many(self, sql: str, args_list: list[tuple]) -> int:
        """批量写（单连接 executemany）：行级独立连接在千行语料上慢到网关超时
        （G18 实测 1967 行仅写入 362 行即 504）。返回受影响行数。"""
        if not args_list:
            return 0
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
                affected = cursor.executemany(sql, args_list)
            connection.commit()
            return int(affected) if affected and affected > 0 else len(args_list)
        finally:
            connection.close()

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

    def column_description_coverage(self, check: dict) -> float:
        """声明清单（tables: {schema.table: [列名]}）内核心列描述非空占比。"""
        service = check["service"]
        database_segment = check.get("database", "default")
        described = total = 0
        for table_suffix, columns in check["tables"].items():
            fqn = f"{service}.{database_segment}.{table_suffix}"
            table = self._get(f"/tables/name/{fqn}?fields=columns")
            by_name = {column.get("name"): column for column in table.get("columns", []) or []}
            for name in columns:
                total += 1
                if str((by_name.get(name) or {}).get("description") or "").strip():
                    described += 1
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


class RustFSAdapter:
    """产物对象面探针（G20）：RustFS 最新版本清单与 Doris 产物表对拍。
    client_factory 注入点供测试替换；生产默认走 rustfs_client(settings)。"""

    def __init__(self, settings: Any, doris: Any, client_factory=None):
        self._settings = settings
        self._doris = doris
        self._client_factory = client_factory or (lambda: rustfs_client(settings))

    # ---- 探针实现（engine 按 requirement.check.probe 路由）----

    def artifact_availability(self, check: dict) -> float:
        """最新对象版本 chunks.jsonl 行数 == Doris 产物表 COUNT(*) 时 1.0。
        对象面无版本、产物表空、行数不一致均为 0.0（双落缺面或错位是真缺陷）。"""
        table = check["requires_table"]
        rows = self._doris.query(f"SELECT COUNT(*) FROM {table}", ())
        doris_count = int(rows[0][0]) if rows else 0
        client = self._client_factory()
        bucket = check.get("bucket") or os.environ.get("DATAOS_AI_BUCKET", "dataos-ai-data")
        prefix = check["prefix"]
        latest = self._latest_version(client, bucket, prefix)
        if latest is None or doris_count == 0:
            return 0.0
        body = client.get_object(
            Bucket=bucket, Key=f"{prefix}/{latest}/data/chunks.jsonl")["Body"].read()
        lines = sum(1 for line in body.decode("utf-8").splitlines() if line.strip())
        return 1.0 if lines == doris_count else 0.0

    def deidentified_claim(self, check: dict, version: str) -> float:
        """清单探针（G21-4）：评估版本 manifest.yaml 的 spec.privacy.deidentified
        声明为 True 时 1.0；清单缺失/未声明/声明为否均 0.0——脱敏主张必须有
        对应构建版本的清单证据，不许无据默认。"""
        client = self._client_factory()
        bucket = check.get("bucket") or os.environ.get("DATAOS_AI_BUCKET", "dataos-ai-data")
        prefix = check["prefix"]
        key = f"{prefix}/{version}/manifest.yaml"
        try:
            body = client.get_object(Bucket=bucket, Key=key)["Body"].read()
        except client.exceptions.ClientError as exc:
            raise RuntimeError(f"清单不存在：{key}（{exc}）") from exc
        manifest = yaml.safe_load(body.decode("utf-8")) or {}
        privacy = (manifest.get("spec") or {}).get("privacy") or {}
        return 1.0 if privacy.get("deidentified") is True else 0.0

    @staticmethod
    def _latest_version(client, bucket: str, prefix: str) -> str | None:
        """沿 rag_builder.next_version 同一口径探测：manifest.yaml 存在即版本在册，
        返回最后一个在册版本（探测链断口即最新）。"""
        version = "v1.0.0"
        latest = None
        while True:
            try:
                client.head_object(Bucket=bucket, Key=f"{prefix}/{version}/manifest.yaml")
                latest = version
                major, minor, patch = version[1:].split(".")
                version = f"v{major}.{minor}.{int(patch) + 1}"
            except client.exceptions.ClientError:
                return latest
