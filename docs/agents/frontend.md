# 门户前端（prototype/）

改 UI 前先读 [DESIGN.md](../../DESIGN.md)——视觉系统（色彩、字体、组件规则、Do/Don't），对「好不好看/和不和谐」类问题同样适用。组件基线见 DESIGN.md §18。

## 技术栈（2026-11-24 起）

React 19 + TypeScript + Vite SPA；Tailwind 4（拆分导入、无 preflight，`src/styles/tokens.css` 是唯一主题令牌来源）；**UI 组件层是 [coss ui](https://github.com/cosscom/ui)**（Base UI + Tailwind 4，shadcn 式源码分发）；TanStack Router（代码路由 + 按页懒加载）/ Query（服务数据，会话级 Client）/ Table v9（`components/table` 封装，列助手必须 `listColumnHelper`）/ Form（复杂表单，目前只有结构化采集一处）。antd 与手写组件层已移除；`hooks/useApiResource` 等旧三态机仅作为测试兼容 seam 保留，业务代码不得再引用。

## 组件层的约定

- **目录**：coss 源码原样放在 `src/components/ui/`（41 个文件），**不要改**；项目自有件只保留没有 coss 对应物的少数几个，放 `src/components/app/`（薄组合：StatusBadge、CodeTextarea、Loading、TableSkeleton、SearchField、DatePicker、EmptyState、Breadcrumb、ConfirmDialog；纯业务件：FormGrid、ScopeNote、useNotice、useDiscardGuard、Metric）。
- **写法**：页面里直接组合 coss 部件（如 `<Field><FieldLabel/>…</Field>`、`<Dialog><DialogPopup><DialogHeader/>…`），不再包一层项目门面。先读对应部件的源码与 coss 粒子（`coss-registry-snapshot/particles/`），按粒子写法来。
- **选择原语看交互，不看外观**：必须始终有选中值用 RadioGroup（可配 SegmentedControl 外观）；可清除的筛选用 ToggleGroup；切换内容面板用 Tabs。禁用按钮要给原因时，按 coss 写法包一层可聚焦的 `span` 当 Tooltip 触发器。
- **表单内的单选组**：用 `<Field render={(props) => <Fieldset {...props} />}>` + `FieldsetLegend`。放进普通 `Field` 会让每个选项都被冠上字段标签，选项自己的可访问名全丢。
- **主题**：coss 语义令牌经 `tokens.css` 末尾的令牌桥映射到品牌色板。新色值先进 `tokens.css`；需要新语义时加在桥上，不在组件里写裸色。
- **无 preflight 的补丁**：coss 源码按「有 preflight」编写，项目不导入它。base 层已补 `border: 0 solid`、`[data-slot]` 列表重置、`fieldset` 重置、DayPicker 样式（`layer(base)`）。再遇到 coss 组件「长得不对」，先用浏览器读计算样式确认是不是缺 preflight 的哪一条，再补到 base 层。
- **coss 已知的契约**：`Input` 内部是 `Field.Control`，放进 `Field` 后标签自动关联；`FieldError` 只在 `invalid` 时渲染且必须给 children；`Select.onValueChange` 的参数是「值 | null」，项目用空串表示未选，回调里要 `next ?? ''`；`Select` 必须同时给 `items`，否则关闭时触发器不显示文案；`Command` 不带泛型，条目以 `unknown` 传入回调。
- **TanStack Form**：`useForm` 不随表单状态重渲染，组件里读 `form.state` 不会更新。要用 `useStore(form.store, selector)`、`form.Subscribe` 或 `form.Field`。
- **辅助语义**：静态说明用 `<Alert role="note">`，反馈类保留 coss 默认的 `role="alert"`；coss Toast 的根节点是 `dialog` 角色（高优先级为 `alertdialog`），按 `getByRole('dialog')` 泛查会把提示也算进去，表单弹窗要按标题定位。
- **`<a>` 有默认下划线**（无 preflight）：以 `render={<a />}` 渲染的导航按钮要加 `no-underline`。
- **coss 部件自带英文辅助文本**（`aria-label`、`title`、读屏文本），与「UI 用中文」冲突。coss 把 `props` 展开在最后，多数能在调用点用 `aria-label` / `title` 覆盖（壳的 `SidebarRail`、`SidebarTrigger` 即如此）；写死在部件内部、覆盖不了的两处（Toast 视口 `Notifications`、窄屏侧栏抽屉标题）登记在 gate 记录 `portal-coss-ui-20261123.md` §7。新接入 coss 部件后，在浏览器里查一遍它渲染出的 `[aria-label]` / `[title]` / `.sr-only` 英文值——其中 `title` 是肉眼可见的。

## 约定与红线

- 批准基线是原型 v0.2（`docs/design/continew-review-20261116/`）的信息架构；视觉随 coss 组件自带样式（DESIGN.md §18）。
- UI 不得向业务用户暴露 SeaTunnel / dbt / OpenMetadata 等引擎名（用「中心采集执行器」等业务称谓）；实例名走 `instanceServiceLabel` 等中文口径。
- 演示数据是显式边界：`VITE_DATAOS_DEMO_MODE=true` 才展示，生产构建不得渲染演示数据；不可用/未接入显示真实空态，不补样例。
- 容器分工按 DESIGN.md §15：对象速览用右侧 Drawer、单步短输入用 Dialog、明确后果用 ConfirmDialog（AlertDialog，初始焦点在取消）、长任务用独立工作页、持续比较用常驻主从；脏数据退出先原位询问（`useDiscardGuard` + `DiscardPrompt`，取消按钮用 `DialogClose` / `DrawerClose` 让关闭请求经过守卫）。
- Query 纪律：默认不自动重试/不聚焦重发；mutation `retry:false` 且一次意图一次调用（幂等键一次性）；页面级轮询只用 `refetchInterval`/受控 effect（接入运行 5s、AI 构建 2s×150、平台组件 30s）；切键即换缓存，旧响应不得覆盖新对象。
- 浏览器标签标题随路由动态化（壳的路由 effect）；`index.html` 只提供首帧标题。
- `qa/*.mjs` 是不变量锁：断言业务不变量而非语法，重构后把锁迁到新家（改断言指向），不要删断言。脚本必须从 `prototype/` 目录运行（内部按 `..` 解析路径）。`qa/mock-control-plane.mjs` 是合成契约替身（仅验收环境）；`qa/browser-smoke.mjs --serve [--flows fe2,…,fe6]` 跑 29 路由 × 2 宽度矩阵与业务流；`qa/api-down-smoke.mjs` 自行构建，跑同一份路由清单（`qa/routes.mjs`）的控制面不可达路径，不需要 mock；`qa/artifact-manifest.mjs` 带 `dist` 或 `--licenses` 产出 dist 哈希或依赖许可证清单。`browser-smoke` 的通过行列出壳交互与各业务流实际执行的断言数：没传 `--flows` 就不会有业务流，写错了也不会显示通过。
- 跑业务流前重启 mock（它有状态），并且用 `set -o pipefail`（`| tail` 会吞掉非零退出码）。
- **接口正常与接口不可达是两条路径，重构后都要跑。** 不可达时页面走的是提前返回分支：hook 一旦落在某个提前返回之后，只有这条路径会暴露（React #300，整页卸载，接口正常时毫无征兆）。`useDiscardGuard` 必须在所有提前返回之前调用；用脚本搬动过代码之后，`api-down-smoke` 是必跑项。

## coss 升级

```bash
cd prototype && npx shadcn@latest add @coss/<name> --yes --overwrite < /dev/null
git checkout -- src/lib/utils.ts          # CLI 会询问是否覆盖项目的 cn
# CLI 给新依赖写 ^ 范围：钉成精确版本后 npm install --package-lock-only
node scripts/freeze-coss-snapshot.mjs      # 重新冻结；--verify 校验已安装源码与快照一致
```

快照在 `coss-registry-snapshot/`（manifest 含 sha256 与抓取时间），CI 不拉取注册表。本机到不了 `ui.shadcn.com`，`components.json` 的 `style` 必须是合法预设名 `nova`。

## 命令

```bash
cd prototype && npx tsc -b && npx vitest run \
  && node qa/mock-audit.mjs && node qa/portal-interactions-smoke.mjs && npm run build
node scripts/freeze-coss-snapshot.mjs --verify
# 浏览器验收（需本地 mock 控制面，Chrome）：
cd prototype && node qa/mock-control-plane.mjs --port 18090 &   # 后台
VITE_DATAOS_API_BASE_URL=http://127.0.0.1:18090/api npm run build
node qa/browser-smoke.mjs --serve [--flows all]
# 控制面不可达路径（自行构建到临时目录，不需要 mock）：
node qa/api-down-smoke.mjs
# 依赖审计（项目配置的 npmmirror 源不实现 audit 端点）：
npm audit --registry=https://registry.npmjs.org
```
