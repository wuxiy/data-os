# G19 计划：SERVING 产品再认证路径（backlog AI-3）

> 2026-09-16。来源：G18 飞轮实测暴露的工作流缺口——EP 产品 SERVING 中登记 v0.3.0
> 并评估 CANDIDATE 后，`submitCertification` 因 `lifecycle != ASSESSED` 拒 409：
> 状态机没有「服务中产品迭代新版本后再认证」的路径。
> 前置：G11（认证审批）、G12（SERVING 守卫）、G18（飞轮首轮踩出）。

## 一、方案裁决：显式降级流转（SERVING → ASSESSED，「撤下重评估」）

**状态机新增唯一一条逆向流转：`SERVING → ASSESSED`。**

- 语义：显式把产品撤下服务、进入重评估——降级后不在服务（中间态诚实），
  随后走既有认证链（提交审批 → 批准 → CERTIFIED → SERVING），**审批逻辑零改动**；
- 保全不变量：CERTIFIED/SERVING 只能经审批进入（G11/G12 守卫原样）；降级动作本身
  落生命周期流转审计（与弃用同型）；
- 弃选方案「按版本门控的认证-切换」（旧版继续服务、新版候审）：需要 serving 指针
  与 currentVersion 候选指针分离的版本模型（现 registerAndAdvance 即推进指针），
  语义面大一个数量级——记为未来候选，不在本轮。

## 二、改动面

1. `AIDataProductLifecycle`：SERVING 的合法目标集 `{DEPRECATED}` → `{ASSESSED, DEPRECATED}`
   （唯一状态机来源，javadoc 流转图同步）；
2. 服务层无新守卫（降级是显式操作动作；SERVING 发布守卫不受影响）；
3. 门户：SERVING 态增加「撤下重评估」动作（两步确认，与弃用同型——服务中断属
   破坏性动作），撤下后出现既有「提交认证审批」入口，链路自洽；
4. 测试：状态机契约矩阵更新（既有「SERVING→ASSESSED 非法」断言随语义反转——
   特性变更非重构，记录在案）；新增服务层 E2E——
   SERVING → 登记 v0.2.0 + 评估 → 降级 ASSESSED → 提交认证 → 批准 → CERTIFIED → SERVING。

## 三、验收口径（gate）

1. 本地：control-plane 全绿（含新 E2E）、前端全绿（tsc/vitest/qa/build）；
2. dev 实操：EP 产品（SERVING，v0.3.0 CANDIDATE）→ 撤下 → 提交 → 批准 →
   CERTIFIED → SERVING——真实飞轮闭环「再认证」一环补全；overview 对拍；
3. 负向对拍：CERTIFIED→ASSESSED 仍非法；脏数据路径 SERVING 发布守卫不回归。

## 四、风险与回滚

- 逆向流转是语义放宽，唯一新增面；回滚 = 枚举回退；
- 降级后若不重新认证，产品停在 ASSESSED（不在服务）——诚实语义而非风险。
