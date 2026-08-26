-- 编码映射覆盖率（现数据面代理口径）：药品明细编码列非空率。
-- ICD 诊断映射表接入后切换真实映射表口径（见 fix.md）。
SELECT ROUND(
         COALESCE(SUM(CASE WHEN YPBM IS NULL OR YPBM = '' THEN 0 ELSE 1 END), 0)
         / GREATEST(COUNT(*), 1), 6) AS coverage_ratio
FROM ods_ep.ep_mz_ypcfmx
