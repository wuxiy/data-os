# Gate · G2G 批次 5 第二刀：调度实例与补数中文化（批次收官）

- 日期：2026-10-05
- 依据：[g2g-batch5-etl-scheduling-plan-20261004.md](../g2g-batch5-etl-scheduling-plan-20261004.md) 第二刀预告；参考物 nema `EtlTaskInstance`/`jobInstance` API（挂起/终止/重试/日志/进度）
- 结果：**通过**（control-plane 契约 3/3 + 全量零回归 337/337、前端链全绿、浏览器全链核验 + 视觉合格）

## 交付范围

### 映射裁决落地

- **调度实例以 DS 为唯一事实源**：DS 定时触发与补数产生的实例不进 control-plane run 表，门户实时代理（run 表保持「门户/API 发起的运行」语义，两域不混淆）。
- **nema 实例运维动作的 DS 对应**：kill→STOP（executors/execute）、retry→REPEAT_RUNNING、getLog→/log/detail tail；「挂起/恢复/批量/进度」不在本刀（记边界）。
- **补数**：DS 原生 `execType=COMPLEMENT_DATA` + scheduleTime 日期区间（逐日触发），复用第一刀的 tenantCode 纪律。
- **DS 任务「配置」抽屉改绑定编辑**（第一刀边界 ④ 关闭）：模板 JSON 编辑器对 DS 任务替换为绑定两字段，保存走既有 PUT /config（后端通道分流已在第一刀就位）。

### 组件

- **`DolphinInstanceClient`（executor 包）**：实例分页（`GET /projects/{p}/workflow-instances`，workflowDefinitionCode 过滤 + stateType/日期）、任务实例（`GET .../{id}/tasks`，3.4 `{taskList}` 与旧版数组双形态）、日志 tail（`GET /log/detail?taskInstanceId=&skipLineNum=0&limit=`）、实例动作（`POST /executors/execute` workflowInstanceId+executeType）、补数（`start-workflow-instance` + COMPLEMENT_DATA）。token/瞬态分类与既有 DS 客户端同方言。
- **`JobScheduleInstanceService` + `JobScheduleInstancesController`**：`GET /v1/jobs/{id}/instances`（分页/状态过滤正则白名单/日期归一；state 经 `DolphinSchedulerExecutorAdapter.normalizeStatus` 归一六态、rawState 保留 DS 原文）；`GET .../{iid}/tasks`；`GET .../{iid}/tasks/{tid}/log?lines=`（默认 200 上限 1000 行，只读 tail）；`POST .../{iid}/stop|retry`（**服务端状态前置校验**：仅运行中可终止、仅终态可重跑，409 中文消息）；`POST .../backfill`（yyyy-MM-dd 区间、倒置/超 31 天/坏格式 400）。通道/绑定守卫复用调度域（requireDolphinJob 提为包内共享）。
- **门户调度抽屉双页签**：「调度配置 | 调度实例」。实例页签=补数表单（日期区间 + 按日补跑）+ 实例分页列表（六态中文徽标/起止/运行次数/worker 主机 + 行内 终止（仅运行中）/重跑（仅终态）/任务与日志展开）+ 任务行（状态/起止 + 日志尾部 200 行 <pre>）。
- **配置抽屉绑定编辑**：DS 任务显示绑定两字段 + 保存绑定（useAction 惯用法），SeaTunnel 结构化/JSON 路径零改动。

## 测试证据

- `JobScheduleInstancesApiTest`（stub DS 全状态机：实例分页/任务/日志/execute/补数建实例）：列表归一（RUNNING_EXECUTION→RUNNING、FAILURE→FAILED、rawState 保留）+ 状态过滤正则（`'; drop` 400）+ SEATUNNEL 任务 409；任务/日志（lines=3、limit=1000 收敛断言在 stub 调用串）；终止运行中→STOP→再终止 409、重跑失败→RUNNING；补数 3 天→3 实例 + DS 契约参数（execType/tenantCode/scheduleTime 区间逐字）+ 倒置/超限/坏格式 400。
- 全量 `mvn test` 337/337 零回归（含第一刀 334 + 实例 3；`normalizeStatus` 提 public、requireDolphinJob 提包内可见均为零行为变更）。
- 前端链全绿；浏览器核验（mock）：实例页签首屏（种子两实例 成功/失败 + worker 主机）→ 任务展开（sql-抽取/shell-校验 中文状态）→ 日志尾部渲染 → 重跑（已终止→运行中、终止按钮随状态出现）→ 终止（→已终止）→ 补数 3 天（总数 2→5、补数行呈现）→ 配置抽屉绑定编辑（空态默认→填值→保存→列表 configPill CUSTOM）；视觉判定合格（实例块布局/状态徽标/动作区分离/补数表单对齐）。
- 实抓并修复两处：① mock 实例动作路由正则漏 stop|retry 分支（掉进 jobMatch 通配 404——批次 4 路由遮蔽教训的变体，路由独立分支必须完整覆盖子路径）；② 配置抽屉体分支补丁在早期脚本失败时被回滚丢失（footer 落了 body 没落，浏览器核验当场暴露——提交前以 tsc+浏览器双重验证兜住）。

## 边界（记 backlog）

1. 实例动作为异步指令（STOP/REPEAT_RUNNING 发出后状态以 DS 为准，门户靠手动刷新；无自动轮询）。
2. 任务实例日志为 tail 快照（默认 200 行，无翻页续读/下载；skipLineNum 续读能力已具备未暴露）。
3. nema 的挂起/恢复（PAUSE/RESUME）、批量重试/移除、执行进度条不在本刀。
4. 实例归属校验按「绑定工作流的实例分页 + 任务面兜底」双路（100 条分页外的历史实例以任务面为准）；极老实例可能 409 误拒（记边界，出现频率低）。
5. 补数逐日触发依赖 DS 调度器内部语义（并行模式 expectedParallelismNumber 未暴露，串行为默认）。
6. dev 真实 DS 实例/日志链路未核验（与第一刀同批 dev 部署同步欠账）。

## 批次收官

批次 5（ETL 调度中文化）两刀齐：周期调度接线（cut 1：配置/上下线/预览/通道入口）+ 调度实例与补数中文化（本刀：实例/日志/终止/重跑/补数/绑定编辑）。nema etl 域 15 组件中调度语义（SchedulerConfig/ExecutorConfig 的调度面）、实例运维（EtlTaskInstance 的终止/重跑/日志）与批量历史重跑（补数承接）均已落地；任务开发/DAG 编辑维持不平移裁决。G2G 剩批次 6（MPI 实战参数移植）、批次 7（Keycloak 统一认证）。
