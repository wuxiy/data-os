# G20 计划：构建 API 异步化（backlog AI-4）+ 6C 检查项继续补厚

> 2026-09-16。用户明示「完成 AI-4 和四问底稿里的『检查项继续补厚』」。
> AI-4（G18 记账）：build HTTP 化后 19s/2 千处方可接受（dev），生产大语料
> 超网关口径需任务态异步化 + 通知。补厚候选（G17 gate §五 + 四问底稿）：
> Contextual 加 FHIR 映射、Current 加语料水位类检测、Consumable 扩可消费面。
> 前置：G17（补厚 10→14 + EP 真实语料）、G18（build API 化 + 飞轮）、G19（再认证）。

## 一、G20-1 构建 API 异步化（AI-4）

### 方案裁决：控制面任务态，引擎保持无状态

**任务态属主是控制面，引擎 `POST /build` 同步语义零改动。**

- 引擎是声明式无库服务（api.py 文件头：「本服务无库」）——任务队列/状态留在
  引擎会破坏这一架构声明，且控制面轮询引擎再回写版本行是两层任务态；
- 编排内核（construct→assess→版本行回写）本就在控制面 `AIDataProductService`，
  异步化只是把「HTTP 请求线程内执行」改为「任务认领后后台执行」；
- **不进外部运行统一状态机**（`run/ExternalRunLifecycle`）：该状态机语义是
  提交-轮询-对账（SUBMITTING/UNKNOWN 对账、StaleSubmissionPolicy），服务于
  异步提交型的采集/质量复检运行；AI 构建是「单次同步 HTTP 调用、快速确定性
  终态」，无 UNKNOWN 对账需求。OM/dbt 摄取编排进外部运行是 P2（生产化批）
  的归口，届时 AI build 若需统一再迁移，本批不预支；
- 先例对齐：data-api 异步导出（P7/V14）——任务表 + CAS 认领 + 启动孤儿清算。

### 改动面

1. **V16 `data_os.ai_data_build_job`**：id / product_id(FK) / tenant_id /
   version_sn / recipe_ref / status（QUEUED→RUNNING→SUCCEEDED|FAILED）/
   result_json（构建段 + 评估摘要，与旧同步响应同构）/ error / created_by /
   created_at / started_at / finished_at。
2. **投递面**：`POST /ai-data-products/{id}/build` 改投递任务——
   202 + `{jobId, status: QUEUED, ...}`；守卫前置（引擎未装配 503 照旧）；
   **产品级互斥**：同产品存在 QUEUED/RUNNING 任务时 409（构建非幂等——
   `reset_before_write` 先清表，并发投递危险）；投递事务内版本行 build_status
   → RUNNING。recipeRef 解析序不变（请求 ?? 版本登记值）。
3. **执行面 `AIBuildJobWorker`**：@Scheduled 短间隔认领（CAS：仅 UPDATE
   QUEUED→RUNNING 赢家可执行）→ 提交专用单线程 ExecutorService（构建串行：
   Doris 写面安全，也不占用 Spring 调度线程跑长调用）→ 复用编排内核
   construct→assess→回写 → SUCCEEDED(result_json)；异常 → FAILED(error)，
   版本行 build_status=FAILED（readiness_json 保留上次评估结果，不抹）。
   **启动孤儿清算**：ApplicationReady 时 RUNNING 全置 FAILED（「服务重启中断，
   请重新发起构建」）——dev 单实例口径，多实例部署另议（P2/生产化批）。
4. **查询面**：`GET /{id}/build-jobs`（最近任务列表，含 result/error）——
   门户轮询消费。
5. **通知口径（诚实边界）**：任务终态持久化 + 门户呈现（轮询到终态即通知
   文案「构建完成 N chunks → 评估 Overall X」/失败明示 error）。**webhook
   外发不锚治理发件箱**——`governance_notifications.issue_id` 是 NOT NULL
   FK（治理问题锚定），AI 构建事件塞入即污染域语义；独立通知 outbox 记
   backlog（生产化批候选，与 P2 编排同窗）。

