-- 真实语料质量分布：quality_score 达到 1.0 的 chunk 占比（构建期规则分：长度窗口内且含断句）
-- 空表判 0（表存在即产物面在册，空产物是真缺陷）；不依赖 SUM 对空集的 NULL 语义
SELECT ROUND(
         COALESCE(SUM(CASE WHEN quality_score >= 1.0 THEN 1 ELSE 0 END), 0)
         / GREATEST(COUNT(*), 1), 6) AS quality_pass_share
FROM dataos_ai.chunks_ep
