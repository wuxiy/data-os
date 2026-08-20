# G1 血缘锚点验收报告（OpenMetadata 摄取 ods_ep）— 2026-08-20

对照清单：`docs/lineage-g1-g2-review-and-plan-20260820.md` §四（A1-A6，映射 gate-hospital-edge L5.1-L5.4）。全部结论基于开发机 172.16.65.59 实测。

## 结果：6/6 通过

| # | 项目 | 结果 | 证据 |
| --- | --- | --- | --- |
| A1 | 资产摄取（L5.1） | ✅ | OM 新建服务 `doris-dataos`（serviceType=Doris，账号 `dataos_quality_ro` 只读），`ods_ep` 3 表（`ep_mz_cfzb`/`ep_mz_cfzb_inc`/`ep_mz_ypcfmx`）元数据入库；workflow Success 100%、Errors 0；`deploy/scripts/om-ingest-ods-ep.sh` 幂等（重复执行输出「服务已更新」+ 对账 PASS） |
| A2 | 资产可查（L5.2） | ✅ | 脚本对账：表数 Doris=3 OM=3；逐表列名比对 `ep_mz_cfzb` 53 列、`ep_mz_cfzb_inc` 53 列、`ep_mz_ypcfmx` 36 列，零差异；UI 表详情页 53 列与 Doris `SHOW COLUMNS` 一致（截图 `om-ods-ep-cfzb-schema-20260820.png`） |
| A3 | 血缘呈现（L5.3） | ✅ | Superset 摄取（服务 `superset-dataos`，范围限「电子处方嵌入验证」仪表盘）：dashboard `superset-dataos.2`、datamodel `superset-dataos.model.2`、chart `superset-dataos.4` 入库；血缘链 **dashboard → datamodel → `doris-dataos.default.ods_ep.ep_mz_cfzb`** 在 OM UI 可见（截图 `om-ods-ep-cfzb-lineage-20260820.png`）。dbt/质量层未摄取（方案 D8 延后） |
| A4 | 入口留证（L5.4） | ✅ | 全程经网关 8445 访问（Keycloak SSO → OM UI）；截图 3 张归档 `docs/validation/assets/`。门户血缘页在 G2 完成前保持静态边界（如实标注，未虚报） |
| A5 | 权限 | ✅ | 摄取账号 `dataos_quality_ro` 对 Doris 仅 SELECT（上轮已授）；新 Keycloak client `dataos-om-ingest`（服务间专用，硬编码 claim=ingestion-bot）secret 仅存开发机 `/root/.om-ingest-client-secret`（0600），令牌现用现签、TTL 短；摄取 yaml 模板零口令入 Git；OM 中遗留服务 `doris-medical` 的 root 连接为 data-ops 遗留现状（处置列入延后清单） |
| A6 | 回归 | ✅ | 遗留服务 `doris-medical`/`doris-via-mysql` 及其 17 张表零删除零修改；data-os 控制面/质量/MPI 链路零变更（本轮无任何 compose/服务重启——仅新增一次性摄取容器） |

## 关键实施事实

1. **摄取执行形态**：`openmetadata/ingestion:1.5.11` 一次性容器（`docker run --rm --network medical-platform_platform-net`），连接保存在 OM 服务实体内，workflow yaml 只含 serviceName + filter + 令牌。无常驻 ingestion/Airflow。
2. **OM 表全限定名为四段**：`doris-dataos.default.ods_ep.<table>`（Doris 无独立 database 概念，OM 以 `default` 充当 database 层）——G2 BFF 查询必须带 `default` 段。
3. **Superset 血缘的解析链**：chart.datasource_id → Superset 数据库连接 parameters → `get_database_name_for_lineage`（Doris 无 `supportsDatabase` → 取 connection.databaseName 或 `default`）→ fqn 与摄取表同构，`lineageInformation.dbServiceNames=[doris-dataos]` 显式声明后匹配成功。
4. **OM 血缘方向语义**：Superset connector 把 dashboard/datamodel 建为表的**上游**边（消费端在左）。这是 OM 1.5.11 既定行为，演示时按「影响/消费链」口径解释，不修改。

## 与方案的偏差（3 处，均已按 D5 如实记录）

1. **spike 仪表盘无布局**：`dashboard 2` 的 `position_json` 为空且未挂图表（spike 只建了独立 chart 4）。已用 Superset API 补挂（v2 布局单图 CHART-4，含 CSRF 双提交），属于对 spike 遗留环境的补全，不改业务数据。
2. **OM 1.5 血缘 API 的 edges 响应**：`/lineage/table/name/{fqn}` 返回 nodes 完整但 edges 数组为空（UI 血缘图正常）。G2 BFF 以 nodes + 实体类型拼图，不依赖 edges 字段。
3. **demo 用户**：OM 自注册关闭，SSO 首登被拒；已用 ingestion-bot API 预创建 `demo` 用户（默认浏览权，DataConsumer 角色赋权需 admin，未强提）。Keycloak demo 口令已随机重置（`/root/.om-demo-pw`，0600）。

## 过程修复留档（脚本/模板最终版已包含）

- ingestion yaml 三处 schema 修正：`openMetadataServerConfig.host` → `hostPort`；sink `metadataRest` → `metadata-rest`；workflow source 不接受 `connection` 键（连接在服务实体内）。
- dashboard service 创建的 connection 嵌套形状：`config.connection` 内不得带 `type` 键（extra_forbidden）。
- 一次性容器以 `--user 0:0` 运行读取 root 0600 渲染文件；mysql 对账口令经 `MYSQL_PWD` 注入。
- `entity_relationship` 表不含血缘边（从属关系才存那）；血缘验证走 lineage API/UI。

## 遗留与下一步

- **G2**（下一批）：control-plane `OpenMetadataClient`（dataos-om-ingest client credentials + 缓存）+ `LineageApi` 四个读 API + 门户资产/血缘页接真（`runtimeMode` 分流）。
- 延后清单见方案 §五（quality/mpi 库纳入、dbt 层、摄取编排进外部运行状态机、`doris-medical` root 连接收敛）。
