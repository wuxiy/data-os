# 电子处方（EP）达梦采集链路验收清单 — 2026-08-18

状态：**已确认并执行完成（2026-08-19），P0 + D1 + D2 全部通过**。逐项结果见文末「执行结果」。

## 0. 范围与已核实事实

**目标**：在开发机 `172.16.65.59` 现有 Compose 环境，接入电子处方达梦模拟采集库，跑通「数据源登记 → 凭据引用 → 源检查 → EP 采集任务（SeaTunnel JDBC → Doris）→ 运行状态机 → Doris ODS 落库 → 门户可见」的完整采集链路。

| 事实 | 结论（已实测/已查证） |
| --- | --- |
| 采集源 | `jdbc:dm://192.168.17.76:5236`，账号 `EP_TEST`，DM Server 8.1.3.62；实测推荐 URL 形式 `jdbc:dm://192.168.17.76:5236?schema=EP_TEST`（元数据探查已连通） |
| EP 库内容 | 150 张表；核心表 `EP_MZ_CFZB` 门诊处方主表 11,373 行（53 列，PK `ID`，`UPDATE_TIME TIMESTAMP` 无 NULL，含患者 PHI 列）、`EP_MZ_YPCFMX` 门诊药品处方明细 12,215 行（36 列） |
| 网络 | 本机→DM、开发机→DM 的 5236 端口均连通；容器出网经 C1/C3 实测 |
| 代码阻断点① | `SourceNetworkPolicy.validateJdbcUrl` 仅放行 PostgreSQL/MySQL/SQL Server/Oracle，`jdbc:dm://` 当前被拒，必须扩白名单 |
| 代码阻断点② | control-plane 仅依赖 postgresql 驱动，JDBC 源检查连 DM 会报 No suitable driver，需加 `com.dameng:DmJdbcDriver18:8.1.3.140`（Maven 中央仓在库，已验证） |
| SeaTunnel 侧 | connector-jdbc 2.3.13 已内置达梦方言 `internal/dialect/dm/DmdbDialectFactory`（已下载 jar 实测）；缺的只是镜像内驱动 jar，走 `deploy/seatunnel/driver-manifest.tsv` 增行重建 |
| Doris 现状 | 版本 `doris-3.0.6.2-rc01`（存算分离，compute group + storage vault 模型）；仅质量库，需新建 `ods_ep` 与写入账号并补两类系统授权 |
| 模板机制 | 临床域任务走 `ClinicalWorkflowCatalog`（原 4 模板）+ `/api/v1/workflow-templates`，门户自动消费；新增 `EP_JDBC_TO_DORIS` |
| 增量风险 | `${last_success_time}` 注入 ISO-8601 带时区格式（如 `1970-01-01T00:00:00Z`），与 DM TIMESTAMP 直接比较的兼容性未验证 → 首跑全量，增量列 P1 实测 |

**安全口径**：EP 口令只进控制面凭据服务（AES-GCM 密文）与开发机 `.env`（0600）；不进 Git、日志、任务 JSON。源库全程只读（仅 SELECT/元数据）。验收汇报只对账行数与结构列（ID/编号类），不打印患者姓名、卡号等 PHI。

## A. 代码与制品改动（本地全绿后部署，每步独立提交）

| # | 项目 | 通过标准 | 验证方式 |
| --- | --- | --- | --- |
| A1 | `SourceNetworkPolicy` 放行 `jdbc:dm://` 前缀并解析其主机 | 新增单测：`jdbc:dm://` 合法主机通过、私网策略/白名单语义不变；既有测试零修改全绿 | `JAVA_HOME=$(/usr/libexec/java_home -v 21) mvn test` |
| A2 | control-plane 增加 `DmJdbcDriver18`（runtime）依赖 | 源检查适配器可对 DM URL 发起真实连接；镜像内含驱动 jar | A3 单测 + C1 实测 |
| A3 | `ClinicalWorkflowCatalog` 新增 `EP_JDBC_TO_DORIS` v1 模板（source: Jdbc/url/driver/query/credentialRef；sink: Doris/ods_ep/`ep_mz_cfzb`），模板校验与既有 4 模板同规格 | 新增模板校验单测通过；`/api/v1/workflow-templates` 返回 5 条 | mvn test + B3 后 GET 验证 |
| A4 | SeaTunnel 驱动清单增行（dm，随 DM8 介质 `DmJdbcDriver18.jar` 8.1.3.12，sha256 `4854846a…bba12`）并构建 `2.3.13-dataos.3` | 镜像 `/opt/seatunnel/lib/` 含 DmJdbcDriver18 jar；connector-jdbc 不变 | `deploy/seatunnel/scripts/build-image.sh` + 容器内 ls 校验 |

