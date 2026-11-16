# 门户前端（prototype/）

改 UI 前先读 [DESIGN.md](../../DESIGN.md)——视觉系统（色彩、字体、组件规则、Do/Don't），对「好不好看/和不和谐」类问题同样适用。

## 技术栈（FE0–FE7 迁移后，2026-11-16）

React 19 + TypeScript + Vite SPA；Tailwind 4（拆分导入、无 preflight，`src/styles/tokens.css` 是唯一主题令牌来源）；TanStack Router（代码路由 + 按页懒加载）/ Query（服务数据，会话级 Client）/ Table v9（`components/table` 封装，列助手必须 `listColumnHelper`）/ Form（复杂表单，如结构化采集）；浮层与模态用 Base UI（经 `components/ui/overlay.tsx` 的 Sheet/Dialog/Confirm）。**antd 已从生产依赖移除**；`hooks/useApiResource` 等旧三态机仅作为测试兼容 seam 保留，业务代码不得再引用。

## 约定与红线

- 新色值/字号/圆角先进 `src/styles/tokens.css`，不在组件里散落裸色；批准基线是原型 v0.2（`docs/design/continew-review-20261116/`）。
- UI 不得向业务用户暴露 SeaTunnel / dbt / OpenMetadata 等引擎名（用「中心采集执行器」等业务称谓）；实例名走 `instanceServiceLabel` 等中文口径。
- 演示数据是显式边界：`VITE_DATAOS_DEMO_MODE=true` 才展示，生产构建不得渲染演示数据；不可用/未接入显示真实空态，不补样例。
- 容器分工按 DESIGN.md §15：对象速览用 Sheet、单步短输入用 Dialog、明确后果用 AlertDialog（初始焦点在取消）、长任务用独立工作页、持续比较用常驻主从；脏数据退出先原位询问。
- Query 纪律：默认不自动重试/不聚焦重发；mutation `retry:false` 且一次意图一次调用（幂等键一次性）；页面级轮询只用 `refetchInterval`/受控 effect（接入运行 5s、AI 构建 2s×150、平台组件 30s）；切键即换缓存，旧响应不得覆盖新对象。
- 浏览器标签标题随路由动态化（壳的路由 effect）；`index.html` 只提供首帧标题。
- `qa/*.mjs` 是不变量锁：断言业务不变量而非语法，重构后把锁迁到新家（改断言指向），不要删断言。脚本必须从 `prototype/` 目录运行（内部按 `..` 解析路径）。`qa/mock-control-plane.mjs` 是合成契约替身（仅验收环境），`qa/browser-smoke.mjs --serve [--flows fe2,fe3,fe4,fe5,fe6]` 跑 27+ 路由矩阵与业务流；`qa/artifact-manifest.mjs` 产出 dist 哈希与依赖/许可证清单。

## 命令

```bash
cd prototype && npx tsc -b && npx vitest run \
  && node qa/mock-audit.mjs && node qa/portal-interactions-smoke.mjs && npm run build
# 浏览器验收（需本地 mock 控制面，Chrome）：
cd prototype && node qa/browser-smoke.mjs --serve
```
