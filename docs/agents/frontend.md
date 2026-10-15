# 门户前端（prototype/）

改 UI 前先读 [DESIGN.md](../../DESIGN.md)——视觉系统（色彩、字体、组件规则、Do/Don't），对「好不好看/和不和谐」类问题同样适用。

## 约定与红线

- 组件库为 antd v6（`src/theme.ts` 是唯一 token 来源，对应 DESIGN.md §12「云峰中性」）。组件来源优先级：antd > `components/ui/` 自研。antd v6 是纯 CSS Variables 架构，自定义样式仍只用 CSS Modules（禁 Tailwind / 手写 CSS-in-JS）；antd 组件的覆写用 `theme.ts` token 或 CSS Modules 类名，不改 antd 内部类。
- 全站 16 页已于 2026-10-15 完成 antd 迁移；新写页面/组件一律用 antd + v2 token，不再引用 v1 色值与已退役的自研件。
- UI 不得向业务用户暴露 SeaTunnel / dbt / OpenMetadata 等引擎名（用「中心采集执行器」等业务称谓）。
- 演示数据是显式边界：`VITE_DATAOS_DEMO_MODE=true` 才展示，生产构建不得渲染演示数据。
- 异步生命周期用现成原语，不要在页面内复制：`hooks/useApiResource`（三态机；注意它区分「自身超时中止」与「卸载中止」）、`hooks/useAction`（动作互斥与错误归置）。抽屉/确认弹窗用 antd Drawer（验收其 Esc/焦点行为）；自研 `components/ui/Drawer`、`ConfirmDrawer` 已随 antd 批量迁移（2026-10-15）退役删除。`Pager` 保留用于非表格列表分页；表格分页一律 antd Table 内建。
- `qa/*.mjs` 是正则不变量锁：断言的是不变量而非语法，重构后把锁迁到新家（改断言指向），不要删断言。脚本必须从 `prototype/` 目录运行（内部按 `..` 解析路径）。

## 命令

```bash
cd prototype && npx tsc -b && npx vitest run && npm run build
```
