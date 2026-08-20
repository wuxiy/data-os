# G5 院内采集全流程模拟——方案与实施记录（2026-08-20）

> 验收权威清单：[gate-hospital-edge-20260819.md](validation/gate-hospital-edge-20260819.md)（已按门户口径修订：L4/L5/L6 锚点由 G3/G1-G2/G4 交付，本轮执行 E1-E6 + L1-L3）。
> 本文档记录探查事实、决策细化与实施步骤，验收结论以 gate 报告为准。

## 1. 现状事实（本轮全部实测，2026-08-20）

| # | 事实 |
| --- | --- |
| 1 | `minifi-edge`（apache/nifi-minifi:2.10.0）运行于 `minifi_minifi-net`（172.22.0.2/16）；conf 挂载 `/root/medical-platform/deploy/minifi/conf`；现 flow 为演示（GenerateFlowFile→InvokeHTTP）；flowfile 仓库 WriteAhead + content FileSystemRepository（持久化已具备）；另有 PullHttpChangeIngestor 每 30s 拉 172.16.65.59:10090（未启用不影响） |
| 2 | MiNiFi 容器 lib 有 `nifi-dbcp-service-nar`、`nifi-record-serialization-services-nar`、`minifi-standard-nar`，**缺 `nifi-aws-nar`（PutS3Object 不可用）**；maven central 可达 `nifi-aws-nar-2.10.0.nar` |
| 3 | 网络隔离（docker 默认 DOCKER-ISOLATION）：minifi-net→platform-net 容器 IP **不通**；minifi→宿主 172.16.65.59:19000（RustFS S3）**通**（403=已到服务）；seatunnel→`rustfs:9000` 同网**通** |
| 4 | RustFS（data-os-dev-rustfs-1）：platform-net 别名 `rustfs`，9000/9001（宿主 19000/19001），单 AK/SK 形态（.env）；现有桶 `dataos-quality-artifacts`、`xianglizhi-media`；宿主 `pip3 install minio` 可用（桶列表实测） |
| 5 | SeaTunnel 运行镜像 `2.3.13-dataos.3`，connectors/ 有 jdbc/doris（+tarball 自带 cdc-base/console/fake）；构建上下文在远端 `/root/ep-build/seatunnel`（cache 含 450MB 分发包）；maven 可达 `connector-file-s3-2.3.13.jar`（63.9MB fat jar）与 `connector-file-base`（320KB） |
| 6 | Doris（FE 172.16.66.8:9030）：`ods_ep.ep_mz_cfzb` 11,373 行 / `ep_mz_ypcfmx` 12,215 行；`ep_mz_cfzb` 本身即 UNIQUE KEY(ID)；CFPTZT 实测值域 `{-1,3,4,5,6,7,8,9,10,12,15,20}`（另 54 行 NULL）；明细外键业务列 `ep_mz_ypcfmx.CFZID`→`ep_mz_cfzb.CFZID`（varchar） |
| 7 | `dataos_quality_ro` 已有 `internal.ods_ep: Select_priv`（E4 授权半项已就绪）；dbt 账号 `dataos_quality_dbt` **未授** ods_ep |
| 8 | control-plane：表在 keycloak-db `data_os` schema；模板目录 `ClinicalWorkflowCatalog` 含 `EP_JDBC_TO_DORIS` v1 等 5 模板；`SeaTunnelExecutorAdapter.resolveNode` 在提交瞬间把 credentialRef 的 secret JSON **逐键合并进插件 map**（落库 JSON 零明文）；`JobConfigService` 拒绝任何含 password/secret/token 的配置键 → S3 密钥必须走凭据注入 |
| 9 | quality-runner：镜像内烧录 `quality/dbt`（dbt-core 1.10.22 + dbt-doris 1.0.0），运行容器为旧 tag `four-gates-72bfc20-r2`；rules.yml 现有规则全部指向合成验收表；规则 selector=dbt 测试名（schema.yml 显式命名） |
| 10 | DM（192.168.17.76:5236）无现成命令行客户端（无 disql）；`DmJdbcDriver18.jar` 在 ep-build/seatunnel/vendor-drivers；EP_TEST 可建表可插数（上轮实证） |

## 2. 决策（沿用 gate D-1~D-6，实施细化）

| # | 决策 | 细化 |
| --- | --- | --- |
| G5-1 | 投递通道（=D-1 RustFS S3） | MiNiFi→**宿主 172.16.65.59:19000**（跨 docker 网隔离，宿主发布端口是唯一通路；IP 端点使 AWS SDK 自动 path-style）；SeaTunnel 走容器网 `rustfs:9000` |
| G5-2 | 增量机制（=D-2 轮询） | MiNiFi `GenerateTableFetch`（列值索引 UPDATE_TIME，状态本地持久化）+ `ExecuteSQLRecord`（JsonRecordSetWriter，时间戳格式 yyyy-MM-dd HH:mm:ss）→ JSON lines |
| G5-3 | 失败重试（=E6） | PutS3Object failure→penalty 环回重试；断网期间队列驻留 flowfile/content repository（持久化实证） |
| G5-4 | 幂等（=D-5） | Doris 边缘表 UNIQUE KEY(ID)；SeaTunnel 每次读桶内全部对象重放亦不增行（L1.4 顺带验证文件重放） |
| G5-5 | 日期传输 | SeaTunnel schema 中 datetime 列一律按 `string` 传输，由 Doris Stream Load 隐式转换（规避 JSON 时间解析方言） |
| G5-6 | S3 凭据 | 凭据服务存 `{"fs.s3a.access.key":…,"fs.s3a.secret.key":…}`；提交瞬间合并进 S3File 插件配置；落库/日志零明文（键含 "secret" 被配置校验拒绝，正是走注入的原因） |
| G5-7 | 最小权限边界（如实） | RustFS 当前为单 AK dev 形态，无按桶策略 API → E5「最小权限」落为**桶级隔离 + 键值独立凭据**，偏差在 gate 报告标注 |
| G5-8 | L3 脏数据 | CFPTZT=99（值域违规）+ 孤儿 CFZID（外键违规）；主键唯一/非空作为在册常态守卫——UNIQUE KEY 表无法驻留重复主键（这本身是幂等设计实证），gate 如实标注 |
| G5-9 | DM 写入工具 | 本地编译单文件 JDBC CLI（`--release 17`），经 minifi 容器 JRE+DM 驱动执行（该容器本就可达 DM）；SQL 只含模拟值合成行（ID ≥ 910,000,000） |

