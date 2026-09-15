# Gate：SERVING 产品再认证路径（G19）——撤下重评估（backlog AI-3）

> 2026-09-16。方案：docs/ai-ready-g19-review-and-plan-20260916.md。缺口来源：G18 飞轮
> 实测——EP 产品 SERVING 中 v0.3.0 评估 CANDIDATE 后无再认证路径（409）。
> dev 运行态：control-plane `0.2.0-g19-20260916`（sha 0d4caf47）；门户 dist 卷挂载热更。

## 一、验收结论

| # | 项 | 结论 | 证据 |
|---|---|---|---|
| A1 | 状态机唯一逆向流转 | ✅ | `SERVING → ASSESSED`（撤下重评估）；CERTIFIED→ASSESSED 仍非法（审批门不变量保全）；契约矩阵测试全量对拍（`noTransitionOutsideTheDeclaredMatrixIsAllowed` 覆盖 36 组合） |
| A2 | 审批链零改动 | ✅ | submitCertification / decideCertification / SERVING 发布守卫（须 APPROVED 记录）逻辑未动；G11「CERTIFIED 只能经审批」与 G12 守卫原样 |
| A3 | 服务层 E2E | ✅ | SERVING →（SERVING 中提交被拒 409）→ 登记 v0.2.0+评估 → 撤下 → 提交 → 批准 → CERTIFIED → SERVING；认证历史两代版本留痕（v0.2.0/v0.1.0）。control-plane 215/215 |
| A4 | 门户动作 | ✅ | SERVING 态「撤下重评估」两步确认（与弃用同型——服务中断属破坏性动作）；撤下后既有「提交认证审批」入口自然出现，UI 链路自洽。前端 tsc/vitest 26/mock-audit/interactions-smoke/build 全绿 |
| A5 | dev 实操（真实环路） | ✅ | EP 产品（SERVING，v0.3.0 CANDIDATE）：撤下 ASSESSED → 提交（RID 6289cdfa）→ 批准（处置说明含 v0.3.0 评测证据）→ CERTIFIED → SERVING；负向对拍 SERVING 中直接提交 409；overview serving=2 / latestMrr 0.9208 |

## 二、语义记录

- **撤下重评估是显式操作**：降级后产品不在服务（中间态诚实），必须重新走审批链回上架；
  流转本身落生命周期审计（与弃用同型）。
- **弃选方案存档**：「按版本门控的认证-切换」（旧版继续服务、新版候审，蓝绿式）需要
  serving 指针与 currentVersion 候选指针分离的版本模型（registerAndAdvance 即推进指针），
  语义面大一个数量级——如生产需要零中断换版，作为独立候选再立项。
- **契约变更声明**：既有断言「SERVING→ASSESSED 非法」随特性反转（特性变更非重构，
  G8 原契约不含迭代场景）；逆向流转仅此一条。

## 三、提交与运行态

- 提交：47564fb（计划）→ 708dd49（控制面状态机+E2E）→ 9155328（门户动作）；
- dev：control-plane 0.2.0-g19-20260916 + 门户 dist 热更（nginx 卷挂载）；
- EP 产品全史：DRAFT→CURATED→ASSESSED→CERTIFIED→SERVING（v0.2.0）→
  [G18 飞轮 v0.3.0 迭代] →ASSESSED（撤下）→CERTIFIED→SERVING（v0.3.0）——
  两代版本、两次审批、完整审计。
