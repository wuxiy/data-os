# 门户前端（prototype/）

改 UI 前先读 [DESIGN.md](../../DESIGN.md)——视觉系统（色彩、字体、组件规则、Do/Don't），对「好不好看/和不和谐」类问题同样适用。

## 约定与红线

- 组件库为 antd v6（`src/theme.ts` 是唯一 token 来源，对应 DESIGN.md §12「云峰中性」）。组件来源优先级：antd > `components/ui/` 自研。antd v6 是纯 CSS Variables 架构，自定义样式仍只用 CSS Modules（禁 Tailwind / 手写 CSS-in-JS）；antd 组件的覆写用 `theme.ts` token 或 CSS Modules 类名，不改 antd 内部类。
- 迁移过渡期（2026-10-14 起）：已迁移页面用 antd + v2 token；未迁移页面沿用 v1 token（`globals.css`）与自研组件，两者不混用在同一页面。
- UI 不得向业务用户暴露 SeaTunnel / dbt / OpenMetadata 等引擎名（用「中心采集执行器」等业务称谓）。
- 演示数据是显式边界：`VITE_DATAOS_DEMO_MODE=true` 才展示，生产构建不得渲染演示数据。
- 异步生命周期用现成原语，不要在页面内复制：`hooks/useApiResource`（三态机；注意它区分「自身超时中止」与「卸载中止」）、`hooks/useAction`（动作互斥与错误归置）、`components/ui/Drawer`（焦点圈定/滚动锁定内建；已迁移页面用 antd Drawer，同样需验收 Esc/焦点行为）。
- `qa/*.mjs` 是正则不变量锁：断言的是不变量而非语法，重构后把锁迁到新家（改断言指向），不要删断言。脚本必须从 `prototype/` 目录运行（内部按 `..` 解析路径）。

## 命令

```bash
cd prototype && npx tsc -b && npx vitest run && npm run build
```
