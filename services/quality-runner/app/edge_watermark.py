"""前置机采集水位（G2G 批次 4 第二刀）：GET /api/v1/edge/watermarks。

同步只读聚合契约（与 G23 映射聚合验证同款纪律）：只查白名单边缘增量表
（ods_ep.ep_mz_cfzb_edge / ep_mz_ypcfmx_edge），只做 COUNT / MAX /
按日聚合计数——绝不返回原始行或患者数据；表名不走调用方输入。
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import APIRouter, Depends

from security import Principal, check_scope, principal

# 白名单：水位列统一为入仓侧 UPDATE_TIME（与 ods_ep 直连表逐列一致）
EDGE_TABLES: dict[str, tuple[str, str]] = {
    "cfzb": ("ods_ep", "ep_mz_cfzb_edge"),
    "ypcfmx": ("ods_ep", "ep_mz_ypcfmx_edge"),
}


def router(doris_query: Callable[[str], list[tuple]]) -> APIRouter:
    api = APIRouter(prefix="/api/v1/edge")

    @api.get("/watermarks")
    def watermarks(current: Principal = Depends(principal)) -> dict[str, Any]:
        check_scope(current, "quality:read")
        tables = []
        for key, (database, table) in EDGE_TABLES.items():
            total = doris_query(f"SELECT COUNT(*) FROM `{database}`.`{table}`")
            latest = doris_query(
                f"SELECT MAX(`UPDATE_TIME`) FROM `{database}`.`{table}`")
            daily = doris_query(
                f"SELECT DATE(`UPDATE_TIME`), COUNT(*) FROM `{database}`.`{table}` "
                f"WHERE `UPDATE_TIME` >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) "
                f"GROUP BY DATE(`UPDATE_TIME`) ORDER BY 1")
            tables.append({
                "key": key,
                "dataset": f"{database}.{table}",
                "totalRows": int(total[0][0]) if total else 0,
                "latestWriteAt": str(latest[0][0]) if latest and latest[0][0] else None,
                "dailyCounts": [
                    {"date": str(day), "count": int(count)}
                    for day, count in daily
                ],
            })
        return {
            "asOf": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "tables": tables,
        }

    return api
