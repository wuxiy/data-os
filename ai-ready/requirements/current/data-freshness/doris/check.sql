-- 增量链路新鲜度：边缘表最近更新距现在的小时数
SELECT ROUND((UNIX_TIMESTAMP() - UNIX_TIMESTAMP(MAX(UPDATE_TIME))) / 3600.0, 2) AS hours_since_update
FROM ods_ep.ep_mz_cfzb_edge