## 3. 实施步骤（每项全绿独立提交）

### E2（本地，先行）：quality/dbt EP 规则包
- `quality/dbt/models/sources.yml` 增 `ep_edge` 源（schema `{{ env_var('DORIS_EP_DATABASE','ods_ep') }}`，表 `ep_mz_cfzb_edge`/`ep_mz_ypcfmx_edge`）
- `quality/dbt/models/ep_edge_schema.yml` 4 测试（显式命名=selector）：`quality_ep_edge_cfzb_id_unique` / `quality_ep_edge_cfzb_id_not_null` / `quality_ep_edge_cfzb_cfptzt_values`（accepted_values 实测值域）/ `quality_ep_edge_ypcfmx_cfzid_fk`
- `services/quality-runner/rules.yml` 注册 4 条（dataset_id `asset-ep-prescription-edge`；evidence 列仅 ID/CFPTZT/CFZID/KFRQ 等非 PHI）
- 新增 `tests/test_catalog_binding.py`：仓库真实 rules.yml 的每个 selector 必须存在于 dbt 工程 schema.yml（锁两端一致性）

### E3（本地）：control-plane 边缘模板
- `ClinicalWorkflowCatalog` 增 `EP_EDGE_S3_TO_DORIS` v1：source=S3File（path/bucket/fs.s3a.endpoint/format 必填 + credentialRef），sink=Doris（同 EP 模板规格，目标表 `ep_mz_cfzb_edge`）
- 模板校验单测（正例 + 缺 endpoint/缺 credentialRef 负例）；`/api/v1/workflow-templates` 5→6

### E1（远端）：SeaTunnel 镜像增 S3 连接器
- 本地 `deploy/seatunnel/Dockerfile`+`plugin_config` 增 connector-file-s3（+connector-file-base）与 SHA256；同步远端 ep-build 上下文；cache 下载两 jar；构建 `2.3.13-dataos.4`
- 冒烟：容器内 S3File 源（指向 RustFS 测试对象）→ Console sink

### E4（远端）：Doris 边缘增量表
- `deploy/doris/ep-edge-tables.sql`：`ods_ep.ep_mz_cfzb_edge`（54 列）+ `ep_mz_ypcfmx_edge`（36 列）UNIQUE KEY(ID)，typed schema（datetime 传输见 G5-5）
- `GRANT SELECT_PRIV ON ods_ep TO dataos_quality_dbt`（ro 已有）

### E5（远端）：RustFS 中转桶
- 宿主 python minio 建 `dataos-edge-relay`（私有）；控制面凭据 `ep-edge-s3-relay`（fs.s3a.* 键值，走 API）

### E6（远端）：MiNiFi flow
- repo 内 `deploy/minifi/generate-ep-edge-flow.py` 生成 flow.json.gz（endpoint/AK/SK 经环境变量注入，不进 repo）
- 双表分支：GenerateTableFetch→ExecuteSQLRecord(JsonRecordSetWriter)→UpdateAttribute(对象键 `ep_mz_cfzb/yyyyMMddHHmmss-uuid.json`)→PutS3Object，failure→penalty 环回
- `nifi-aws-nar-2.10.0.nar`→`extensions/`（autoload），`DmJdbcDriver18.jar`→`lib/`；conf 备份后替换 flow 并重启加载

## 4. L1-L3 场景脚本（要点）

- **L1.1** iptables `DOCKER-USER`：放行 `172.22.0.0/16→192.168.17.76:5236` 与 `→172.16.65.59:19000`；DROP 其余 FORWARD→DM 5236。负向：控制面容器源检查必须失败；正向：minifi→DM 通。
- **L1.2-L1.4** 门户/API 登记 EP_EDGE 任务→运行→SUCCEEDED；对账（行数/主键范围/列数）；同批对象重放后计数不变。
- **L2.1** 插入合成行→轮询周期（60s 留证）→Doris 可查 ≤5 分钟。
- **L2.2-L2.4** DROP minifi→19000 二十分钟，期间每分钟产数；content repository 目录增长留证；解除后补传零丢失；断链中 `docker restart minifi-edge` 位点不重不漏。
- **L3.1-L3.4** EP 规则入注册表→复检 FAILED（≤20 条脱敏样本+批次号）→工单状态流转→`governance_issue_events` 事件链→通知 `/receipts` HMAC 回执。
- **回归**：隔离解除后 EP 直连任务重跑对账零回归；mvn / pytest 全绿（前端未涉及，qa 不适用并在报告注明）。

## 5. 边界与回滚（沿用 gate 附录）

- 合成行 `ID ≥ 910,000,000` 患者字段全模拟值；清理时 DELETE 前后行数留证。
- 网络还原：DOCKER-USER 规则逐条删除留证；SeaTunnel 可回 `dataos.3`；`ods_ep` 边缘表与中转桶可单独清理；MiNiFi conf 有备份可回滚原 flow。
- 口令只进凭据服务与远端 `.env`；汇报只对账行数与结构列。
