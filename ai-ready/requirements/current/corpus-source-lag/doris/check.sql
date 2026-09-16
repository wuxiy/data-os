-- 语料构建水位（G20 corpus_source_lag）：源活跃水位落后于语料构建水位的时长（小时）
-- = max(0, 语料龄 - 源龄)——源在语料构建之后有更新才为正（语料缺新数据）；
-- 语料新于源（负值）按 0 收口，不奖励提前量。
-- 时区口径（dev 实测校正）：UPDATE_TIME 为 +08 本地壁钟（医院源），built_at 为 UTC
-- ISO8601 字符串——后者经 CONVERT_TZ 归一到 +08 壁钟后，两侧在同一壁钟基准上比较，
-- 会话时区的系统性偏移在差值中相消（任意会话时区下 lag 精确）。
-- 空产物表按「纪元 0」参与比较：lag 巨大 -> FAIL（空产物是真缺陷，对齐 G17 空表判缺口径）。
SELECT ROUND(GREATEST(
         (SELECT (UNIX_TIMESTAMP() - COALESCE(UNIX_TIMESTAMP(CONVERT_TZ(REPLACE(SUBSTR(MAX(built_at), 1, 19), 'T', ' '), '+00:00', '+08:00')), 0)) / 3600.0
            FROM dataos_ai.chunks_ep)
       - (SELECT (UNIX_TIMESTAMP() - UNIX_TIMESTAMP(MAX(UPDATE_TIME))) / 3600.0
            FROM ods_ep.ep_mz_cfzb),
         0), 2) AS corpus_source_lag_hours
