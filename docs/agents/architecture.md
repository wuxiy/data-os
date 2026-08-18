# 架构边界

动 `controlplane/run/`、跨栈契约，或做任何「要不要再抽一层」的判断前，先读本文与 [CONTEXT.md](../../CONTEXT.md)。

## 单一来源清单（要写第二处 = 方向错了）

- **外部运行状态机只有一份**：`controlplane/run/ExternalRunLifecycle`。采集/质量两侧差异全部经 `RunPolicy` 与接入点显式声明（如 `StaleSubmissionPolicy`：采集侧宁可疑转对账、质量侧幂等重投退避），不得复制状态机、不得散布裸状态字符串（统一 `RunStatus`）。
- 错误消息：`api/ErrorMessages.safe`；厂商状态归一留在各执行器 adapter 内，中性归一在 `RunStatus.normalize/sanitized`。
- 仓储按聚合拆分：`IssueRepository` / `QualityRunRepository` / `NotificationOutboxRepository`，不得向调用方暴露跨聚合宽接口。
- 执行器「是否配置好」由执行器自答（`QualityRuleExecutor.configured()` / `readinessEndpoint()`），消费方按名询问。
- quality-runner：`RuleEngine` seam（`engines.py`）+ `ProcessSupervisor`（`supervisor.py`）；dbt 专属知识（命令构造、`run_results.json` 解析、失败表清理）不得上移 manager。
- 前端三模块：`data/runtimeMode.ts`（演示/真实）、`data/domain.ts`（状态词汇与时间格式）、`data/routes.ts`（路由表）。

## 判断规则

- 加第二份实现前先问：这是**两侧真实差异**（→ 做成显式策略/接入点）还是**重复**（→ 收敛回单一来源）。
- 深入参考：`docs/technical-architecture.md`（控制面模块与适配契约）、`docs/medical-data-platform-blueprint.md`（蓝图与产品边界）。
