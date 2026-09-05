"""异步导出编排（P7，H3）：submit 校验后创建控制面任务并起后台 worker；
worker 以 CAS 认领任务，流式执行 Doris 查询写入 CSV，上传对象存储，
终态回写控制面并按 kind=export 计审计。产物经下载端点鉴权回放，
不走 presigned URL（内网 host 浏览器不可达，且统一走既有认证与限流面）。
"""
from __future__ import annotations

import csv
import json
import logging
import tempfile
import threading
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from executor import ParameterError, enforce_hospital_scope, render, validate_parameters
from session import ScopeInvalid

logger = logging.getLogger(__name__)


def stream_to_csv(sql: str, args: tuple, settings: Any, path: Path,
                  max_rows: int, timeout_s: int) -> tuple[int, bool]:
    """流式执行并写 CSV（utf-8-sig，Excel 可直接打开中文）；返回 (行数, 截断)。"""
    import pymysql

    connection = pymysql.connect(
        host=settings.doris_host,
        port=settings.doris_port,
        user=settings.doris_user,
        password=settings.doris_password,
        connect_timeout=settings.doris_connect_timeout_s,
        read_timeout=timeout_s,
        write_timeout=timeout_s,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.SSCursor,
    )
    try:
        with connection.cursor() as cursor:
            cursor.execute(sql, args)
            columns = [column[0] for column in cursor.description or []]
            count = 0
            truncated = False
            with open(path, "w", newline="", encoding="utf-8-sig") as handle:
                writer = csv.writer(handle)
                writer.writerow(columns)
                for row in cursor:
                    if count >= max_rows:
                        truncated = True
                        break
                    writer.writerow(["" if value is None else value for value in row])
                    count += 1
            return count, truncated
    finally:
        connection.close()


