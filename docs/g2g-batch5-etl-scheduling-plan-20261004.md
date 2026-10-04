# G2G 批次 5 · ETL 调度中文化（规划，2026-10-04）

> 依据：覆盖矩阵 §G2G 批次 5：「etl 域 15 组件的交互设计照搬，接 DolphinScheduler」；缺口 #3「周期调度接线（DolphinScheduler API 化接入 job/run 域）」。参考物：dep-web `views/etl`（EtlWorkbench 多页签工作台 495 行、EtlDashboard 412 行、EtlTaskManagement 250 行、EtlTaskInstance、SchedulerConfig 302 行、ExecutorConfig 159 行、BatchTask 403 行、EtlTaskGroup 六文件；`network/apis/etl.js` 509 行）。

## 勘察结论（两端现状）

### nema etl 域（自研 quartz 调度的中文封装）

- 后端为**自研调度域**（jobDetail/jobGroup/jobInstance/executor/alert，quartz 驱动），不是 DS——data-os 已选型 DolphinScheduler，故**只搬交互语义，引擎换 DS**。
- 调度语义（SchedulerConfig）：调度策略三态——**手动**（MANUAL，不周期）/ **周期**（CRON，easyCron 编辑 + 下次执行时间预览）/ **延迟一次**（DELAY，未来某时刻跑一次）；周期的简易形态（RATE）= 调度周期（日/时/分）+ 调度间隔 + 调度时间/时间范围，可切高级模式直接编辑 cron；**生效日期**（起止窗口）。
- 实例运维（EtlTaskInstance/jobInstance API）：分页列表、挂起/终止/恢复/重试/批量重试/批量移除、日志查看（getLog）、执行进度。
- 执行器配置（ExecutorConfig）：最大执行时长/重试次数/重试间隔/最大排队数/任务依赖（强/弱）。
- 任务组（etlTaskGroup）：多任务成组、组级调度与启停、发布/未发布。
- 工作台（EtlWorkbench）：目录树 + 多页签编辑（Monaco/easyCron 重型组件）。

### data-os 已有

- **DS 3.4.1 已部署 dev**（deploy/dev/dolphinscheduler/ compose + token 轮转器）；生产 compose 同在。
- **DolphinSchedulerExecutorAdapter 已交付**（手动触发）：预发布工作流绑定（job config 的 `dolphinscheduler` map：projectCode/workflowDefinitionCode）→ `executors/start-workflow-instance` 提交 + 实例状态轮询 + 状态归一；SchedulerTokenProvider token 管理、AdapterHttp 共享基建。
- 门户采集任务域：任务 CRUD/结构化配置（批次 1）/运行/重试/同步；**无周期调度、无调度实例面**；DS 执行通道的任务无门户创建入口。

## 映射裁决

1. **不建平行调度器**：DS 为唯一调度引擎（唯一状态机红线）。nema 自研 quartz 域（jobDetail/jobInstance/executor）不平移，其交互语义由 DS API 的中文化代理承接。
2. **任务开发/DAG 编辑不平移**：nema 的 EtlSql/EtlPython/Monaco/工作台多页签是「自研调度需要编辑器」的产物；DS 自带工作流编辑器（平台运维卡已有直达技术入口），门户不重建。任务开发仍在 DS，data-os 负责**运行面**（调度/实例/补数/日志）中文化。
3. **任务组不建平行体系**：DS workflow 即编排单位（多任务 DAG 在 DS 内编排），data-os job 绑定 workflow；nema 组级发布/停止映射为 workflow 调度上线/下线与实例操作。
4. **调度语义照搬（第一刀）**：策略三态保留——手动（无调度）/ 周期（cron）/ 延迟一次（精确时刻 cron + 窗口收口）；简易模式四类可精确编译 cron 的预设（每天 HH:mm / 时段内每小时 / 时段内每 N 小时 / 时段内每 N 分钟），覆盖不了的表达（如跨月每 N 天）明示走高级模式；「下次执行时间」预览用 **DS 自带 preview 端点**（引擎自身计算，避免本地再实现 cron 语义漂移；DS 不可用时退 Spring CronExpression 并标注来源）。
5. **调度状态不落 data_os 表**：调度是 DS 资产——schedules create/update/online/offline/list 全代理，data-os 侧零本地状态零漂移（与批次 2 规则台账不同：规则是 data-os 资产，调度是引擎资产）。变更审计依赖 DS 侧日志（记边界）。
6. **调度实例可见性**：DS 定时触发的运行不经过控制面 run 创建——**调度域以 DS 为唯一事实源**，门户实例列表实时代理 DS 实例 API（按 job 绑定的 workflow 过滤）；control-plane `ingestion_runs` 保持「门户/API 发起的运行」语义，不建对账同步（第二刀）。
7. **补数（backfill）**：DS 原生 `execType=COMPLEMENT_DATA` + scheduleTime 区间，语义即 nema 无显式对应但为其「批量重跑历史」的正路（第二刀）。

