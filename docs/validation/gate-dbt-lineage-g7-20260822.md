# G7 验收报告：dbt 摄取与列级血缘 — 2026-08-22

对照方案 `docs/dbt-lineage-g7-review-and-plan-20260822.md`。结论：**5/6 通过、
1 项如实降级**——声明式列级血缘（MPI 链）全链交付（OM 登记 + BFF 投影 + 门户
展示）；质量测试面以「控制面自有质量域」呈现（原 OM TestCase 路径因工具链
双重死点降级，证据链完整，见偏差 #1/#2）；dbt 产物兼容链已打通并可复用
（manifest v11 / catalog v1 / run-results v5）。

## 一、验收表

| # | 项目 | 结果 | 证据 |
| --- | --- | --- | --- |
| A1 | dbt 产物 | ✅ | 分源生成链：临时容器 dbt-core 1.7 + dbt-mysql 连 Doris 产 manifest v11（parse 不连库）/catalog v1（docs generate 只读）；runner 原生 dbt 1.10 跑真实测试产 run-results v6，自动降维 v5（`dbt-compat-rr-downgrade.py` 收敛器）；工程 yml 副本经 `dbt-compat-yml-downgrade.py` 降键名（repo 面向 1.10 不动）；产物留档 `/root/om-g7/artifacts/` |
| A2 | 质量测试资产化 | ⚠️ 降级 | OM TestCase 不可达（偏差 #1/#2 双重死点）；**改由控制面自有质量域承接**：`GET /api/v1/assets/{fqn}/quality-tests`（registry + 最近 run，dataset 解析 = 库.表 段匹配 + 配置映射），edge 表返回 4 条 EP 规则、`cfptzt-values` 带 G5 真实结果（SUCCEEDED/passed）；门户资产详情「质量测试」段呈现（截图）；直登 registrar（`om-dbt-testcases.py`）留档待 OM 修复后启用 |
| A3 | 声明式血缘 | ✅ | MPI 链 2 边 + 7 条列级映射经 `PUT /lineage`（UUID 端点引用）登记；逐边读回校验 PASS（source_key→identity_a/identity_b、tenant_id→tenant_id、pair_id/identity_a/identity_b→同名）；幂等重跑边数不变（2 OK + 2 SEEN）；声明清单 `mpi-declared-lineage.json` 与登记内容一致（含依据注释） |
| A4 | 门户口径 | ✅ | 血缘节点展示列级映射（下游按声明、上游镜像；短列名）；资产详情质量测试段（规则/数据集/最近结论/完成时间）；demo 构建零改动（qa 双脚本过） |
| A5 | 回归与门槛 | ✅ | G6 三库对账仍零差异（mpi 表 3 张完好）；OM 既有资产零删除；control-plane `mvn test` 130/130（新增列级投影与 quality-tests 测试）；前端 tsc/vitest 9/9/qa/build 全绿 |
| A6 | 留证 | ✅ | `dbt-lineage-g7-portal-mpi-column-20260822.png`、`dbt-lineage-g7-portal-quality-tests-20260822.png`、`dbt-lineage-g7-om-mpi-lineage-20260822.png` |

## 二、与方案的偏差（实施实录，全部有诊断证据）

1. **OM dbt connector 对 Doris 不可用（结构性）**：三层问题逐一穿透——
   a) workflow 语法：source.type 须小写 `dbt`、`dbtConfigType: local`、不需要独立 Dbt 服务实体（挂 doris-dataos 上）；
   b) 产物版本：dbt 1.10 产 manifest v12/run-results v6，OM 1.5.11 的 dbt_artifacts_parser 只吃到 v11/v5（v12 有 615 处结构差异，剥字段不可行）→ 分源生成链解决；
   c) **Doris 无 database 层**：connector 解析表 fqn 时 manifest 的 `database=None` 传透，TestCase/DataModel 的实体解析全部返回 None（`Unable to find the table 'None'`），无解于配置层。
2. **OM 实例 testDefinitions 端点损坏**：GET by name 与 POST 均 500（内部 NotFoundException），内置测试定义 0 条（seeding 缺失）；重启 OM 未恢复。直登 TestCase 的 API 路径因此不可用（ registrar 已写好留档）。
3. **质量测试面数据源改道**（G7-5 修正）：BFF 从 control-plane 自有质量域（`data_os.quality_rule_registry` + `quality_rule_runs`）读取——质量规则的一等资产本就在控制面，元数据侧同步延后；分层更贴合「门户聚合」架构。
4. OM 1.5 addLineage 端点是 `PUT /lineage` 且只认 UUID 实体引用（fqn 被拒 `id must not be null`）；POST 会 405→500。
5. dbt-mysql 1.7 连 Doris 可用于 parse/docs generate（只读），但 `dbt test` 会话开事务被 Doris 拒绝（`This is in a transaction...`）——测试执行仍由 runner 原生 dbt 1.10 承担（真实结果）。
6. dbt 1.7 不识别 `data_tests:` 键与 `arguments:` 包装（1.8+ 语法）——生成侧对工程副本做结构降级（repo 不动）。
7. 摄取流程中 OM_JWT 会过期（生成链含 pip install 与多轮降维迭代）——摄取前重签。

## 三、部署面留档

- control-plane `0.1.0-dbt-lineage-g7-20260822`（构建目录 `/root/om-g7-build/control-plane`）；portal-dist 已更新（回滚备份 `portal-dist.pre-g7-20260822`）。
- 摄取/登记脚本远端副本 `/root/om-g7/`；dbt 产物 `/root/om-g7/artifacts/`。
- OM 侧新增实体：声明式血缘边 2 条（含列级映射），无服务实体新增；Dbt connector 尝试过程的残留已确认无实体（服务创建 400 未落）。

## 四、延后清单（承接）

- OM TestCase / DataModel：待 OM 升级（≥1.6）或 testDefinitions 端点修复后，用留档的 registrar 与产物链启用（`om-dbt-testcases.py` + `om-dbt-ingest.sh`）
- dbt DataModel 的门户呈现（表详情 SQL/模型 tab）
- dbt 测试结果的周期同步（现为摄取时一次性）
- 安全收敛批（deploy/.env root 口令清理、Doris root/OM demo 口令轮换）
- OM 重启后 `/system/config/health` 500 的跟踪（API 面正常，资产无损）
