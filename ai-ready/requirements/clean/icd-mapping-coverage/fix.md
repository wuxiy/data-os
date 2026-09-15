# icd_mapping_coverage remediation

## 口径演进记录

- G9 立项：代理口径（YPBM 非空率）——当时无映射表可用，原 check.sql 注释即预声明
  「映射表接入后切换真实口径」；
- 2026-09-15（G17/AI-1）：切换**可解析口径**——有 YPBM，或 YPTYM 可在药品主数据目录
  `ods_ep.drug_catalog`（G16d 交付，3,914 行，GENERIC_NAME + STANDARD_CODE）按通用名解析。
  实测：非空率 0.8421（FAIL）→ 可解析率 0.9886（PASS）；不可解析残量 140 行为
  模拟轮注入的测试占位药名（「安全药品处方药通用名」×135、「TSP测试通用名」×5），
  如实留证不剔除。

## 修复路径

对不可解析编码：核对上游药品字典是否缺收，补 `drug_catalog` 后重跑本检查。
