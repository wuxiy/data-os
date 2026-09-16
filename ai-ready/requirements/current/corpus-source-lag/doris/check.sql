-- 语料构建水位（G20 corpus_source_lag）：产物表最后构建时间落后源活跃水位的时长（小时）；
-- 负值（语料新于源）按 0 收口，不奖励提前量。
-- 口径注意：built_at 为 UTC ISO8601 字符串、UPDATE_TIME 为源端本地 DATETIME，两侧统一
-- 提取壁钟后经 UNIX_TIMESTAMP 比较，含 <=8h 时区系统性偏差——dev 口径（pass 0 / warn 720h）
-- 下不影响判定；生产另立 SLA 时应改为统一时区存储后重校（gate 记录在案）。
-- 空产物表按「纪元 0」参与比较：lag 巨大 -> FAIL（空产物是真缺陷，对齐 G17 空表判缺口径）。
SELECT ROUND(GREATEST(
         (SELECT (UNIX_TIMESTAMP() - UNIX_TIMESTAMP(MAX(UPDATE_TIME))) / 3600.0
            FROM ods_ep.ep_mz_cfzb)
       - (SELECT (UNIX_TIMESTAMP() - COALESCE(UNIX_TIMESTAMP(REPLACE(SUBSTR(MAX(built_at), 1, 19), 'T', ' ')), 0)) / 3600.0
            FROM dataos_ai.chunks_ep),
         0), 2) AS corpus_source_lag_hours
