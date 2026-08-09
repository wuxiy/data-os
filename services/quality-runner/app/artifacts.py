from __future__ import annotations

import json
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

    def store(self, run_id: str, summary: dict[str, Any]) -> str:
        body = json.dumps(summary, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        key = f"quality-runs/{run_id}/summary.json"
        if self._s3 is not None:
            self._s3.put_object(Bucket=self.bucket, Key=key, Body=body,
                                ContentType="application/json", ServerSideEncryption="AES256")
            return f"s3://{self.bucket}/{key}"
        path = self.local_dir / run_id / "summary.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        return str(path)
