# Task Plan: Mock 能力核查与可落地化

## Goal

明确 data-os 当前 mock 数据的边界，避免演示数据冒充真实业务结果，并把首期门户推进到可部署、可诊断、可切换真实服务的交付状态。

## Phases

- [x] Phase 1: 复核现有代码、配置、测试与远程部署基线
- [x] Phase 2: 形成 mock/真实数据边界与落地验收清单
- [x] Phase 3: 实现显式运行模式、真实 API 优先和可诊断降级
- [x] Phase 4: 增加后端/前端测试并完成浏览器交互验证
- [ ] Phase 5: 部署开发环境、更新文档、提交并推送

## Key Questions

1. 哪些页面仍直接读取 `prototype/src/data/mock.ts`，是否会把 mock 误认为生产数据？
2. 开发环境的 `DEMO` 执行器、种子数据和真实 SeaTunnel/质量执行器如何明确切换？
3. 控制面不可用时，页面应显示空态、离线示例模式，还是允许降级到 mock？
4. 交付验收需要哪些命令、API 和浏览器证据来证明没有隐性 mock？

## Decisions Made

- 生产默认真实 API；mock 只能通过显式 demo 配置/入口启用，不能在 API 失败时静默替代真实数据。
- `DEMO` 质量执行器仅保留开发/验收用途，部署文档必须给出 HTTP/dbt 执行器切换方式和启动阻断检查。
- 不在本轮凭空伪造 OpenMetadata、Superset、DB-GPT、MPI 等未落库能力；这些页面要明确标注原型/只读演示边界，并预留真实 Adapter。

## Errors Encountered

- 首次读取旧 `prototype/src/api/controlPlane.ts` 路径不存在，实际 API 客户端位于 `prototype/src/data/controlPlane.ts`；已修正。

## Status

**Currently in Phase 5** - 本地双模式验证和测试已通过，准备构建并部署开发环境、完成远程复核和提交推送。
