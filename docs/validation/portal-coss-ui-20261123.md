# 门户改造为 coss ui：gate 记录（2026-11-24，11-25 收口更新）

分支 `feat/portal-coss-ui`（截至最后一个代码提交 `7dd9fb6` 共 25 个提交，其中 `573df9f` 是文档提交；加上本次文档更新共 26 个。**未推送**，推送等用户明示）。基线为 `main` 的 `9044dc0`。

## 1. 结论

门户 UI 层已整体改用 [coss ui](https://github.com/cosscom/ui)（Base UI + Tailwind 4，shadcn 式源码分发）。
手写组件层 `src/components/kit` 与旧快照 `shadcn-registry-snapshot` 已删除；页面里不再有裸的 `<button>` 主按钮、`<input>` / `<select>` / `<textarea>`、`<details>`、`role="alert"` 与原生 `title` 提示（保留项见 §7）。

- 测试：30 文件 / 123 例全绿（基线 28 / 120，净增 3 例：2 例表单回归，1 例侧栏辅助文本）。
- QA 锁：`mock-audit`、`portal-interactions-smoke` 全过，断言无删除。
- 浏览器：29 路由 × 2 宽度共 58 项检查全过；壳交互 5 项、业务流 fe2–fe6 共 25 项断言在全新 mock 上全过（通过行逐段列出断言数）。
- 控制面不可达：29 条路由都落到真实的不可用状态（不崩溃、不白屏），由新增的 `qa/api-down-smoke.mjs` 锁定。
- 深色偏好模拟：计算样式与浅色完全一致，未触发 `dark:`。
- `npm audit`：与 `main` 完全相同（6 条，全部在开发工具链，见 §8）。

## 2. 裁决与决策

| 事项 | 裁决 | 来源 |
|---|---|---|
| 深度 | 有 coss 对应物的组件一律直接改用 coss 组件本身；项目门面退役 | 用户原话「组件尽量都按照coss的组件来改造」（否决了「保留门面 + 校准」的首版方案） |
| 外观 | 随 coss 组件自带样式；只经 `tokens.css` 令牌桥注入品牌色板与离线字体，不改 coss 源码 | 已批准计划中明示的取舍 |
| 测试与 QA 锁 | 只迁移不删除：业务断言保留，只改交互方式与选择器 | 已批准计划 |
| coss 源码 | 原样装入 `src/components/ui`，冻结快照可校验 | CU1 |
| 项目自有件 | 只保留没有 coss 对应物的，放 `src/components/app` | CU1 |
| 「12 处 aria-pressed」 | 实测只有 4 处是筛选/切换，已迁；其余 8 处是主从列表的选中项，**保留为自定义按钮**（见 §7） | CU3 盘点 |
| 行为修复 | 发现一处存量缺陷并修复（见 §6） | CU3 |

## 3. 逐项改造

「现状调用点」是改造完成后在 `src`（不含 `components/ui` 与测试）里数出来的，包含薄组合内部的用法。

| 原实现 | 改造后 | 现状调用点 |
|---|---|---|
| Button | coss `Button`（primary→default、danger→destructive、quiet→ghost、text→link、原无变体→outline） | 289 |
| Badge tone / StatusText / Count | coss `Badge`（warn→warning、danger→error、blue→info、neutral→outline）；`StatusBadge` 是 Badge 上的薄组合 | 124 |
| Input / Textarea / CodeTextarea | coss `Input` / `Textarea`；`CodeTextarea` 为等宽固定起始高度的薄组合 | 111 |
| FormField、裸 label | 调用点直接组合 coss `Field` / `FieldLabel` / `FieldDescription` | 130 |
| 原生 select | coss `Select`；选项为命名 `items` 数组（纯静态的提升到模块作用域） | 33 |
| radiogroup、状态筛选、版本切换、资产库切换 | coss `SegmentedControl` + RadioGroup 原语；表单内用 `Field` 以 `Fieldset` 渲染 | 6 |
| 源表多选 | coss `ToggleGroup`（multiple） | 1 |
| 原生 checkbox | coss `Checkbox`；字段白名单用 `CheckboxGroup` | 7 + 1 |
| SearchField | coss `InputGroup` 组合 | 11 |
| 原生日期输入 | `DatePicker`（coss `Calendar` + `Popover` + `InputGroup`，蓝本 p-date-picker-5）；时间与日期时间输入保持 coss `Input` | 5 |
| `<details>`、库表树 | coss `Collapsible` | 6 |
| FormNotice、InlineNotice、页内错误提示、运行横幅 | coss `Alert`（说明用 `role="note"`，反馈保留默认 `role="alert"`） | 49 |
| Dialog、Sheet | 调用点直接组合 coss `Dialog` / `Drawer`（右侧，straight） | 10 + 3 |
| Confirm | `ConfirmDialog`（coss `AlertDialog` 上的薄组合，承载对象、后果、忙碌态；初始焦点在取消） | 13 |
| 行菜单、顶栏菜单 | coss `Menu` | 3 |
| 说明气泡、显示列 | coss `Popover` | 1（+ DatePicker 内） |
| `title` 提示 | coss `Tooltip`；禁用按钮按 coss 写法包可聚焦的 span | 17 |
| Tabs、手写 tablist | coss `Tabs`（下划线列表） | 6 |
| Breadcrumb、EmptyState | coss `Breadcrumb` / `Empty` 上的薄组合（调用点不变） | 26 + 63 |
| Toast（NoticeProvider） | coss `ToastProvider` + `toastManager` | 23 个文件 |
| 命令面板 | coss `CommandDialog` + `Command`（蓝本 p-command-1） | 1 |
| 应用壳 | coss `SidebarProvider` / `Sidebar` / `SidebarInset` | 1 |
| Panel / PanelHead | coss `FramePanel` / `FrameHeader`（标题保持 h2） | 81 + 39 |
| DataTable、裸表格 | coss `Table` 系列 | 35 + 3 |
| TablePagination | coss `Pagination`（页码仍 0 基，保留「共 N 条记录」） | 16 |

`src/components/app` 现有 14 个文件：薄组合（StatusBadge、CodeTextarea、Loading、TableSkeleton、SearchField、DatePicker、EmptyState、Breadcrumb、ConfirmDialog）与纯业务件（FormGrid、ScopeNote、notice、discard-guard、Metric）。

## 4. 主题接入（无 preflight 的补丁清单）

项目不导入 Tailwind preflight，而 coss 源码按「有 preflight」编写。`tokens.css` 的 base 层补齐了 coss 实际依赖的子集，每条都有对应的实测缺口：

| 补丁 | 缺口现象 |
|---|---|
| `*, *::before, *::after { border: 0 solid; border-color: var(--border) }` | coss Input / Textarea 内层原生控件残留浏览器的 2px inset 边框 |
| `:where(ol, ul, menu)[data-slot]` 列表重置 | coss 面包屑、分页、侧栏菜单出现圆点 |
| `fieldset { min-width: 0; margin: 0; padding: 0 }` | coss Fieldset 偏位 |
| `@import "@daypicker/react/style.css" layer(base)` | coss Calendar 的网格结构；放 base 层才能被 coss 的工具类盖过 |

令牌桥在 `tokens.css` 末尾：coss 语义令牌映射到品牌色板，`@theme`（非 inline）输出 `--color-*`。项目原 `--color-muted` 与 coss 的 `muted`（浅底色）撞名，已改名 `--color-ink-muted`，368 处 `text-muted` 改为 `text-muted-foreground`。

## 5. 测试与 QA 锁迁移清单

原则：业务断言保留，只改交互方式与选择器。逐项如下。

**测试**

| 文件 | 变化 | 说明 |
|---|---|---|
| `labels.test.ts` | 改期望值 | `tone: 'danger'`→`'error'`、`'warn'`→`'warning'`（跟随 coss Badge 的变体名） |
| `toast.test.tsx` → `notice.test.tsx` | 迁移 | 错误回执为高优先级（`alertdialog`）、普通回执为 `dialog`；原断言的 aria-live 紧急/普通之分由 priority 承载 |
| `overlay.test.tsx` → `discard-guard.test.tsx`(4) + `confirm-dialog.test.tsx`(2) | 迁移 | 断言原样，改用 coss Dialog / Drawer / AlertDialog 搭最小容器 |
| `command-palette.test.tsx` | 迁移 | 按 combobox / option 角色查询；「关闭按钮的回车不被拦截」一条无对应物（coss 命令面板没有关闭按钮），并入键盘用例 |
| `structured-fields.test.tsx` | 新增 | 2 例回归（见 §6） |
| `app-shell.test.tsx` | 新增 1 例 | 侧栏热区与折叠按钮的辅助文本须含中文（见 §6 末段） |
| 其余 23 个文件 | 未改 | — |

**QA 锁**

| 锁 | 变化 |
|---|---|
| `portal-interactions-smoke`「采集配置 JSON 默认展开」 | 匹配 `<Collapsible defaultOpen`（原 `<details open`） |
| `portal-interactions-smoke`「版本切换可见高度 ≥32px」 | 断言未改；分段项保留 `min-h-[36px]` 使其继续成立 |
| `browser-smoke` fe3 规则类型回填 | 由原生 select 的 `inputValue()` 改读触发器 `innerText()` |
| `browser-smoke` fe3 版本切换 | 由 `button` 角色改按 `radio` 角色点击 |
| `browser-smoke` fe5 结局过滤 | `selectOption` → 点开 combobox 再点 option；断言范围由整个 `main` 收到 `main table tbody`（旧写法把所有选项文案都算进去，恒为真） |
| `browser-smoke` fe5 日期参数 | 改按 `textbox` 角色定位（日历按钮的标签含同一段文字） |
| `browser-smoke` fe2 / fe6 弹窗定位 | 按 `dialog` 角色泛查会把 coss Toast（同为 dialog 角色）算进来，改为按标题定位 |
| **新增** `qa/api-down-smoke.mjs` | 把门户构建成指向无人监听端口，逐路由断言：主工作区有内容、无横向溢出、无应用自身的控制台异常。此前的验证只覆盖接口正常的路径 |
| **新增** `qa/routes.mjs` | 路由清单从 `browser-smoke.mjs` 抽出，两个冒烟脚本共用；清单本身未改 |
| `browser-smoke` 通过输出 | 只改输出：通过行列出壳交互与各业务流实际执行的断言数（此前业务流通过时不输出任何内容，`--flows` 写错也会显示通过）。断言、路由与步骤未改 |

## 6. 顺带修复的存量缺陷

**结构化采集表单不随表单状态重渲染。** `StructuredTaskFields` 读 `form.state.values` 却没有订阅，而项目所用 `@tanstack/react-form` 1.33.5 的 `useForm` 不随状态重渲染。后果：在该表单里连续输入只剩首字符（实测输入「abc」只留下「a」），选库后源表区域不出现。原生 select 靠自己的 DOM 值掩盖了问题；换成受控的 coss Select 后立即暴露。已在改造前提交 `9044dc0` 上复现。修法：`useStore(form.store, (state) => state.values)`（`@tanstack/react-store` 0.11.2 由传递依赖转为直接依赖，精确版本），并补 2 例回归测试（去掉修复 2 例全挂，恢复后全过）。全库只有这一个 `useForm` 使用点。提交 `11818f0`。

**改造引入、交付前发现并修复的两处缺陷（提交 `00a0246`）。** 都只在控制面不可达时出现，所以靠 mock 的路由矩阵一直没碰到：

- *平台运维页在接口不可达时整页崩溃。* 浮层迁移脚本把 `useDiscardGuard(...)` 提到了「离 Dialog 最近的 `return`」之前，而那个 `return` 之上还有一处「无权限 / 平台不可用」的提前返回；一旦走到提前返回就少调了一个 hook，React 卸载了整页（错误 #300：rendered fewer hooks than expected）。`main` 上同场景不崩溃，确认是改造引入。修法：把 hook 提到所有提前返回之前；另写审计脚本扫过全部 `useDiscardGuard` 调用点，没有第二处。
- *面包屑分隔符嵌在条目内部。* coss 的分隔符本身是 `<li>`，我重写 Breadcrumb 时把它放进了每个条目里，形成 `<li>` 套 `<li>`。已按 coss 写法改为与条目平级。

发现过程值得记下：崩溃是在做完导入块整理（后提交为 `7e57707`）重跑路由矩阵时暴露的——当时 mock 已经停掉，接口全部不可达，`/operations` 报控制台异常。逐层排查（整理前 / `main`）才分清：这一处是改造引入；同一轮里暴露的另两页缺 h1 是存量（§7 第 6 条）。此前的路由矩阵全部建立在 mock 正常响应之上，「控制面整体不可达」这条路径没有被覆盖。

**同类的第三处（提交 `c87e633`）：侧栏边缘热区的英文悬停提示。** 收口时审计了 coss 部件在全部路由与浮层状态下实际渲染的英文辅助文本（`aria-label` / `title` / 读屏文本）。coss `SidebarRail` 自带 `title="Toggle Sidebar"`，鼠标移到侧栏边缘会显示英文提示——这是唯一肉眼可见的一处。coss 把 `props` 展开在最后，已在调用点覆盖成中文，并加 1 例测试（修复前该测试失败于 `"Toggle Sidebar"`）。实测后仍会到达读屏的只剩两处，见 §7 第 4 条。

## 7. 保留为自定义的部件与待裁决项

以下几项需要用户知情或裁决，均未自行扩大范围：

1. **主从列表的选中项按钮（10 处）保留为自定义按钮。** 它们是内容区的选择列表，不是侧栏导航；若改用 coss `SidebarMenuButton`，页面测试都必须包一层 `SidebarProvider`。涉及 AI Data、分析看板、资产目录与资产技术视图、数据服务、治理问题、交付中心、问数面、主索引复核。
2. **窄屏断点从 lg（1024px）变为 md（768px）。** coss Sidebar 以 md 为抽屉分界，旧壳是 lg。
3. **体积增加。** JS gzip 合计 331 KB → 490 KB（首屏入口块约 296 KB），CSS gzip 15.3 KB → 30.2 KB。来源是 Base UI 的浮层族（Dialog / Drawer / Popover / Menu / Tooltip / Select / Autocomplete / Toast / Sidebar）与 coss 组件的状态类字符串。日期选择器（约 24 KB）已按需加载。未做裁剪优化，候选见备忘。
4. **仍会到达读屏的两处英文来自 coss 部件内部（未改 coss 源码）：** Toast 视口的 `aria-label="Notifications"`（Base UI `Toast.Viewport` 的默认值，coss 的 `Toasts` 不向视口透传属性）；窄屏侧栏抽屉的读屏标题与说明「Sidebar」「Displays the mobile sidebar.」（写死在 `Sidebar` 的移动端分支）。两处都只有读屏用户会碰到，其中后者只在窄屏出现。此前记录的分页省略号「More pages」**并不外露**：它在带 `aria-hidden` 的子树里，不会被播报，此处更正。顶栏折叠按钮内部的读屏文本「Toggle Sidebar」已被调用点的 `aria-label` 盖住（按角色查不到该英文名的按钮）。
   审计口径：浏览器内扫描全部 29 路由及命令面板、侧栏折叠态、登记弹窗、下拉、提示气泡、窄屏抽屉各状态下 `aria-label` / `title` / `.sr-only` 的纯 ASCII 值，再核对可访问名与 `display`。
5. **源表芯片与版本切换芯片的 `title` 提示保留原生属性**（逐项包 Tooltip 的成本高于收益，且不影响键盘用户）。
6. **未动的既有问题：** 采集任务的「归档」在行菜单里直接执行、没有后果确认（改造前即如此）；5 个页面各自定义了同构的 `Fact`（label / value）组件；控制面不可达时，采集任务详情与数据源浏览两页的不可用状态没有 h1——涉及 3 条路由（任务详情占两条）；`main` 上同样是提前返回 `EmptyState`、先于页头。`api-down-smoke` 目前只断言主工作区非空，不拦这一项。
7. **核对截图时发现的存量缺口（未改）：** 「数据质量」页的执行批次面板显示「执行器 DBT」，前后截图里都有。后端把 `DBT` 当作合法的质量执行器配置值，而门户 `src/data/domain.ts` 的 `executorLabel` 只映射 `HTTP` / `DEMO`，其余原样显示。dev 与生产模板默认 `HTTP`，只有运维配成 `DBT` 时业务用户才会看到引擎名。修法是一行映射加一条测试，属于业务称谓改动，没有混进改造分支，记入备忘。

## 8. 验证记录

| 项 | 结果 |
|---|---|
| `npx tsc -b` | 通过 |
| `npx vitest run` | 30 文件 / 123 例通过 |
| `node qa/mock-audit.mjs` | 通过（17 路由、运行模式可见） |
| `node qa/portal-interactions-smoke.mjs` | 通过 |
| `node scripts/freeze-coss-snapshot.mjs --verify` | 通过：44 项登记完整，42 个已安装源文件与快照一致（未安装：form） |
| `npm run build` | 通过 |
| `node qa/browser-smoke.mjs --serve` | 58 项路由检查通过（无 console.error、无横向溢出） |
| `node qa/api-down-smoke.mjs` | 29 条路由通过（控制面不可达）；把守卫放回提前返回之后会在 `/operations` 失败，已反向验证 |
| `node qa/browser-smoke.mjs --serve --flows all` | 壳交互 5 项、fe2–fe6 共 25 项断言通过（全新 mock；通过行：`fe2 5、fe3 6、fe4 6、fe5 5、fe6 3`） |
| 深色偏好模拟 | 通过（`prefers-color-scheme: dark` 下计算样式与浅色一致） |
| 英文辅助文本审计（浏览器内扫描） | 修复后剩 Toast 视口与窄屏抽屉标题两处读屏文本，见 §7 第 4 条 |
| `node qa/artifact-manifest.mjs --licenses` | 本分支新增生产依赖 2 个（`@daypicker/react`、`@tanstack/react-store`）均为 MIT；生产依赖无未知/未授权许可证 |
| `npm audit`（官方源） | 6 条（2 moderate、4 high）：`@vitest/mocker`、`vitest`、`nanoid`、`source-map-js`、`undici`、`vite`。与 `main` 逐项相同，全部是开发工具链；新增的 `@daypicker/react`、`@tanstack/react-store` 无告警 |

以上各项均在分支最后一个代码提交 `7dd9fb6` 上执行。`573df9f` 之后的四个代码提交：`00a0246`（不可达修复与新锁）、`7e57707`（导入整理）、`c87e633`（热区中文辅助文本）、`7dd9fb6`（冒烟脚本分段输出，只改输出）。

运行业务流前必须重启 mock：控制面有状态，上一轮发布过的服务不会再次出现「发布」按钮。另：`node … | tail` 会吞掉非零退出码，脚本化时用 `set -o pipefail`。

## 9. 前后截图

同一 mock 数据、1440×900。目录 [`portal-coss-ui-20261123/`](portal-coss-ui-20261123/)。「改造后」截图取自 `7e57707` 的构建，其后的两个代码提交不改变外观。

| 路由 | 改造前 | 改造后 |
|---|---|---|
| `/` | [before](portal-coss-ui-20261123/before/index-1440.png) | [after](portal-coss-ui-20261123/after/index-1440.png) |
| `/ingestion` | [before](portal-coss-ui-20261123/before/ingestion-1440.png) | [after](portal-coss-ui-20261123/after/ingestion-1440.png) |
| `/governance/quality` | [before](portal-coss-ui-20261123/before/governance-quality-1440.png) | [after](portal-coss-ui-20261123/after/governance-quality-1440.png) |
| `/governance/standards` | [before](portal-coss-ui-20261123/before/governance-standards-1440.png) | [after](portal-coss-ui-20261123/after/governance-standards-1440.png) |
| `/assets` | [before](portal-coss-ui-20261123/before/assets-1440.png) | [after](portal-coss-ui-20261123/after/assets-1440.png) |
| `/data-services` | [before](portal-coss-ui-20261123/before/data-services-1440.png) | [after](portal-coss-ui-20261123/after/data-services-1440.png) |

状态截图：[登记数据源弹窗](portal-coss-ui-20261123/after/state-dialog-register.png)、[命令面板](portal-coss-ui-20261123/after/state-command-palette.png)、[侧栏图标折叠态](portal-coss-ui-20261123/after/state-sidebar-collapsed.png)。

## 10. 升级指引

1. `npx shadcn@latest add @coss/<name> --yes --overwrite < /dev/null`，然后 `git checkout -- src/lib/utils.ts`（CLI 会询问是否覆盖项目的 `cn`）。
2. CLI 给新依赖写 `^` 范围：钉成精确版本后 `npm install --package-lock-only`。
3. `node scripts/freeze-coss-snapshot.mjs` 重新冻结，`--verify` 校验。
4. 本机到不了 `ui.shadcn.com`：`components.json` 的 `style` 必须是合法预设名 `nova`。
