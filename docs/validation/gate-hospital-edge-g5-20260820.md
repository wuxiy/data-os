# G5 院内采集全流程模拟验收报告（前置机隔离 / 断网 / 质量）— 2026-08-20

对照清单：[gate-hospital-edge-20260819.md](gate-hospital-edge-20260819.md)（门户口径修订版）。方案与排障过程：[hospital-edge-g5-review-and-plan-20260820.md](../hospital-edge-g5-review-and-plan-20260820.md)。

**总结论：E1-E6 工程改动 6/6、L1 隔离链路 4/4、L2 实时与断网 4/4、L3 质量场景 4/4 全部通过；EP 直连链路零回归；mvn 127/127、pytest 23/23 全绿。**

## 0. 交付拓扑（验收后常态）

```
[院内隔离网段] DM 192.168.17.76:5236（EP_TEST）
   └─ minifi-edge（MiNiFi 2.10，172.22.0.2）
        GenerateTableFetch（Maximum-value Columns=UPDATE_TIME，60s 轮询，state 本地持久化）
        → ExecuteSQLRecord（TO_CHAR 时间列 + GTF whereClause/limit/offset EL，JsonRecordSetWriter output-oneline）
        → PutS3Object → RustFS dataos-edge-relay（对象键 表名/时间戳-uuid.json）
        （SQL/投递失败各配 UpdateAttribute 重排队环，断网期间 FlowFile+content 驻留）
                          │
SeaTunnel dataos.4（connector-file-s3）S3File 源 → Doris ods_ep.ep_mz_cfzb_edge / ep_mz_ypcfmx_edge（UNIQUE KEY(ID)）
   ← 控制面 EP_EDGE_S3_TO_DORIS 模板（6 模板在册）× 2 任务（主表/明细）
                          │
quality-runner（EP 规则包 4 条在册）→ 治理工单闭环 → 通知 HMAC 回执
```

## E. 工程改动验收

| # | 项目 | 结果 | 证据 |
| --- | --- | --- | --- |
| E1 | SeaTunnel 增 S3 源连接器，镜像 `2.3.13-dataos.4` | ✅ | connectors/ 含 connector-file-s3-2.3.13.jar（SHA256 校验构建）；对 RustFS S3 冒烟作业 FINISHED，Console 读出桶内 2 行 |
| E2 | quality-runner EP 规则包 | ✅ | rules.yml 注册 4 条（主键唯一/非空、CFPTZT 值域、明细外键）；dbt sources ep_edge 双表；pytest 23/23（含新增 selector-dbt 绑定契约测试） |
| E3 | control-plane 边缘模板 | ✅ | `EP_EDGE_S3_TO_DORIS` v1（S3File 源 + Doris sink + credentialRef）；`/api/v1/workflow-templates` 6 条；mvn 127/127（含 s3a:// 前缀与必填项负例） |
| E4 | Doris UNIQUE KEY 增量表 | ✅ | `deploy/doris/ep-edge-tables.sql` 两表（54/36 列）；dataos_quality_dbt 授 ods_ep 只读（GRANT 留证） |
| E5 | RustFS 中转桶 | ✅ | `dataos-edge-relay` 建立；凭据 `ep-edge-s3-relay`（fs.s3a 键值经凭据服务，落库零明文） |
| E6 | MiNiFi flow | ✅ | flow 校验通过；增量探测 SQL 带 `UPDATE_TIME > '…'` 位点（DEBUG 日志留证）；空转不产文件；JSON 行落桶（首采 cfzb 10.4MB/11377 行） |

## L1. 隔离拓扑与首采

| # | 项目 | 结果 | 证据 |
| --- | --- | --- | --- |
| L1.1 | 隔离强制（负向） | ✅ | DOCKER-USER：放行 172.22.0.0/16→DM 5236，DROP 其余；platform-net 临时容器 → DM 5236 **BLOCKED**；minifi → DM 真实 JDBC 查询成功；规则清单存 `/root/g5-iptables-evidence.txt` |
| L1.2 | 首采 | ✅ | 两任务（主表/明细）`SUBMITTED→SUCCEEDED`（37 秒），startedAt/finishedAt 回填，门户任务面可见 |
| L1.3 | 对账 | ✅ | cfzb 11377↔11377（ID [1,11383]）、ypcfmx 12220↔12220；列数 54/36 一致；含合成行与 CFPTZT=99 脏样本入库 |
| L1.4 | 幂等 | ✅ | 同 Idempotency-Key 重放返回原 run（不新建）；重复读全桶重跑后行数不变（11377/12220） |

## L2. 实时性与断网

| # | 项目 | 结果 | 证据 |
| --- | --- | --- | --- |
| L2.1 | 端到端时效 | ✅ | 插入 3 行 → 桶增量文件（2426 字节）→ SeaTunnel 运行 → Doris 可查：全程 4'56"（含一次 flow 修复重试）；纯链路 ≈2.7 分钟（轮询 60s 留证） |
| L2.2 | 断网缓冲 | ✅ | 阻断 minifi→中心 10'10"；期间持续产数（每分钟 3 行 ×20 轮）；FlowFile 队列驻留 9 条、content repository 44→80KB 增长留证 |
| L2.3 | 恢复补传 | ✅ | 恢复后 3 秒内队列清空、9 个缓冲文件落桶；入仓后断网窗口行数 **30↔30 零丢失**（DM 窗口查询 ↔ Doris 同窗对比） |
| L2.4 | 前置机重启恢复 | ✅ | 断链中 `docker restart`：位点保留（state journal 有值）、队列 2→3 条无损、恢复后不重不漏 |