## B. 环境准备与部署（开发机，保留回滚点）

| # | 项目 | 通过标准 | 验证方式 |
| --- | --- | --- | --- |
| B1 | Doris 新建 `ods_ep` 库与 `dataos_ods_writer` 账号（root 凭据用户提供；口令随机生成入 `.env`） | `SHOW DATABASES` 含 `ods_ep`；writer 账号仅对 `ods_ep.*` 有权限；补齐 compute group / storage vault 授权 | quality-runner 容器内 pymysql 复核 |
| B2 | 部署新 control-plane 与 seatunnel 镜像（`.env` 改 tag，旧 tag 保留） | 两容器 healthy；`/api/v1/system/status`、SeaTunnel `/overview` 正常 | `docker compose ps` + curl |
| B3 | 登记 EP 凭据与数据源 | 凭据 `ep-dm-readonly`、`doris-ods-writer` 创建成功且 API 不回显 secret；数据源「电子处方（达梦模拟）」`systemType=EP`、`protocol=JDBC` 落库 | `POST /api/v1/credentials`、`POST /api/v1/sources` + GET 复核 |

## C. 端到端链路验收（核心，逐项留证）

| # | 项目 | 通过标准 | 验证方式 |
| --- | --- | --- | --- |
| C1 | 数据源检查 | `POST /api/v1/sources/{id}/check` 返回 `HEALTHY`「JDBC 连接成功」，最近检查时间回写 | API 调用 + GET sources 复核 |
| C2 | 任务配置边界 | EP 任务保存 `EP_JDBC_TO_DORIS` v1 配置成功；提交含 `password` 明文键的配置被 `400 INVALID_REQUEST`（负向） | `PUT /api/v1/jobs/{id}/config` 正反两例 |
| C3 | 首跑全量采集 | `POST /jobs/{id}/runs`（带 Idempotency-Key）→ `SUBMITTED→RUNNING→SUCCEEDED`；`started_at` 回填实际启动时间；SeaTunnel 侧作业终态 FINISHED | 轮询 `GET /runs` + `POST /runs/{runId}/sync` + SeaTunnel `/job-info` |
| C4 | 数据对账（主表） | Doris `SELECT COUNT(*) FROM ods_ep.ep_mz_cfzb` == 源表行数（11,373）；抽查 `ID` min/max、`CFZID` 非空计数两侧一致；列数一致（53） | 源侧 JDBC + Doris 侧 count，双侧输出留档 |
| C5 | 幂等提交 | 同一 Idempotency-Key 重发返回原 run（不新建运行、Doris 行数不翻倍、SeaTunnel 完成数不变）；同 key 不同配置返回 `409` | API 双例 + Doris/SeaTunnel 复测 |
| C6 | 状态同步 | `POST /runs/{runId}/sync` 对终态运行幂等（无重复事件） | API 重复调用 |
| C7 | 门户可见性 | 门户数据接入页：EP 数据源 HEALTHY；EP 任务「已完成」；模板列表出现「电子处方入仓」 | 浏览器实测（截图留档） |
| C8 | 环境回归 | 既有 6 源、既有任务与治理/质量/调度器不受影响；`/healthz`、`/api/v1/governance/summary` 正常 | API 巡检比对 |

## D. 扩展项（已纳入本轮）

