-- 采集链路新鲜度：活跃采集链路（G16b SeaTunnel 直连 DM）水位表距最近更新的小时数。
-- 2026-09-15（G17）：从边缘模拟表 ep_mz_cfzb_edge（G5 链路已收档，末次 2026-08-20）
-- 重绑到活跃链路落库表 ep_mz_cfzb 的 UPDATE_TIME 水位。
SELECT ROUND((UNIX_TIMESTAMP() - UNIX_TIMESTAMP(MAX(UPDATE_TIME))) / 3600.0, 2) AS hours_since_update
FROM ods_ep.ep_mz_cfzb
