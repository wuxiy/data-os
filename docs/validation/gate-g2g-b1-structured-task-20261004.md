# Gate · G2G 批次 1 第二刀：采集任务深水区（表/SQL 双形态结构化任务）

- 日期：2026-10-04
- 依据：[g2g-batch1-collection-deepwater-plan-20261004.md](../g2g-batch1-collection-deepwater-plan-20261004.md) 第二刀实施设计
- 结果：**通过**（后端全量 BUILD SUCCESS 含 6 项新契约测试、前端 qa 链全绿、浏览器交互核验通过）

## 交付范围

### 映射裁决（nema → data-os）

| nema 概念 | data-os 落点 |
| --- | --- |
| 采集任务 → 子任务两级 | 坍缩为单级 job（一 job = 一表或一 SQL）；「表任务(批量)」= 表单多选表一次创建 N 个 job（前端循环） |
| OrderKey/序列键（ctlcol） | 时间类型序列键编译为 `${last_success_time}`/`${run_start_time}` 水位占位符，复用既有 checkpoint 机制；整数序列键仅作 `partition_column`，增量方式如实拒绝 |
| 字段白名单（allowCols） | 编译进 SELECT 列清单，保存前经 DatabaseMetaData 实校验；白名单缺序列键时自动补入 |
| 覆盖设置（OVERWRITE/APPEND） | 不设开关：目标表唯一键模型 + APPEND_DATA 提供 UPSERT 幂等（与既有临床模板同口径），全量可重跑 |
| 子任务/日志两级钻取 | 既有运行详情抽屉（run 时间线）+ 新暴露「上次成功水位」 |
| 任务复制（跨源 copy+check） | `POST /jobs/{id}/copy`：结构化任务按目标源重新实校验/编译；JSON 任务原样复制 |
| 实时日志（web terminal） | 不在本刀范围（外部执行器日志面既有渠道） |

### 后端（control-plane job 域）

- V23：`ingestion_job_configs.structured_json TEXT NULL`——结构化意图与编译产物同存；JSON 直接覆盖清空结构化意图（显式弃结构化）。
- `StructuredTaskSpec`（意图 record，form=TABLE/SQL + tables/columns/orderKey/mode/target*/sink*）+ `StructuredTaskCompiler`（校验 + 编译单一属主）：
  - 源必须 JDBC 且已登记连接（第一刀 connection_json），credentialRef 由登记连接注入——任务侧不重复填连接；
  - 表/列/序列键对着源目录实校验（经 `SourceExplorerService`，真实 DatabaseMetaData）；SQL 形态走第一刀只读语句校验（`assertReadOnlyQuery` 新公开入口）；
  - 编译产物沿用临床模板形状：env + source[Jdbc]{url/driver/query/partition_column?/credentialRef} + sink[Doris]{fenodes/database/table/label-prefix 按 jobId 派生/2pc/幂等 save mode}；
  - 增量仅允许时间类型序列键（DATE/DATETIME/TIMESTAMP），整数键拒绝并提示全量+幂等模型（外部执行器无整型位点回放，如实边界）。
- `SaveJobConfigRequest`/`IngestionJobConfig` 增可选 `structured`（兼容构造器，既有调用点零修改）；`JobConfigService.saveStructured` 服务端编译路径。
- `GET /jobs/{id}/config` 响应增 `structured` + `lastSuccessWatermark`（checkpoint 读端口）。
- `POST /api/v1/jobs/{jobId}/copy`（body `{sourceId?, name?}`），副本 DRAFT 落库不继承运行史。

### 前端（prototype）

- `controlPlane.ts`：`StructuredTaskSpec` 类型 + `saveStructuredJobConfig`/`copyIngestionJob` + config 响应扩展。
- `JobStructuredForm.tsx`：表/SQL 双形态（形态锁定于编辑态）、库表懒加载多选、字段白名单复选（类型标注）、增量序列键下拉（时间类型过滤）、SQL 测试按钮（复用受控查询端点）、目标库表/FE/凭据引用；编辑回填含水位提示。
- `DataIngestionPage`：新建任务抽屉「配置方式」切换（结构化表单/模板 JSON，结构化需源已登记连接）；配置抽屉对结构化任务渲染结构化编辑器（JSON 路径不变）；任务行「更多」菜单新增「复制」。

## 测试证据

- `StructuredTaskApiTest`（6 用例，共享 H2 作目标源 + 凭据服务真实落库）：表全量编译（白名单/连接注入/label-prefix/意图同存/水位空）、增量编译（水位占位符 + 白名单自动补序列键 + partition_column）、SQL 形态编译 + 写语句拒绝、四类负向（整型序列键增量/白名单列不存在/源未登记连接/缺 FE 地址）、复制重编译（意图随行 + 新 label-prefix + 目标源 404 原子回滚）、JSON 覆盖弃结构化意图。
- 后端全量 `mvn test` BUILD SUCCESS（既有 307 项零修改）；前端 tsc + vitest 28/28 + mock-audit + portal-interactions-smoke + build 全绿。
- 浏览器核验（mock 控制面 v2 + vite）：多选表批量创建 2 任务、单表增量（序列键下拉仅时间列）创建、结构化配置编辑器回填（表/白名单/序列键/水位提示）、任务复制（副本行出现）、SQL 形态 + 测试 SQL + 创建、视觉合格（分段开关/双列网格/chips/复选区截图核验）。

## 实抓并修复的缺陷

1. **编辑回填被挂载 effect 清空**：`JobStructuredForm` 源切换重置 effect 在挂载帧执行 `setSelectedTables([])`，把编辑回填的已选表/白名单当场清空（白名单/序列键区不渲染、保存禁用）。首版「首帧跳过」修复被 React StrictMode 双调用绕过（标记被第二次调用消费）；终版以「上次源 id」ref 判定真实切换，StrictMode 安全。
2. 测试凭据坑：H2 测试库口令为空，凭据 secret 带 `password` 键会以非空口令建连失败——契约测试凭据只带 `username`。

## 边界（记 backlog）

1. **增量仅时间序列键**：整数位点回放需外部执行器支持（SeaTunnel JDBC 无此能力），当前如实拒绝并给全量+幂等替代口径。
2. **结构化任务批量建为前端循环**：N 表 N 请求，无事务包边；中断会出现部分创建（每 job 独立完整，无半份状态）。规模大时后端可加批量端点。
3. SQL 形态的 `${last_success_time}` 占位符由编写者自行放入 WHERE（编译器不强制注入）；写错时增量退化为全量读取（目标表幂等兜底）。