| # | 项目 | 通过标准 |
| --- | --- | --- |
| D1 | 明细表 `EP_MZ_YPCFMX` 第二任务 | 运行 SUCCEEDED；Doris 行数 12,215 对账一致；列数 36 一致 |
| D2 | 增量窗口实测 | 实证 ISO-8601 直比不兼容；规整方案可用；首窗全量、次窗 0 行（水位推进正确） |

## 执行结果（2026-08-19，全部通过）

| 项 | 结果 | 关键证据 |
| --- | --- | --- |
| A1 | ✅ | mvn 110/110 绿（新增 3 用例）；commit `485c883` |
| A2 | ✅ | commit `acdd0eb`；C1 实测连通 |
| A3 | ✅ | commit `32cbb4c`；`/api/v1/workflow-templates` 返回 5 条含 EP |
| A4 | ✅ | commit `a59bd65`；镜像 `2.3.13-dataos.3`（standard profile，离线构建）；容器内 `lib/DmJdbcDriver18.jar` 实证 |
| B1 | ✅ | `ods_ep` 建库；writer 仅见 `ods_ep`；追加授权 `GRANT USAGE_PRIV ON COMPUTE GROUP default_compute_group` 与 `GRANT USAGE_PRIV ON STORAGE VAULT 's3_vault'`（存算分离模型两道系统权限，第二次 500 排障补齐） |
| B2 | ✅ | control-plane `0.1.0-ep-dameng-20260819` + seatunnel `dataos.3` 双 healthy；回滚点：旧 tag 与 `.env` 旧值已记录。**过程中修复既有基线漂移**：0c7c701 修订了已发布的 V1/V6/V7/V8，开发库停在 V5 且 V1 校验和为旧值 → 对齐 V1 checksum 后 V6-V9 自动应用（详见过程记录） |
| B3 | ✅ | 凭据 `dad3e8e5`/`29c3558f` ACTIVE 零回显；源 `438dc24d`（EP/JDBC/PENDING→HEALTHY） |
| C1 | ✅ | `HEALTHY「JDBC 连接成功」`，`lastCheckedAt` 回写。注意：`credentialRef` 必须传凭据 **UUID**（dev README 示例写名称，实际按 ID 解析） |
| C2 | ✅ | 任务 `62f4fc7a` 配置保存成功；明文 `password` 键 → 400「任务配置不得保存明文密码或密钥」 |
| C3 | ✅ | 运行 `017e6120` `SUBMITTED→RUNNING→SUCCEEDED`，`startedAt/finishedAt` 回填（11 秒完成）；SeaTunnel 作业 `1142146994995986433`。前两次投递因 Doris 授权缺失走完 `UNKNOWN→confirmAbsent→retry` 对账闭环（顺带验证了采集侧可疑宁停的 StaleSubmissionPolicy 行为） |
| C4 | ✅ | Doris 11,373 == 源 11,373；MIN_ID=1/MAX_ID=11379、CFZID 非空 11,373、53 列全部一致 |
| C5 | ✅ | 同 key 重放 → 201 返回原运行，SeaTunnel finishedJobs 保持 1，Doris 不翻倍；同 key + `{"config":{不同配置}}` → 409「相同 Idempotency-Key 的请求内容不一致」 |
| C6 | ✅ | 终态运行连续两次 sync，状态/时间戳/消息零变化 |
| C7 | ✅ | 门户「数据接入」页：源「JDBC 连接成功 · 08/19 01:23」；模板下拉「电子处方入仓 · EP」；任务行「已完成」（截图 `c7-portal-ep-ingestion.png`） |
| C8 | ✅ | 源 6→7、任务 7→8（仅新增 EP）；`/healthz` UP、治理 summary 正常、DolphinScheduler UP、quality-runner healthy；`platform-operations` 聚合 DEGRADED(unknown=1) 为既有 UI 探针显示行为（三组件探针全 UP），非本次引入 |
| D1 | ✅ | 任务 `9b80aa29` 一次 SUCCEEDED；Doris `ep_mz_ypcfmx` 12,215 == 源；36 列一致 |
| D2 | ✅ | **实证**：`UPDATE_TIME >= '1970-01-01T00:00:00Z'` 直比 → DM `Invalid datetime value` 作业失败；规整方案 `TO_TIMESTAMP(REPLACE(SUBSTR('<iso>',1,19),'T',' '))` 源侧验证 11,373 命中；首窗 11,373 行入 `ep_mz_cfzb_inc`，次窗（新 key）SUCCEEDED 且计数不变 = 0 增量，水位推进正确 |

