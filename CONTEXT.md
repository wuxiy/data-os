# 领域词汇表（CONTEXT.md）

医数中枢（data-os）的领域词汇。架构评审与设计讨论以此为准：新概念先在此定名，再进代码；讨论中术语变得模糊时，当场修订此表。

## 外部运行（External Run）

控制面委托给**外部执行器**（SeaTunnel / DolphinScheduler / 质量规则执行器）的一次运行，及其 `SUBMITTING -> SUBMITTED -> RUNNING -> 终态` 的**提交、轮询、对账生命周期**。

- 采集运行与质量复检运行都是外部运行：两台曾经各自手写的状态机，由统一的外部运行生命周期模块（`controlplane/run/ExternalRunLifecycle`）拥有。
- 两侧行为差异是接口上的**显式声明**，不是隐性分叉。例如过期 `SUBMITTING` 的处置（`StaleSubmissionPolicy`）：
  - 采集侧转 `UNKNOWN` 走人工对账——外部写入（双重采集）不可重入，宁可疑；
  - 质量侧原地重投并退避——质量检查幂等（执行批次号即执行器主键），重投安全。
- 对账（reconciliation）：外部运行结果不确定（`UNKNOWN`）时，按运行编号向执行器求证或由人工确认缺席（`confirmAbsent`）的过程。

## 通知发件箱（Notification Outbox）

治理问题的事件通知先落 `governance_notifications` 表（发件箱），以幂等键去重入队；`NotificationOutboxRepository` 以数据库租约抢占外发（同租约防并发重复外发），外发通道（Webhook 等）与重试/放弃策略由通知模块持有。终态回写与租约释放同事务。

## 质量引擎（Rule Engine）

以特定技术执行一条质量规则的引擎。质量执行器（quality-runner）按规则把运行路由给引擎：引擎负责命令构造、结果解析、失败样本读取与自身产物清理（dbt 引擎即 `DbtEngine`）；进程监督（超时击杀、取消终止、心跳续租）与执行代次围栏由执行器共享的监督器承担。第二个引擎（Great Expectations、医院自有质检服务等）到来时实现同一接口即可接入。

## 运行模式（Runtime Mode）

门户的演示/真实呈现差异由运行模式模块（`prototype/src/data/runtimeMode.ts`）单一持有：构建期演示开关（`VITE_DATAOS_DEMO_MODE`）与后端报告的 DEMO 模式在此合一；静态样例可见性、演示（FakeSource）模板目录与守卫、快照文案全部由它派生，页面消费语义谓词而不散布布尔分支。生产路由表独立于演示数据（`data/routes.ts`）。
