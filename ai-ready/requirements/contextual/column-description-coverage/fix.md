# 修复指引：column_description_coverage

## 缺口

声明清单内的核心列（处方主表 7 列 + 药品明细 6 列）在 OpenMetadata 无非空描述。

## 修复路径

1. 运行 `deploy/scripts/om-prepare-ai-ready.sh`（幂等）：核心列描述段会为空描述列写入
   中文业务语义（G17 扩充）；
2. 核对口径：`GET /tables/name/{fqn}?fields=columns` 中目标列 description 非空即计入。

## 阈值依据

- pass 0.8：13 个核心列允许少量待补，但主体语义必须可机读；
- warn 0.5：半数以下覆盖时降级为告警，不阻断（Contextual 为 minor/major 混合维度）。

## 变更记录

- 2026-09-15（G17/AI-1）：新立。基线实测 0.0（列描述未登记），om-prepare 扩充后达 1.0。
