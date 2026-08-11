from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


class ArtifactStore:
    def __init__(self, local_dir: str, endpoint: str, bucket: str, region: str,
                 access_key: str, secret_key: str):
        self.local_dir = Path(local_dir)
        self.local_dir.mkdir(parents=True, exist_ok=True)
        self.endpoint = endpoint
        self.bucket = bucket
        self.region = region
        self.access_key = access_key
        self.secret_key = secret_key
        self._s3 = None
        if endpoint and access_key and secret_key:
            import boto3
            self._s3 = boto3.client(
                "s3", endpoint_url=endpoint, region_name=region,
                aws_access_key_id=access_key, aws_secret_access_key=secret_key,
            )

    def store(self, tenant_namespace: str, run_id: str, summary: dict[str, Any]) -> str:
        body = json.dumps(summary, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        key = f"quality-runs/{tenant_namespace}/{run_id}/summary.json"
        if self._s3 is not None:
            self._s3.put_object(Bucket=self.bucket, Key=key, Body=body,
                                ContentType="application/json", ServerSideEncryption="AES256")
            return f"s3://{self.bucket}/{key}"
        path = self.local_dir / tenant_namespace / run_id / "summary.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        return str(path)

    def cleanup(self, retention_days: int) -> int:
        cutoff = datetime.now(timezone.utc) - timedelta(days=retention_days)
        deleted = 0
        if self._s3 is not None:
            paginator = self._s3.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=self.bucket, Prefix="quality-runs/"):
                for item in page.get("Contents", []):
                    modified = item.get("LastModified")
                    if modified and modified < cutoff:
                        self._s3.delete_object(Bucket=self.bucket, Key=item["Key"])
                        deleted += 1
            return deleted
        if not self.local_dir.exists():
            return 0
        for path in self.local_dir.glob("**/summary.json"):
            modified = datetime.fromtimestamp(path.stat().st_mtime, timezone.utc)
            if modified < cutoff:
                path.unlink(missing_ok=True)
                try:
                    path.parent.rmdir()
                except OSError:
                    pass
                deleted += 1
        return deleted