## 过程发现与遗留事项

1. **credentialRef 按凭据 UUID 解析**，`CredentialService.resolve` 走 `findById`；`deploy/dev/README.md` 中 `credentialRef: "lis-readonly"` 示例文案有误导，建议改为 UUID 示例。
2. **运行请求体形状**：`POST /jobs/{id}/runs` 的配置覆盖字段是 `{"config": {...}}` 包装结构；裸发 `{"env":...}` 会被解析为空请求体并回退已保存配置（幂等指纹因此相同）。建议在 README 补一句形状说明。
3. **Doris 3.0.6.2-rc 存算分离授权模型**：新业务库写入账号需要三重授权——库级 `GRANT ALL ON ods_ep.*`、`GRANT USAGE_PRIV ON COMPUTE GROUP <cg>`、`GRANT USAGE_PRIV ON STORAGE VAULT '<vault>'`。建议把后两条纳入 B1 类环境准备脚本/文档。
4. **基线漂移（既有问题，本轮首次暴露）**：`0c7c701` 直接修订了已发布的 V1/V6/V7/V8 迁移内容；任何从该提交之后构建的镜像都无法在停在旧基线的库上启动（Flyway 校验和拒绝）。开发库已按「对齐 V1 校验和 + 应用 V6-V9」修复。建议后续 schema 变更一律走新增迁移版本，不再改历史基线。
5. **增量时间语义**：watermark 以 UTC ISO 字符串注入，规整后按 DM 本地 TIMESTAMP 语义比较；两侧偏移一致不影响窗口宽度与本次验收（数据静止），但跨时区/夏令时的严格正确性属平台 watermark 时区设计议题（`DATAOS_SEATUNNEL_TIME_ZONE`），建议后续单独立项。
6. **Doris root 口令已出现在会话明文中**，建议验收后轮换；writer 口令仅存开发机 `.env`（0600）。

## 附录

**Doris 预建 SQL（B1 实际执行版，由管理账号执行）**

```sql
CREATE DATABASE IF NOT EXISTS ods_ep;
CREATE USER IF NOT EXISTS `dataos_ods_writer`@`%` IDENTIFIED BY '<随机口令，存 .env>';
GRANT ALL ON ods_ep.* TO `dataos_ods_writer`@`%`;
GRANT USAGE_PRIV ON COMPUTE GROUP default_compute_group TO `dataos_ods_writer`@`%`;
GRANT USAGE_PRIV ON STORAGE VAULT 's3_vault' TO `dataos_ods_writer`@`%`;
```

**增量查询模板（D2 实证可用版）**

```sql
SELECT * FROM EP_MZ_CFZB
 WHERE UPDATE_TIME >= TO_TIMESTAMP(REPLACE(SUBSTR('${last_success_time}',1,19),'T',' '))
   AND UPDATE_TIME <  TO_TIMESTAMP(REPLACE(SUBSTR('${run_start_time}',1,19),'T',' '))
```

**回滚**：`.env` 恢复 `DATAOS_CONTROL_PLANE_IMAGE=medical-platform/data-os-control-plane:0.1.0-platform-ops-20260811`、`SEATUNNEL_IMAGE=medical-platform/data-os-seatunnel:2.3.13-dataos.2` 后 `docker compose up -d`；旧镜像未删除。注意：控制面回滚到 0811 镜像会因 V6-V9 已应用而正常运行（该镜像早于这些列，不感知）；如需彻底回滚数据库需按迁移逐条回滚，不建议。`ods_ep` 库如需清理单独 DROP，不影响质量库与其他 datalake 库。