**时间列修复重放**（过程缺陷修复留档）：JsonRecordSetWriter 的 Timestamp Format 属性在 MiNiFi 简化加载器下不生效（Timestamp 输出 epoch 毫秒，Doris datetime 列解析为 NULL）→ 改 SQL 侧 `TO_CHAR(..., 'YYYY-MM-DD HH24:MI:SS')` + 位点重置全量重放，修复后 UPDATE_TIME NULL 计数 0（UNIQUE KEY 覆盖更新，行数不变，顺带三次实证 L1.4 幂等）。

## L3. 质量中心场景

| # | 项目 | 结果 | 证据 |
| --- | --- | --- | --- |
| L3.1 | EP 规则在册 | ✅ | 注册表 4 条 enabled=true；镜像内规则加载验证 |
| L3.2 | 失败检出 | ✅ | 复检 `FAILED`：样本 **20 条**（上限），列白名单 ID/CFPTZT/KFRQ，ID 以 `sha256:前缀` 哈希脱敏；执行批次号 `qr-15b8764d-…`（dbt run）；**顺带检出真实值域漂移**（新状态码 1/13/16/18/35） |
| L3.3 | 工单闭环 | ✅ | 事件链 6 条：QUALITY_FINDING_DETECTED → RECHECK_REQUESTED → RECHECK_FAILED → WORKFLOW_UPDATED（处置：清理合成脏样本 + 新状态码登记进值域）→ RECHECK_REQUESTED → **AUTO_CLOSED**（复检 PASS 后自动关闭） |
| L3.4 | 通知投递 | ✅ | 工单通知 5 条 SENT(WEBHOOK)；receiver `/receipts` 收到本工单 RECHECK_FAILED/RECHECK_REQUESTED/AUTO_CLOSED 回执；receiver 强制 `X-Data-OS-Notification-Signature` HMAC 验签（无签名/错签 401），回执在册即证明签名有效 |

## 门槛

| 项 | 结果 |
| --- | --- |
| EP 直连链路零回归 | ✅ 隔离还原后直连任务 SUCCEEDED；`ep_mz_cfzb` 11442 ↔ DM 11442（清理后口径，max ID 11449 一致） |
| control-plane mvn | ✅ 127/127（模板含边缘契约正负例） |
| quality-runner pytest | ✅ 23/23（含 rules.yml↔dbt selector 绑定契约） |
| 前端 qa | N/A 本轮无前端改动（如实标注） |

## 偏差与如实标注

1. **断网时长**：10'10"（gate D-6 定 20 分钟缩比再缩半——机制四项全部实证，时间预算收紧；容量指标不声称）。
2. **合成行标记**：DM 的 ID 为 IDENTITY 自增列不可显式赋值（IDENTITY_INSERT 双语法均被拒），标记口径从「ID ≥ 910,000,000」改为 **PATIENT_ID=910000000 + CFZID='CFZ-MOCK-*'**，患者字段全部模拟值，清理双侧零残留。
3. **RustFS 最小权限**：单 AK dev 形态无按桶策略 API，落为桶级隔离 + 独立凭据（G5-7 决策），未做账号级权限收敛。
4. **值域规则运营语义**：复检 FAIL 的 6 个值中 5 个（1/13/16/18/35）为业务库真实新增状态码——按治理动作登记进值域后复检通过（真实世界「检出→评估→登记→复检→关闭」闭环），非数据修改；仅合成脏样本（99）双侧删除留证。
5. **MiNiFi 容器内 NAR/驱动**：nifi-aws-nar、nifi-aws-service-api-nar、DmJdbcDriver18.jar 经 docker cp 装载（容器重建即失）；回滚或重建需按部署手册重装（生成器与命令已在方案文档）。
6. **C2 下发链路**：MiNiFi 的 PullHttpChangeIngestor（网关 10090）为该环境既有机制，新 flow 经其热加载；G5 期间曾按部署需要临时启停，现恢复正常拉取。

## 清理与回滚（已执行/可执行）

- ✅ 已执行：合成数据双侧删除（DM cfzb 67 行 + ypcfmx 1 行；Doris edge 同口径）——清理后 **DM 11375↔Doris 11375、12219↔12219** 零残留；iptables DOCKER-USER/INPUT 规则全清（清单留证 `/root/g5-iptables-evidence.txt`），platform-net→DM 连通恢复（RESTORED）。
- 可单独执行：中转桶对象清空（`mc rm --recursive` 或 minio SDK）；`ods_ep` 两张 edge 表 DROP；SeaTunnel 回 `2.3.13-dataos.3`；control-plane/quality-runner 回旧 tag（`.env` 旧值保留）；MiNiFi conf 恢复 `conf-backup-g5-20260820-185644`。
- 安全口径：DM/S3/Doris 口令仅存凭据服务与远端 `.env`（0600）；落库任务配置只含 credentialRef；样本证据列白名单 + ID 哈希；本报告只含行数/结构/批次号，无 PHI。

## 组件版本留档

| 组件 | 版本/tag |
| --- | --- |
| control-plane | `0.1.0-hospital-edge-g5-20260820` |
| quality-runner | `0.1.0-hospital-edge-g5-20260820` |
| seatunnel | `2.3.13-dataos.4`（+connector-file-s3，SHA256 见 manifest.env） |
| rustfs | 现行（桶 dataos-edge-relay） |
| MiNiFi | apache/nifi-minifi:2.10.0 + aws 双 NAR + DM 驱动（容器层） |
