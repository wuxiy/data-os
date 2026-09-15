-- 真实语料质量分布：quality_score 达到 1.0 的 chunk 占比（构建期规则分：长度窗口内且含断句）
SELECT ROUND(
         SUM(CASE WHEN quality_score >= 1.0 THEN 1 ELSE 0 END) / GREATEST(COUNT(*), 1), 6) AS quality_pass_share
FROM dataos_ai.chunks_ep
