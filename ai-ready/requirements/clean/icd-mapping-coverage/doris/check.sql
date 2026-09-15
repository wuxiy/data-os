-- 编码映射覆盖率：明细行药品编码可解析率 = 有 YPBM，或药品通用名可在药品主数据
-- 目录（drug_catalog，G16d）解析出标准编码 STANDARD_CODE。
-- 2026-09-15（G17）：从「YPBM 非空率」代理口径演进为可解析口径——原注释预声明的
-- 映射表接入路径兑现；不可解析残量如实留证（模拟轮测试占位药名）。
SELECT ROUND(
         SUM(CASE WHEN m.YPBM IS NOT NULL AND m.YPBM <> '' THEN 1
                  WHEN EXISTS (SELECT 1
                               FROM ods_ep.drug_catalog c
                               WHERE c.GENERIC_NAME = m.YPTYM
                                 AND c.STANDARD_CODE IS NOT NULL AND c.STANDARD_CODE <> '') THEN 1
                  ELSE 0 END)
         / GREATEST(COUNT(*), 1), 6) AS coverage_ratio
FROM ods_ep.ep_mz_ypcfmx m