## 第一刀：周期调度接线（本刀）

### 后端（control-plane 新 `schedule` 域 + executor 包扩展）

1. `DolphinScheduleClient`（executor 包，复用 SchedulerTokenProvider/AdapterHttp/同 base-url 配置）：
   - `list(projectCode, workflowDefinitionCode)`：DS `GET /projects/{p}/schedules`（3.4 workflow 命名，process 别名兜底同适配器先例）过滤本 workflow；
   - `upsert(...)`：create（schedule JSON 串：crontab/starttime/endtime/timezone + warningType/failureStrategy）或按既有 schedule id update；
   - `online(scheduleId)` / `offline(scheduleId)`；
   - `preview(crontab, start, end, timezone)`：DS `POST /projects/{p}/schedules/preview`。
2. `JobScheduleController`：
   - `GET /v1/jobs/{id}/schedule`：校验 executor=DOLPHINSCHEDULER + binding 存在（否则 409 中文消息）→ DS schedule（含 id/online 状态/crontab/窗口/下次触发）；
   - `PUT /v1/jobs/{id}/schedule`：body {crontab, startTime, endTime, timezone, warningType} —— 保存（新建或更新，保持当前上下线状态语义：新建后不自动上线，由显式上线动作接管）；
   - `POST /v1/jobs/{id}/schedule/online`、`POST /v1/jobs/{id}/schedule/offline`、`DELETE /v1/jobs/{id}/schedule`（回到手动）；
   - `POST /v1/jobs/{id}/schedule/preview`：{crontab, startTime, endTime} → 未来 5 次触发时间。
   - cron 校验：Spring CronExpression 6 位（DS quartz 同构）；非法 400。
3. 任务创建/配置补 DS 通道入口（后端零改动——executor 本就是自由字段）。

### 前端（prototype）

4. 新建任务表单：执行通道下拉（中心采集执行器 SEATUNNEL / 平台调度 DolphinScheduler）；选 DS 时 binding 两字段（项目编号/工作流定义编号）写入 config JSON `dolphinscheduler` 键。
5. 任务行「更多」菜单加「调度」入口（DS 通道任务）→ 调度配置抽屉：策略态展示（手动=无调度）、简易四预设 + 高级 cron、生效起止、下次 5 次预览、上线/下线/删除调度动作。
6. 任务列表执行通道列对 DS 任务显示调度徽标（周期·上线中 / 周期·已下线 / 手动）。

### 验收

- control-plane：`JobScheduleApiTest`（stub DS HttpServer：schedules create/update/online/offline/list/preview 全链；binding 缺失 409；executor 非 DS 400；cron 非法 400）+ 全量零回归。
- prototype：tsc + vitest + qa 链 + build 全绿；浏览器核验（mock DS）：DS 任务创建 → 调度抽屉（简易/高级切换 + 预览）→ 保存 → 上线 → 徽标变化 → 下线/删除。

## 第二刀预告（调度实例与补数中文化）

DS 实例分页代理（中文状态映射复用 normalizeStatus）+ 任务实例日志 tail + 终止/重跑 + 补数表单（COMPLEMENT_DATA 区间）+ 详情抽屉「调度实例」区块；EtlDashboard 简化统计（近 7 天成功率）酌情。

## 边界（预定记 backlog）

- DS 定时触发不产生 control-plane run 行（裁决 6，实例视图走 DS 实时拉取）。
- 调度变更无 data-os 侧审计（依赖 DS 日志）。
- 简易模式四预设之外的周期形态走高级模式手写 cron。
- ExecutorConfig（最大时长/重试/排队数/依赖）不在本批（DS workflow/task 定义侧参数，属任务开发面，裁决 2 不平移）。

## 进度注记（2026-10-05，第一刀交付）

第一刀（周期调度接线）已交付过 gate：docs/validation/gate-g2g-b5-scheduling-20261005.md（契约 3/3 + 全量 334/334 零回归；适配器重构行为保持零测试修改）。补充实施口径：JobConfigService 校验按执行通道分流（DS 绑定对象替代 env/source/sink 形状）；预览 DS 引擎优先、本地 fallback 标注来源。第二刀（调度实例/日志/补数 + DS 任务绑定编辑）待续。
