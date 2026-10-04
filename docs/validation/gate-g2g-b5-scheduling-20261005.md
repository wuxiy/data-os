# Gate · G2G 批次 5 第一刀：周期调度接线（DolphinScheduler）

- 日期：2026-10-04/05
- 依据：[g2g-batch5-etl-scheduling-plan-20261004.md](../g2g-batch5-etl-scheduling-plan-20261004.md)；参考物 nema `views/etl`（SchedulerConfig 调度语义 / EtlWorkbench 等 15 组件 IA）；覆盖矩阵缺口 #3
- 结果：**通过**（control-plane 契约 3/3 + 全量零回归 334/334、前端链全绿、浏览器全链核验 + 视觉合格）

## 交付范围

### 映射裁决落地

- **引擎换 DS、不建平行调度器**：nema etl 后端是自研 quartz 域，不平移；调度语义（手动/周期/延迟一次、生效窗口、下次执行预览）由 DS schedules API 的中文化代理承接。
- **调度状态零本地落库**：DS 为唯一事实源（schedules create/update/online/offline/delete/list/preview 全代理）；data-os 无新表无漂移。
- **任务开发/DAG 编辑不平移**：DS workflow 即编排单位，门户只做运行面中文化（规划裁决 2/3）。
- **JobConfig 校验按通道分流**：DS 通道任务 config = 工作流绑定对象（`dolphinscheduler.projectCode/workflowDefinitionCode`），不走 SeaTunnel 的 env/source/sink 形状（该分流使 DS 任务的 config 保存成为合法路径——修复了「DS 绑定装不进 config 校验」的真实缺口）。

### 组件

- **`DolphinHttp`（executor 包，抽取）**：DS API 共享 HTTP 通道——token 鉴权、401 上一令牌重试；运行适配器与调度客户端共用，消除鉴权语义漂移。**`DolphinBinding`（抽取）**：job config 的绑定定位与编号校验（消息与既有适配器逐字一致），提交/调度两域同源。
- **`DolphinScheduleClient`**：DS 3.4.1 schedules API（POST / PUT /{id} / {id}/online|offline / DELETE / GET 分页过滤 workflowDefinitionCode / POST /preview）；schedule JSON 串（crontab/starttime/endtime/timezoneId）；tenantCode 沿用适配器纪律（必须命名、生产禁 default）；process-schedules 老版本路径兜底；瞬态/401/403→503、其余→400 的方言分类同适配器。
- **`JobScheduleController`（job 域）**：`GET/PUT/DELETE /v1/jobs/{id}/schedule` + `POST .../schedule/online|offline|preview`。守卫：非 DS 通道 409、缺绑定 409（中文指向登记处）、未知任务 404、cron 非法/时间倒置 400。cron 校验走 Spring CronExpression（7 位 quartz 去年份位归一，DS 兼容两种位数）。预览优先 DS 引擎计算（source=DS），DS 不可达退本地并如实标注 source=LOCAL。
- **门户**：新建任务「执行通道」下拉（SeaTunnel / DolphinScheduler），DS 通道绑定两字段直入 config；任务行「更多 · 调度」入口（仅 DS 行）；`JobScheduleDrawer`——策略五预设（每天/时段内每小时/每 N 小时/每 N 分钟/延迟一次）编译为 cron + 高级模式直编、生效起止、编译结果实时呈现、未来 5 次预览（来源标签）、保存/上线/下线/删除（两步确认）。预设↔cron 双向识别（回填只认本组件编译产出的精确形态，其余归高级模式）。

## 测试证据

- `JobScheduleApiTest`（stub DS HttpServer 全状态机：建档/更新/上下线/删除/分页/预览 + 失败开关）：生命周期（手动→保存下线态→上线→下线→更新走 PUT 不重复建档→删除→幂等删除）；DS 契约参数断言（workflowDefinitionCode/tenantCode/schedule JSON 内 crontab+timezoneId）；预览双路（DS 固定 5 次 02:30 / 本地 fallback 升序且首个=窗口后首个 02:30，Asia/Shanghai→UTC 换算正确）；守卫四则（SEATUNNEL 409/缺绑定 409/未知 404/上线前置 409/cron 与时间格式与倒置 400）。
- 全量 `mvn test` 334/334 零回归（含适配器重构后的 DolphinSchedulerExecutorAdapterTest 8/8——**零测试修改**，行为保持达成；JobConfigService 通道分流的既有配置面测试零改动全绿）。
- 前端链全绿；浏览器核验（mock 控制面）：DS 任务创建（绑定字段→列表「平台调度」通道）→ 调度抽屉手动态 → 每天 02:30 编译 `0 30 02 * * ?` → 预览 5 次（DS 引擎标签）→ 保存（已下线态）→ 上线（上线中+下次触发）→ 下线 → 删除（两步确认）→ 回手动态；SEATUNNEL 行无调度入口。视觉判定合格（抽屉布局/遮罩层次/表单关联）。
- 实抓并修复三处：① 受控 select 高级模式显示回落（补 advanced option）；② submitJob 的 configMode 守卫把 DS 分支拦截（守卫放行 DS 通道）；③ 抽取 DolphinHttp 时 post/put 首路径漏挂 token 头——由既有适配器测试（token 断言）当场抓住，佐证抽取共用而非复制防线的价值。

## 边界（记 backlog）

1. DS 定时触发的运行不产生 control-plane run 行（调度实例视图=第二刀，实时代理 DS instances）。
2. 调度变更无 data-os 侧审计（依赖 DS 日志）。
3. 简易预设之外的周期形态（如跨月每 N 天）须高级模式手写 cron；「时段内每 N 小时」的分钟只随起始时刻（时段对齐到整点边界）。
4. 既有「配置」抽屉对 DS 任务仍显示 SeaTunnel 形状的模板编辑器（保存会被后端通道分流正确拒绝，但体验待第二刀改绑定编辑）。
5. 预览 LOCAL fallback 与 DS 引擎的 quartz 语义在罕见表达式（L/W/# 等）上可能不一致（DS 版本方言差异如实标注来源缓解）。
6. dev 真实 DS 链路（compose 起的真实 schedules API + 工作流上线触发）未在本刀核验（本地契约面齐备；dev 侧部署同步欠账沿批次 2-4 同批）。

## 第二刀预告（调度实例与补数中文化）

DS 实例分页代理（中文状态映射复用 normalizeStatus）+ 任务实例日志 tail + 终止/重跑 + 补数表单（COMPLEMENT_DATA 区间）+ 详情抽屉「调度实例」区块；DS 任务「配置」抽屉改绑定编辑。