class ExportManager:
    """导出生命周期单一属主：提交、执行、查询、下载、恢复与维护。"""

    def __init__(self, control_plane: Any, settings: Any, artifacts: Any):
        self._control_plane = control_plane
        self._settings = settings
        self._artifacts = artifacts
        self._semaphore = threading.BoundedSemaphore(max(settings.export_concurrency, 1))
        self._workers: dict[str, threading.Thread] = {}

    # ---- 提交与执行 ----

    def submit(self, code: str, key: dict[str, Any], parameters: dict[str, Any],
               validated_values: dict[str, Any]) -> str:
        """同步校验后创建任务（PENDING）并启动 worker；返回 export_id。"""
        created = self._control_plane.create_export(
            code, str(key.get("keyHash", "")),
            json.dumps(parameters, ensure_ascii=False, sort_keys=True))
        export_id = str(created["id"])
        self._spawn(export_id, code, validated_values, key)
        return export_id

    def _spawn(self, export_id: str, code: str, values: dict[str, Any], key: dict[str, Any]) -> None:
        existing = self._workers.get(export_id)
        if existing is not None and existing.is_alive():
            return
        worker = threading.Thread(target=self._run, args=(export_id, code, values, key),
                                  name=f"export-{export_id[:8]}", daemon=True)
        self._workers[export_id] = worker
        worker.start()

    def _run(self, export_id: str, code: str, values: dict[str, Any], key: dict[str, Any]) -> None:
        with self._semaphore:
            self._execute(export_id, code, values, key)

    def _execute(self, export_id: str, code: str, values: dict[str, Any], key: dict[str, Any]) -> None:
        try:
            claimed = self._control_plane.claim_export(export_id)
        except Exception:
            claimed = True  # 控制面暂不可达：仍尝试执行（终态回写会重试路径覆盖）
        if not claimed:
            return  # 已被认领（启动拾取竞态）
        service = self._control_plane.find_service(code)
        if service is None:
            self._finalize_failure(export_id, code, key, f"服务不存在或未发布: {code}", 0)
            return
        started = time.monotonic()
        try:
            allowed = _hospitals_of(key)
            try:
                contracts = json.loads(service.get("parameters") or "[]")
            except ValueError:
                contracts = []
            enforce_hospital_scope(values, contracts, allowed)
            sql, args = render(str(service["sqlTemplate"]), values)
            with tempfile.TemporaryDirectory(prefix="dataos-export-") as workdir:
                path = Path(workdir) / f"{export_id}.csv"
                row_count, truncated = stream_to_csv(
                    sql, args, self._settings, path,
                    int(self._settings.export_max_rows), int(self._settings.export_timeout_s))
                file_bytes = path.stat().st_size
                artifact_uri = self._artifacts.store(export_id, path)
            expires_at = (datetime.now(timezone.utc)
                          + timedelta(days=int(self._settings.export_retention_days))).isoformat()
            self._control_plane.finalize_export(
                export_id, "SUCCEEDED", row_count=row_count, file_bytes=file_bytes,
                artifact_uri=artifact_uri, expires_at=expires_at)
            self._control_plane.report_call(
                code, str(key.get("keyHash", "")), "", row_count, truncated,
                int((time.monotonic() - started) * 1000), 200, kind="export")
            logger.info("导出完成 %s：rows=%d bytes=%d", export_id, row_count, file_bytes)
        except ScopeInvalid as exc:
            self._finalize_failure(export_id, code, key, str(exc),
                                   int((time.monotonic() - started) * 1000), 403)
        except PermissionError as exc:
            self._finalize_failure(export_id, code, key, str(exc),
                                   int((time.monotonic() - started) * 1000), 403)
        except ParameterError as exc:
            self._finalize_failure(export_id, code, key, str(exc),
                                   int((time.monotonic() - started) * 1000), 400)
        except Exception as exc:  # noqa: BLE001  Doris/存储失败统一终态
            logger.exception("导出失败 %s", export_id)
            self._finalize_failure(export_id, code, key, "查询引擎或对象存储暂不可用",
                                   int((time.monotonic() - started) * 1000), 503)

    def _finalize_failure(self, export_id: str, code: str, key: dict[str, Any],
                          message: str, elapsed_ms: int, status_code: int) -> None:
        try:
            self._control_plane.finalize_export(export_id, "FAILED", error=message[:512])
        except Exception:  # noqa: BLE001
            logger.exception("导出终态回写失败 %s", export_id)
        try:
            self._control_plane.report_call(code, str(key.get("keyHash", "")), "", 0, False,
                                            elapsed_ms, status_code, kind="export")
        except Exception:  # noqa: BLE001
            pass

    # ---- 查询与下载（调用方面）----

    def status(self, export_id: str, key_hash: str) -> dict[str, Any] | None:
        """归属校验后的任务投影；非本人任务与不存在同观（不泄漏存在性）。"""
        try:
            projection = self._control_plane.get_export(export_id)
        except Exception:  # noqa: BLE001
            return None
        if projection.get("keyHash") != key_hash:
            return None
        return projection

    def download(self, export_id: str, key_hash: str) -> tuple[str, bytes]:
        projection = self.status(export_id, key_hash)
        if projection is None:
            raise ExportNotFound()
        status_name = str(projection.get("status"))
        if status_name == "EXPIRED" or _expired(projection.get("expiresAt")):
            raise ExportExpired()
        if status_name != "SUCCEEDED":
            raise ExportNotReady(status_name)
        artifact_uri = str(projection.get("artifactUri", ""))
        try:
            content = self._artifacts.fetch(artifact_uri)
        except Exception as exc:  # noqa: BLE001
            logger.exception("导出产物读取失败 %s", export_id)
            raise ExportNotReady(status_name) from exc
        filename = f"{projection.get('serviceCode', 'export')}-{export_id}.csv"
        return filename, content

    # ---- 恢复与维护 ----

    def recover(self) -> dict[str, int]:
        """启动恢复：孤儿 RUNNING 清算 + PENDING 拾取（单实例口径）。"""
        reaped = self._control_plane.reap_stale_exports()
        picked = 0
        for item in self._control_plane.pending_exports():
            export_id = str(item.get("id", ""))
            code = str(item.get("serviceCode", ""))
            key_hash = str(item.get("keyHash", ""))
            key = self._control_plane.find_key(key_hash)
            if key is None or not code:
                continue
            try:
                parameters = json.loads(item.get("parametersJson") or "{}")
                contracts = json.loads(
                    (self._control_plane.find_service(code) or {}).get("parameters") or "[]")
                values = validate_parameters(contracts, parameters)
            except Exception:  # noqa: BLE001
                self._finalize_failure(export_id, code, key, "参数无法解析（拾取）", 0, 400)
                continue
            self._spawn(export_id, code, values, key)
            picked += 1
        return {"reaped": reaped, "picked": picked}

    def maintenance(self) -> dict[str, int]:
        """周期维护：产物超龄清理 + 控制面到期标记。"""
        removed = self._artifacts.cleanup(int(self._settings.export_retention_days))
        expired = self._control_plane.expire_exports()
        return {"artifactsRemoved": removed, "exportsExpired": expired}


class ExportNotFound(LookupError):
    """任务不存在或不属于当前 Key。"""


class ExportExpired(Exception):
    """产物已过保留期。"""


class ExportNotReady(Exception):
    """任务未到 SUCCEEDED（或产物暂不可读）。"""

    def __init__(self, status: str):
        super().__init__(status)
        self.status = status


def _expired(expires_at: Any) -> bool:
    if not expires_at:
        return False
    try:
        return datetime.fromisoformat(str(expires_at)) <= datetime.now(timezone.utc)
    except ValueError:
        return False


def _hospitals_of(key: dict[str, Any]) -> list[str]:
    """与 session.CallSession.hospitals 同语义（fail-closed）。"""
    raw = key.get("allowedHospitals")
    if raw is None or raw == "":
        return ["*"]
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError as exc:
            raise ScopeInvalid("Key 的医院授权配置损坏（坏 JSON），已拒绝执行") from exc
    if not isinstance(raw, list):
        raise ScopeInvalid("Key 的医院授权配置损坏（非数组），已拒绝执行")
    return [str(item) for item in raw]
