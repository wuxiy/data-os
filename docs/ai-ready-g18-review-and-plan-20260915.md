# G18 计划：AI Data 工作流闭环（构建编排 API 化 + 真实语料飞轮首轮）

> 2026-09-15。用户明示「继续完善 AI Data 模块」。G17 关账后三个残余缺口：
> ①控制面 `POST /{id}/build` 名不副实——只做评估，真实构建仍是容器内手工命令
> （`python -m app.rag_builder`），「构建登记」与「实际构建」分离；
> ②真实语料飞轮未走——评测 recall 0.85 留下 9 个失败样本，feedback 队列空置；
> ③AI Data 页无深链（?asset=/?issue=/?task= 口径未覆盖 /ai-data）。
> 前置：G8–G12（主线）、G17（补厚 + 真实语料入链）。

## 一、G18-1 引擎 POST /build（构建执行面）

- 请求 `{product, version, recipeRef}`（product/version 留档；认证同 /assess）。
- recipeRef → `ai-data/recipes/{ref}.yaml`（同 /evaluate 解析口径）；未找到 → 404。
- 执行 rag_builder 全链（documents / doris_table 两源），Doris 写入走 writer 账号，
  RustFS 版本只增不改（next_version 探测递增）。
- `spec.output.reset_before_write: true`（新可选字段）：写前 `DELETE FROM` 产物表——
  EP recipe 开（单产品表，防陈旧行滞留）；合成语料 chunks（SERVING 中）不开，
  维持覆盖写语义。
- 响应：`{recipe, chunks, documents, rustfs: {bucket, prefix, version}, quality}`。

## 二、G18-2 控制面 build 编排（消除语义错位）

- `AIReadyEnginePort` 增 `construct(product, recipeRef)`；HTTP 适配 POST /build。
- `AIDataProductService.build(id, recipeRef)`：**解析序 = 请求 recipeRef ?? 当前版本
  登记的 recipeRef**（门户 build 按钮发空 body，靠版本登记驱动——「登记什么 Recipe
  就构建什么」）；解析结果非空 → 先 construct 再 assess；为空 → 仅评估（G12 前行为
  不变，旧产品零影响）。
- 响应在原评估摘要上叠加构建段（chunks/rustfs version）；门户 build 通知升级为
  「构建完成 N chunks → 评估 Overall X」。

## 三、G18-3 真实语料飞轮首轮（dev 实操）

1. 引擎 /evaluate 明细（details）拉取 9 个 recall 失败 case，逐案归因（期望文档 vs
   实际 top5 的 token 差异）；
2. 代表性失败样本经控制面 feedback API 提交（metric=retrieval_recall_at_5，证据锚定
   评测明细）→ 处置 CONSUMED（留处置说明）；
3. 归因驱动的 recipe v1.1（候选方向：叙化文本降噪——去掉时分秒等低信息 token，
   提高 BM25 有效信号密度；以实际归因为准，不预设结论）；
4. 走**新 build API** 登记 v0.3.0 → 构建 → 评估 → 评测 → 版本对比（v0.2.0 vs v0.3.0）。
   指标如实留证——单轮不保证单调提升（G12 口径），飞轮语义在机制与诚实。

## 四、G18-4 门户深链 ?product=

- /ai-data 读 `?product=`（挂载后按清单校验选中）+ 选中/创建时 replaceState 回写，
  对齐 AssetCatalog 的 ?asset= 口径；产品可书签可分享。

## 五、验收口径（gate）

1. 本地全绿：ai-ready pytest（/build 端点 + reset 语义 + 404）+ control-plane mvn
   （recipeRef 解析序 construct→assess 编排）+ 前端 tsc/vitest/qa/build；
2. dev：EP 产品经门户可用路径外的 API 链完成 v0.3.0（构建由 build 端点真实驱动，
   非容器手工）；旧合成语料产品 build 行为不变（无 ref 仅评估）；
3. 飞轮证据链完整：失败明细 → feedback → 处置 → recipe diff → 重评测对比；
4. 深链实测：/ai-data?product={id} 直达选中；qa 锁不回归。

## 六、风险与回滚

- DELETE 权限：dataos_ai_writer 若无 DELETE 将在 dev 实测暴露，按最小面 GRANT 并
  记 gate 文档（不扩库不扩表）；
- 构建 HTTP 化的时长：EP 语料构建秒级，dev 可接受；生产大语料再议异步化（记备忘）；
- 回滚：引擎 /build 为新端点零侵入；控制面 recipeRef 解析空值回落旧行为。
