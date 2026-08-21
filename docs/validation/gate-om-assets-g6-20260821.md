# G6 验收报告：OM 资产目录补全（edge 表 + quality/mpi 库）— 2026-08-21

对照方案 `docs/om-assets-g6-review-and-plan-20260821.md`。结论：**6/6 通过**，
三库 9 表入 OpenMetadata、逐表列对账零差异、门户口径（库切换 + 三库聚合摘要）
呈现并截图留证。实施中发现并修复两个 OM/Doris 侧真实缺陷（见「与方案的偏差」）。

## 一、验收表

| # | 项目 | 结果 | 证据 |
| --- | --- | --- | --- |
| A1 | 摄取账号 | ✅ | `dataos_om_ro`（`%` 来源）授权仅 `ods_ep`/`dataos_quality_acceptance`/`dataos_mpi` 三库 SELECT + `default_compute_group` USAGE；既有账号 `dataos_quality_ro`/`dataos_mpi`/`dataos_quality_dbt` 授权前后 md5 一致（`f86fb816…`/`ae6fa8aa…`/`fb5e2499…` 零变更）；口令仅存开发机 `/root/.doris-om-ro-pw`（0600），零口令入 Git |
| A2 | 资产入库 | ✅ | OM 三库 9 表：`ods_ep` 5（`ep_mz_cfzb` 53 列、`ep_mz_cfzb_inc` 53、`ep_mz_cfzb_edge` 53、`ep_mz_ypcfmx` 36、`ep_mz_ypcfmx_edge` 36——G5 edge 两表入目录）、`dataos_quality_acceptance` 1（`quality_sample` 4）、`dataos_mpi` 3（`mpi_source_identity` 14、`mpi_candidate_pair` 6、`mpi_match_result` 9） |
| A3 | 结构对账 | ✅ | `om-ingest-doris-assets.sh` 逐库逐表对账：9/9 PASS、表清单零差异、合计「三库 9 表 264 列」；列类型差异无 |
| A4 | 门户口径 | ✅ | live 资产目录三个库 tab（电子处方 ODS/质量验收库/患者主索引库）可切换，mpi 视图 3 表列数正确；summary 聚合 `tableCount=9`/`columnCount=264`、`schemas` 三库；证据栏「摄取范围」显示三库全称；demo 构建静态页零改动（qa 双脚本过） |
| A5 | 回归 | ✅ | 既有 OM 资产零删除：`superset-dataos` 仪表盘「电子处方嵌入验证」在、`ep_mz_cfzb` 血缘下游 2 边（表→数据模型→仪表盘）在、`doris-via-mysql` 遗留 17 表在；quality-runner/mpi-service/EP 采集链路零触碰；control-plane `mvn test` 128/128（含新增 2 个多库 summary 测试）、前端 tsc + vitest 9/9 + mock-audit + portal-interactions-smoke + build 全绿（既有测试除 summary 语义断言随功能更新外零修改） |
| A6 | 留证 | ✅ | `docs/validation/assets/om-assets-g6-portal-ods-ep-20260821.png`、`om-assets-g6-portal-mpi-20260821.png`、`om-assets-g6-om-mpi-schema-20260821.png`、`om-assets-g6-om-database-overview-20260821.png` |

## 二、E 步执行记录

| # | 步骤 | 结果 |
| --- | --- | --- |
| E1 | 模板三库 + `om-ingest-doris-assets.sh`（多库对账）+ `om-readonly-account.sql`（幂等建号） | 84602a7 / bf3937f / 77f7d79 |
| E2 | 远端建 `dataos_om_ro`（随机口令 0600 文件）+ 授权 + 前后对比留证 | grants 快照 md5 前后一致 |
| E3 | 三库摄取 + 逐表对账（含两处缺陷修复，见 §三） | 9/9 PASS 零差异 |
| E4 | BFF summary 多库聚合（schemas 配置化）+ 前端库切换（`useApiResource.reloadKey`） | ea7e93b，mvn 128/128、前端全绿 |
| E5 | control-plane `0.1.0-om-assets-g6-20260821` + portal-dist 部署；API 与浏览器验证、4 张截图 | 容器 healthy；18081 API 与 UI 实测通过 |
| E6 | 本报告 + CONTEXT.md 术语 + 提交推送 | 见 Git |

## 三、与方案的偏差（实施发现，均如实记录）

1. **OM `PUT /services/databaseServices` 静默忽略 connection 字段**（载荷性缺陷）。
   G1 起脚本的「PUT 更新服务连接」路径从未真正生效——服务实体始终持有
   `dataos_quality_ro`，而 workflow 从服务实体读连接，该账号不可见 `dataos_mpi`，
   导致 mpi 库整体缺位且无任何报错（Filtered 计数恰好掩盖）。修复：provision 改
   PATCH（`application/json-patch+json`）+ 更新后回读校验 username，不匹配即
   fail-fast。已回写 CONTEXT.md「摄取」条目。
2. **Doris 3.x 要求账号具备 compute group USAGE 才能 `SELECT ... FROM
   information_schema.tables`**（OM Doris connector 的库表枚举路径）。首版授权
   缺这条时 `SHOW TABLES` 直查正常（现象隐蔽），information_schema 查询则报
   `CURRENT_USER_NO_AUTH_TO_USE_ANY_COMPUTE_GROUP`。已补
   `GRANT USAGE_PRIV ON COMPUTE GROUP default_compute_group` 并注明缘由
   （G1 的 `dataos_quality_ro` 历史上已具备，故 G1 未暴露）。
3. **OM 1.5 `?fields=columns` 偶发空响应**：实体写入后的短窗内 GET 可能返回空
   columns（每轮对账随机一张表「列空」，复查即恢复）。对账脚本已加「空则隔 2s
   重取一次」的重试，判定标准不变。
4. Doris `SET PASSWORD` 语法要求 `PASSWORD('明文')` 包裹（裸字符串按 hash 解析
   报 1372），SQL 模板已注明。
5. **凭据漂移记录**：`deploy/.env` 的 `DORIS_PASSWORD` 现值实为 **Doris root**
   口令（与键名语义 `dataos_quality_ro` 不符），G1 对账脚本按旧语义读它时
   Access denied 才暴露。引用面盘点为三个**未部署的占位服务** + dbt 说明，
   无活跃消费者；本批不动（G6-6），处置入延后清单（安全收敛批）。

## 四、部署面留档

- 镜像：`medical-platform/data-os-control-plane:0.1.0-om-assets-g6-20260821`
  （构建目录 `/root/om-g6-build/control-plane`）；`.env` 的
  `DATAOS_CONTROL_PLANE_IMAGE` 已切换；portal-dist 已更新
  （回滚备份 `portal-dist.pre-g6-20260821`）。
- 摄取脚本远端副本：`/root/om-g6/`（scripts + config + doris）。
- `dataos_om_ro` 口令：`/root/.doris-om-ro-pw`（0600）；回滚 = drop user +
  服务连接 PATCH 回 `dataos_quality_ro`（口令在 quality-runner 容器 env 有源）。

## 五、门槛

- 行为保持：demo 构建零改动；live 组件扩展不破坏既有页面；OM 既有实体零删除。
- 全绿：control-plane 128/128；前端 tsc/vitest/qa/build 全过。

## 六、延后清单（承接 G1/G6 方案，未变化项不再列）

- `dataos_quality_audit` 空库纳入（有表后按需）
- dbt 摄取 + 列级血缘（G7 候选主体）
- `deploy/.env` `DORIS_PASSWORD`（root 口令）清理与 Doris root 口令轮换、OM demo/ingestion-bot 口令轮换（安全收敛批）
