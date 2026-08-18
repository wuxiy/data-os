# 门户前端（prototype/）

改 UI 前先读 [DESIGN.md](../../DESIGN.md)——视觉系统（色彩、字体、组件规则、Do/Don't），对「好不好看/和不和谐」类问题同样适用。

## 约定与红线

- CSS 只用 CSS Modules（禁 Tailwind / CSS-in-JS）。
- UI 不得向业务用户暴露 SeaTunnel / dbt / OpenMetadata 等引擎名（用「中心采集执行器」等业务称谓）。
- 演示数据是显式边界：`VITE_DATAOS_DEMO_MODE=true` 才展示，生产构建不得渲染演示数据。
- 异步生命周期用现成原语，不要在页面内复制：`hooks/useApiResource`（三态机；注意它区分「自身超时中止」与「卸载中止」）、`hooks/useAction`（动作互斥与错误归置）、`components/ui/Drawer`（焦点圈定/滚动锁定内建）。
- `qa/*.mjs` 是正则不变量锁：断言的是不变量而非语法，重构后把锁迁到新家（改断言指向），不要删断言。脚本必须从 `prototype/` 目录运行（内部按 `..` 解析路径）。

## 命令

```bash
cd prototype && npx tsc -b && npx vitest run && npm run build
```
