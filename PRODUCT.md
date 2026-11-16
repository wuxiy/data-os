# 医数中枢

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

医院信息中心负责人、数据治理人员与实施工程师，通过统一门户管理医疗数据采集、治理和使用。管理入口与技术运维入口按角色区分。

## Product Purpose

统一呈现数据接入、治理、患者主索引、数据资产、AI 数据产品及对外数据服务，让使用者从问题定位进入证据、责任与处理流程。

## Operating Context

桌面工作站，首版审核范围为 1280–1920px。医院部署可能处于隔离内网；界面字体和关键资产应适应离线交付。

## Capabilities and Constraints

- 领域语义以 `CONTEXT.md` 为准；采集与复检按外部运行生命周期解释。
- 数据治理是一等业务界面，覆盖驾驶舱、标准、映射、质量、血缘与影响、数据合同。
- 演示数据须显式标注；接口不可用不能用业务样例回填。
- 复检登记、执行完成和业务结论分开；人工认证不能由演示状态替代。
- 2026-11-16 用户指定下一轮前端目标栈：React 19、TypeScript、Vite、shadcn/ui、Tailwind 4、TanStack。原型 v0.2 与操作容器分工已通过审核；[实施计划](docs/frontend-stack-migration-plan-20261116.md)待用户审核，正式迁移尚未启动。

## Brand Commitments

名称为「医数中枢」，业务文案为中文。用户指定借鉴 Continew UI Next 的前端设计、交互和布局。

## Evidence on Hand

现有门户位于 `prototype/`，业务词汇与边界位于 `CONTEXT.md`、`tasks/lessons.md`。审核原型使用合成样例，不证明真实院内业务链已经验收。

## Accessibility & Inclusion

桌面键盘可完成导航与主操作；抽屉和对话框支持 Esc、焦点约束与关闭后焦点归还；数据状态不能只靠颜色表达。
