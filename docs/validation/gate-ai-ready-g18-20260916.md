# Gate：AI Data 工作流闭环（G18）——构建编排 API 化 + 真实语料飞轮首轮

> 2026-09-16。方案：docs/ai-ready-g18-review-and-plan-20260915.md（用户明示「继续完善
> AI Data 模块」）。dev 运行态：`0.2.0-g18-20260915` 双镜像（终态 sha：
> 引擎 99698b18 / 控制面 28bcf89f）。中断记录：2026-09-15 部署中 dev 主机断网约
> 9+ 分钟，恢复后续做，无状态损失。

## 一、验收结论

| # | 项 | 结论 | 证据 |
|---|---|---|---|
| A1 | 引擎 POST /build（G18-1） | ✅ | 两源真实执行 rag_builder；writer 写 Doris + RustFS 版本递增；`output.reset_before_write`（EP 开、SERVING 合成表不开）；recipe 未找到 404；documents 源仓库根口径映射（`ai-data/` 前缀剥离）修复了 CLI 与 API 双口径分歧。测试 60/60 |
| A2 | 控制面 build 编排（G18-2） | ✅ | recipeRef 解析序「请求 ?? 当前版本登记」——门户 build 按钮空 body 由版本登记驱动；两处皆空回落仅评估（旧行为零影响，契约测试锁定）。顺带修复真 NPE：v0.1.0 自动登记版本 recipeRef=null 时 `Stream.findFirst` 抛错（6 个既有测试炸出）。测试 214/214 |
| A3 | 门户深链 + 通知（G18-4） | ✅ | `/ai-data?product=` 读挂载 + replaceState 回写（对齐 ?asset=/?issue= 口径）；build 通知携带构建段（chunks + RustFS 版本）。tsc / vitest 26 / mock-audit / interactions-smoke / build 全绿 |
| A4 | 真实语料飞轮首轮（G18-3） | ✅ | 全链实测：失败归因 → feedback（MISSING_DOC，锚定评测明细）→ 处置 CONSUMED（留处置说明）→ recipe v1.1 → v0.3.0 经**新 build API** 构建（自吃狗粮）→ 评测 → 版本对比（§三）。openFeedback 回 0 |
| A5 | 批量写修复（飞轮中实抓） | ✅ | 首次 build API 调用 504：write_doris 逐行开新连接，1,967 行仅落 362 即超时（部分写入现场取证）。`DorisAdapter.execute_many`（单连接 executemany + 显式 commit）+ 200 行分批后 **19 秒**完成全链 |
| A6 | 产物面核验 | ✅ | v1.1 语料 732 chunk（见 §四语料语义变化）：PHI 模式 0 命中、时分秒残留 0；RustFS v1.0.2；评估 1.0/CANDIDATE（14 项检查） |
| A7 | 终态 | ✅ | 终态镜像内评测集复现 recall 0.9833 / MRR 0.9208；overview：products=3 / serving=2 / latestMrr=0.9208 / openFeedback=0 |

## 二、飞轮证据链（feedback 8291dbd4）

1. **归因**：v0.2.0 评测 60 问中 9 个 recall 失败，6 例同簇（耳鼻喉科+富马酸替诺福韦
   二吡呋酯片——无编码测试占位药重灾区）。机理：叙化含时分秒（门诊高峰 10:00:00
   近乎全量命中）→ 日期 token 的 IDF 判别力被稀释 → 同科室同药不同日期的兄弟块挤占 top5。
2. **反馈**：control-plane feedback API 提交（question/metric/outcome=0/MISSING_DOC/
   detail 锚定归因）→ 处置 CONSUMED（resolution 记 v1.1 吸收方案）。
3. **Recipe v1.1**（ep-prescription-rag-v1-1.yaml，version 1.1.0）：
   `source.date_only_columns: [KFRQ]`（时序截日期）+ `reset_before_write: true`。
4. **重构建**：登记 v0.3.0（recipeRef=v1-1，gitCommit=1c01fae）→ `POST /{id}/build`
   空体（版本登记驱动，A2 路径）→ 19 秒完成（A5）→ 评估 1.0/CANDIDATE。
