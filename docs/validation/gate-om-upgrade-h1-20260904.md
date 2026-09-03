# Gate H1 验收报告：OpenMetadata 1.5.11 → 1.6.0 升级（P3）

> 日期：2026-09-03/04（跨日执行）
> 方案载体：docs/production-hardening-batch-plan-20260903.md §二 H1；P3 三次扩大范围的三个受阻面
> 阶段定位：生产化收口批次 H1（AGENTS.md 2026-09-03 阶段切换后首个批次，用户批准）

## 一、执行链与结果

| 步骤 | 结果 |
| --- | --- |
| 兜底备份 | mysqldump openmetadata 库（87 表，~2.9MB，`/root/om-mysql-backup-pre1.6-20260903.sql`） |
| 镜像获取 | server/ingestion 1.6.0 经 daocloud 源拉取（Docker Hub 直连不可达） |
| 数据迁移 | `openmetadata-ops.sh migrate --force`（**263 条 1.6.0 SQL 落库**，SERVER_MIGRATION_SQL_LOGS 验证） |
| 服务健康 | OM 1.6.0 healthy；外部 8445 版本端点确认 `1.6.0` |
| 回滚路径 | mysqldump + compose image 回 1.5.11（未动用） |

**升级执行的关键坑（载荷性）**：
1. 1.6 要求先跑 `bootstrap/openmetadata-ops.sh migrate` 再启动——直接换镜像会 crash-loop（IllegalStateException: pending migrations）；
2. **crash-loop 容器内 `docker exec` 跑 migrate 会被容器重启杀死**（表象：migrate 只打印计划表就静默结束、迁移日志不落库）——正解是 `docker compose run --rm --no-deps openmetadata ./bootstrap/openmetadata-ops.sh migrate --force`（一次性容器，不受 restart 策略影响）；
3. 首次启动 ES 索引重建期（put-mapping 30s 超时重试）约 5–8 分钟才收敛 healthy——不是故障；
4. medical-platform compose 为三文件组合（docker-compose.yml + access + dev），单文件 up 会报 undefined network。

## 二、验证面清单

| 面 | 结果 | 证据 |
| --- | --- | --- |
| 认证链 | ✅ Keycloak client_credentials（dataos-om-ingest）签发 1271 字符 token；custom-oidc + JwtFilter 升级后行为不变 | token 签发 + /tables 200 |
| **glossaryTerms 端点（P3 阻塞面 1）** | ✅ **端点从损坏恢复**——1.5.11 时期 500/损坏，现 200 正常分页 | `/glossaryTerms?limit=3` → 200 |
| **testDefinition（P3 阻塞面 2）** | ✅ 内置 85 条测试定义全量在库（1.5.11 为 35 且端点损坏） | MySQL test_definition 计数 |
| G6 资产面零回归 | ✅ 57 表全在；抽查 drug_category 12 列 / ep_order 45 / patient 18 / ep_mz_cfzb 53 与 Doris DDL 一致；1.6 ingestion 工作流 Success | API fields=columns 抽查 |
| **dbt 资产化（P3 阻塞面 3）** | ⚠️ 部分恢复——工作流可跑、产物链（v11/v5 降维）兼容、部分 records 落库；但 97 errors + 摄取尾段 token 过期（Success 51.5%），test_case/data_model 计数未增长（11/1 维持） | /tmp/om16-g7.log |
| Superset 联动 | 未验（dashboard_data_model_entity 1 条历史记录在；重放归 G4 脚本，非本 gate 阻塞项） | — |
| 词表数据 | ⚠️ glossary_term 0（迁移后空）——端点已修复，35 条 AI Ready 词表 seed 待重放（G11 脚本） | MySQL 计数 |

## 三、结论与余项

**P3 主体关闭**：版本级缺陷（testDefinitions/glossaryTerms 端点损坏）经 1.6.0 升级消除；G6 面零回归；认证链完好。

**H1 余项（收口前遗留，记备忘）**：
1. dbt 摄取全量恢复：token 过期重跑 + 若 97 errors 持续则排查 1.6 ingestion 对降维产物的兼容（预计半日）；
2. glossary 词表 35 条 seed 重放（G11 脚本，端点已可用）；
3. om-ingest 系脚本默认 INGESTION_IMAGE 更新为 1.6.0（当前需环境变量显式传）。

## 四、偏差与如实记录

1. G6 对账脚本在 dev 网络 SSH 抖动期被截断（对账侧 Doris 查询容器空返回致 1 个表误报 FAIL；API 复查该表 12 列一致）——以 API 抽查替代完整脚本对账；
2. 升级采用就地迁移（非全新卷重建）：保留 Keycloak OIDC 配置/bot/历史资产，mysqldump 兜底；
3. dev 侧 medical-platform 仓库不在 git 管理（sed 原地改 compose image 版本）。