### 行为变化（特性变更，记录在案）

- `POST /build` 从「同步返回评估摘要」变为「202 + 任务」——调用方（门户、
  E2E 脚本）全部跟改；响应摘要移入 job.result_json（结构同构，视图复用）。
- 版本行 build_status 新增 RUNNING/FAILED 真实态（原仅 REGISTERED/SUCCEEDED）。

## 二、G20-2 检查项补厚（14 → 17）

| 新检查项 | 维度 | 形态 | 口径 |
|---|---|---|---|
| corpus_source_lag | current | doris_metric（requires_table chunks_ep） | 语料构建水位落后源水位的时长（h）：`max(chunks_ep.built_at)` vs `max(ep_mz_cfzb.UPDATE_TIME)`；正=语料陈旧。lower_better，pass 0 / warn 720h（dev 源静默口径同 freshness，生产另立 SLA） |
| artifact_availability | consumable | **rustfs_probe（新探针类型）** | 产物双落在册一致：RustFS `{prefix}/{最新版本}/data/chunks.jsonl` 行数 == Doris chunks_ep COUNT(*)（1.0/0.0）；requires_table 守卫，表不在册 N/A |
| fhir_mapping_coverage | contextual | doris_metric（requires_table dataos_ai.fhir_mapping，sql_file: null 占位） | 语义标准映射就绪位（patient_split_leakage 同款条件生效）；FHIR 映射仓未建期间 N/A，表存在后须补真实 SQL（sql_file null + 表存在 = 探针失败 FAIL，显式暴露「检查未实现」） |

- **requires_table 守卫前置**：从 doris_metric 分支提到所有 check 类型之前
  （rustfs_probe 也受表存在性守卫）。
- **LOINC 不做**：EP 域无检验指标数据（门诊处方域），不造无数据支撑的空头
  检查——四问候选「FHIR/LOINC」按域数据实情裁剪为 FHIR 占位（诚实边界）。
- 权重：corpus_source_lag / artifact_availability / fhir_mapping_coverage 均
  major、1.0，入两个 profile；N/A 剔除聚合语义不变。预期 dev 评估：
  15 PASS + 2 N/A（patient_split、fhir），Overall 维持 1.0/CANDIDATE。

### 已知实现坑（dev 实测校准）

- built_at 是 UTC ISO8601 字符串（VARCHAR），UPDATE_TIME 是本地 DATETIME——
  SQL 内 `SUBSTR(…,1,19)` + `REPLACE(T,' ')` 换算；UTC vs 本地 +8h 偏差在
  dev 源静默口径下不影响判定，生产另立 SLA 时一并校准（入 gate 记录）。

## 三、验收口径（gate）

1. 本地全绿：ai-ready pytest（新探针 + 17 项目录形状 + requires_table 前置）、
   control-plane mvn（任务互斥 409 / 编排顺序 / 失败路径 / 孤儿清算）、前端
   tsc/vitest/qa/build；
2. dev：双镜像 0.2.0-g20-20260916（V16 自动迁移）——EP 产品门户发起构建：
   202 → 轮询 → SUCCEEDED（构建段 + 评估）→ 版本 readiness 回写与 G19 基线
   一致；负例：RUNNING 中再投 409；孤儿清算实测（重启控制面）；
3. dev：17 项检查评估实测（15 PASS + 2 N/A，Overall 1.0/CANDIDATE），
   corpus_source_lag / artifact_availability 真实读数入档；
4. backlog 更新：AI-4 关闭、补厚第二批完成记变更、webhook 通知 outbox 记
   生产化批候选。

## 四、风险与回滚

- 异步化是调用面契约变化（同步→202），无存量调用方依赖旧响应（门户同批跟改）；
- 引擎 /build 零改动，回滚控制面即回同步；
- rustfs 探针在 RustFS 不可达时按 FAIL 收口（探针失败语义）——诚实（产物面
  不可消费），dev/生产都有 RustFS 依赖在位。
