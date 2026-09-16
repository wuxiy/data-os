# Gate：AI-4（构建 API 异步化）+ 检查项补厚第二批（14→17）——G20 验收

> 2026-09-16。方案：docs/ai-ready-g20-review-and-plan-20260916.md（用户明示
> 「完成 AI-4 和四问底稿里的『检查项继续补厚』」）。
> dev 运行态：control-plane / ai-ready-service 双镜像 `0.2.0-g20-20260916`，
> 门户 dist 热更（index-B6fuxuyy）。

## 一、验收结论

| # | 项 | 结论 | 证据 |
|---|---|---|---|
| A1 | 检查项 14→17（声明仓库 + 引擎） | ✅ | corpus_source_lag（current）/ artifact_availability（consumable，新 rustfs_probe 类型）/ fhir_mapping_coverage（contextual，条件占位）；两 profile 各 17 权重；引擎 /readyz `requirements:17` |
| A2 | 新检查 dev 实测读数 | ✅ | corpus_source_lag **0.0 PASS**（语料构建水位 vs 源活跃水位）；artifact_availability **1.0 PASS**（RustFS 最新版本 chunks.jsonl 行数 732 == Doris chunks_ep COUNT 732 双落在册一致）；fhir_mapping_coverage N/A（fhir_mapping 表未建，条件占位生效） |
| A3 | 17 项终态评估 | ✅ | EP 产品 v0.3.0：**15 PASS + 2 N/A**（patient_split_leakage / fhir_mapping_coverage），六维全 1.0，Overall 1.0 / CANDIDATE |
| A4 | build API 异步化（投递面） | ✅ | `POST /build` → **202 + 任务行**（QUEUED，recipeRef 投递时按「请求??版本登记」解析固化）；活动任务期间二次投递 **409**（产品级活动检查 + 版本行 build_status CAS 置 RUNNING 双层互斥）；引擎未装配 503 守卫不变（security 测试锁定） |
| A5 | 执行面（worker） | ✅ | CAS 认领（QUEUED→RUNNING）+ 单线程提交池；实测 QUEUED 01:25:01 → RUNNING 01:25:02 → SUCCEEDED 01:25:08（732 chunk 构建 + 评估 ~6s）；result_json 与 G18 同步响应同构（构建段 + 评估摘要），门户视图复用 |
| A6 | 失败与孤儿路径 | ✅ | 任务失败 → 版本 FAILED + **readiness 保留上次评估**（本地测试锁定）；**孤儿清算实测**：手工置 RUNNING 模拟中断 → 重启控制面 → job FAILED（「控制面服务重启中断，请重新发起构建」）+ 版本 FAILED → 清扫后重投 202 → SUCCEEDED（dev 收在干净终态） |
| A7 | 门户任务面 | ✅ | build 按钮 → 202 投递 → 轮询至终态（2s 间隔，动作互斥全程禁用）→ 成功/失败通知（含 chunks/Overall/error）；详情页新增「构建任务」区块（状态/结果/发起人/起止时间）；版本构建状态色随 RUNNING/FAILED；result 解析容忍缺失/坏 JSON |
| A8 | 测试基线 | ✅ | ai-ready **68/68**（新增 12：rustfs 探针路由/未装配 FAIL/守卫前置 + RustFSAdapter 契约 5 + 17 项目录/API 形状）；control-plane **217/217**（新增失败路径/孤儿清扫；既有 build 测试改写为异步面——特性变更非重构，recipeRef 解析序与编排语义断言原样保留）；前端 tsc / vitest 28 / qa×2 / build 全绿 |

## 二、飞轮实抓真缺陷（本轮 1 个）

- **corpus_source_lag 公式反向**：首测读数 311.42h WARN——恰等于 data_freshness 的
  源停滞时长。归因：SQL 写成 `src_age - corpus_age`（=「语料比源新多少」），而
  正确语义是 `corpus_age - src_age`（源在语料构建后有更新才为正）；dev 语料
  （09-16 09:25）新于源水位（09-03 10:00），真实 lag=0。修复顺带把 built_at（UTC）
  经 CONVERT_TZ 归一到 +08 壁钟——两侧同基准比较后，会话时区偏移在差值中相消
  （任意会话时区下精确）。提交 b545759，修复后 dev 读数 0.0 PASS。

## 三、工程坑入档

1. **版本状态 CAS 的自阻断**：`build_status <> 'RUNNING'` 的 CAS 若用于一切回写，
   会反过来阻断终态（失败/清算时版本正是 RUNNING）——拆成 markVersionRunning
   （CAS，投递互斥专用）与 updateVersionBuildStatus（执行面独占，无条件）。
2. **nginx 缓存容器 IP（G9 老坑重现）**：control-plane 容器重建换 IP 后，portal
   nginx 仍指旧 IP，/api 打到恰好接管该 IP 的 FastAPI 容器（404 {"detail":...}）；
   docker restart portal 生效。**凡重建 control-plane/engine，portal 必须跟着重启**。
3. **rustfs 版本探测口径**：latest = 探测链最后一个在册版本，next_version 按
   **patch 位**递增（v1.0.0→v1.0.1→…），不是 minor 位——对拍探针必须同口径游走。
4. **dev Doris 会话时区 Asia/Shanghai**；built_at 是 UTC ISO8601 字符串、
   UPDATE_TIME 是 +08 本地壁钟——跨源时间比较必须先归一（本批 CONVERT_TZ 方案）。

## 四、诚实边界与去向

- **fhir_mapping_coverage / patient_split_leakage**：条件占位（表存在自动生效），
  fhir 表存在后须补真实 check.sql——sql_file null 时按探针失败 FAIL 收口（显式
  暴露「检查未实现」），不静默满分。LOINC 不做：EP 门诊处方域无检验指标数据，
  不造无数据支撑的空头检查（四问候选「FHIR/LOINC」按域数据实情裁剪）。
- **webhook 外发通知未做**：任务终态持久化 + 门户轮询呈现；独立通知 outbox 记
  backlog 生产化批候选（governance_notifications.issue_id 是 NOT NULL FK，AI 构建
  事件不能塞治理域）。
- **多实例部署**：worker 单实例口径（dev）；多实例时执行面需租主比对，与 P2
  编排同窗处置。
- freshness 的 +8h 源时区读数偏差（311.48 vs 真实 ~303h）不在本批修——dev 口径
  720/2160h 下不影响判定，生产另立 SLA 时与 corpus_source_lag 同法归一。

## 五、测试与提交基线

- 提交链：4bd1537（计划）→ d239cb6（G20-2 检查项）→ 3f491b5（G20-1 异步化）→
  2ba83e6（门户）→ b545759（lag 公式修复，dev 实测抓出）→ 本 gate 文档；
- dev：双镜像 0.2.0-g20-20260916（.env 钉 tag，备份 .env.pre-g20-20260916）；
  V16 迁移成功（Flyway 17 migrations）；门户 dist 热更。