5. **评测集随语料重生成**：date-only 改变全部文档指纹，期望文档须从 v1.1 语料重导
   （生成规则不变：确定性、三元组唯一、60 问）。用户字段（问句/golden/科室）PHI 扫描
   0 命中；评测集内唯一手机号模式命中经甄别为 12 位 document_id 指纹子串（误报）。

## 三、版本对比（v0.2.0 vs v0.3.0，EP 产品）

| 指标 | v0.2.0（recipe v1） | v0.3.0（recipe v1.1） | 变化 |
|---|---|---|---|
| Recall@5 | 0.8500 | **0.9833** | +0.1333（失败 9→1） |
| MRR | 0.6575 | **0.9208** | +0.2633 |
| Citation | 0.5333 | **0.8833** | +0.35 |
| Faithfulness | 0.7500 | **0.9167** | +0.1667 |
| Precision@5 | 0.1700 | 0.1967 | +0.027（同日同科室并存属行级语料固有形态） |

**口径诚实声明**：两版本的评测集各自从其语料确定性生成（指纹随内容变），为「配对自洽
测量」而非同一固定题集；提升来自两个叠加的策展决策——①日期 token 恢复判别力，
②dedup 坍缩同日模板化兄弟块（竞争者减少）。二者共同构成「语料对检索更友好」的飞轮
语义；残余 1 个 recall 失败留证不掩。

## 四、语料语义变化（dedup 坍缩，如实记录）

v1（含时分秒）：2,000 采样 → 1,967 唯一篇（33 重复）。v1.1（date-only）：
2,000 → **732 唯一篇**（1,268 重复剔除）——同日同科室同内容模板化处方在内容指纹层
坍缩为单篇。对 RAG 检索是正确行为（近同篇冗余，dedup 是核心策展算子）；对「按处方
计数」的分析口径不适用本产物面（分析走 Doris 原表）。测试域数据高度模板化是该坍缩量
级的直接原因，生产语料量级会不同。

## 五、工程坑入档

1. **逐行连接写**：`write_doris` 每行新开 pymysql 连接，千行级即网关 504（362/1967
   部分写入现场）——批量 executemany + 单连接 + 显式 commit 是底线。
2. **documents 源双口径**：recipe `spec.source.dataset` 按仓库根相对书写（CLI 以
   recipe.parents[1] 解析），API 侧按 AI_DATA_DIR 解析会双重路径——服务侧剥离
   `ai-data/` 前缀统一。
3. **评测集指纹耦合**：内容级 recipe 变更使全部 document_id 失效，评测集必须随语料
   重生成；跨版本对比须声明「配对自洽」口径。
4. **Stream.findFirst NPE**：Java Stream 的 findFirst 对 null 元素抛 NPE——版本记录
   可空字段（recipeRef）必须先 filter(nonNull)。

## 六、未竟与候选（记备忘，不排期）

- **SERVING 产品再认证路径缺口**：EP 产品现 SERVING，v0.3.0 已评估 CANDIDATE 但
  状态机无 SERVING→ASSESSED 流转，无法走认证审批切换服务版本——真实工作流缺口，
  候选「显式降级流转」或「按版本门控的认证-切换」语义；
- 构建 HTTP 化的时长上限：19 秒/2 千处方可接受，生产大语料需异步化（任务态）；
- dev 门户 nginx 对长构建的代理超时口径（当前实测够用，未显式配置）。

## 七、测试与提交基线

- ai-ready 60/60、control-plane 214/214、前端全绿（tsc/vitest 26/mock-audit/
  interactions-smoke/build）；
- 提交链：d8d9bd3（计划）→ ebd5433（引擎 /build）→ fb5fb6f（控制面编排）→
  8ba2b05（门户深链）→ 1c01fae（recipe v1.1 + date_only）→ 61b84e5（批量写）→
  ec6e707（评测集重生成）；dev 双镜像 0.2.0-g18-20260915。
