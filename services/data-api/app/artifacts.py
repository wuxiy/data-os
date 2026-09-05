"""导出产物对象存储（P7）：RustFS artifacts 模式（quality-runner
ArtifactStore）的第二消费者——同惯例自抄而非共享库（服务镜像独立、
依赖树独立）。S3 四件套缺省时退化为本地目录存储（dev/测试）。
"""
from __future__ import annotations

import logging
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


class ExportArtifactStore:
    """put/fetch/delete/cleanup：key 布局 data-api-exports/{export_id}.csv。"""

    def __init__(self, settings: Any):
        self._settings = settings
        self._prefix = "data-api-exports"
        self._local_dir = Path(settings.export_dir)
        self._s3: Any | None = None
        if settings.s3_endpoint and settings.s3_access_key and settings.s3_secret_key:
            import boto3  # 按需导入：本地退化模式不需要 boto3

            self._s3 = boto3.client(
                "s3",
                endpoint_url=settings.s3_endpoint,
                region_name=settings.s3_region,
                aws_access_key_id=settings.s3_access_key,
                aws_secret_access_key=settings.s3_secret_key,
            )
        else:
            self._local_dir.mkdir(parents=True, exist_ok=True)
            logger.warning("S3 未配置，导出产物落本地目录 %s（仅限开发/测试）", self._local_dir)

    @property
    def remote(self) -> bool:
        return self._s3 is not None

    def store(self, export_id: str, path: Path) -> str:
        """上传导出文件，返回产物 URI（s3://bucket/key 或 file:///路径）。"""
        key = f"{self._prefix}/{export_id}.csv"
        if self._s3 is None:
            target = self._local_dir / f"{export_id}.csv"
            target.write_bytes(path.read_bytes())
            return target.as_uri()
        self._s3.upload_file(
            str(path), self._settings.s3_bucket, key,
            ExtraArgs={"ContentType": "text/csv", "ServerSideEncryption": "AES256"})
        return f"s3://{self._settings.s3_bucket}/{key}"

    def fetch(self, artifact_uri: str) -> bytes:
        """下载回放（下载端点用）。仅接受本存储写入的 URI 形态。"""
        if artifact_uri.startswith("file://"):
            return Path(artifact_uri[len("file://"):]).read_bytes()
        if not artifact_uri.startswith("s3://") or self._s3 is None:
            raise ValueError(f"产物 URI 不可读: {artifact_uri}")
        key = artifact_uri[len(f"s3://{self._settings.s3_bucket}/"):]
        response = self._s3.get_object(Bucket=self._settings.s3_bucket, Key=key)
        return response["Body"].read()

    def delete(self, artifact_uri: str) -> None:
        if artifact_uri.startswith("file://"):
            Path(artifact_uri[len("file://"):]).unlink(missing_ok=True)
        elif artifact_uri.startswith(f"s3://{self._settings.s3_bucket}/") and self._s3 is not None:
            key = artifact_uri[len(f"s3://{self._settings.s3_bucket}/"):]
            self._s3.delete_object(Bucket=self._settings.s3_bucket, Key=key)

    def cleanup(self, retention_days: int) -> int:
        """生命周期清理：删除超龄产物（S3 分页遍历 / 本地 mtime）。"""
        cutoff = time.time() - retention_days * 86400
        removed = 0
        if self._s3 is None:
            for path in self._local_dir.glob("*.csv"):
                if path.stat().st_mtime < cutoff:
                    path.unlink(missing_ok=True)
                    removed += 1
            return removed
        paginator = self._s3.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=self._settings.s3_bucket, Prefix=f"{self._prefix}/"):
            for item in page.get("Contents", []):
                if item["LastModified"].timestamp() < cutoff:
                    self._s3.delete_object(Bucket=self._settings.s3_bucket, Key=item["Key"])
                    removed += 1
        return removed
