# 门户改造为 coss ui：gate 记录（2026-11-24，11-25 收口与裁决落地）

分支 `feat/portal-coss-ui`（截至最后一个代码提交 `f99bd38` 共 30 个提交，其中 2 个是文档提交；其后两次文档更新共 32 个）。2026-11-25 按用户指示推送到 `origin`，随后合并到 `main`（不快进，保留合并提交）。基线为 `main` 的 `9044dc0`。11-25 用户对三项待裁决事项的裁决与落地见 §11。

## 1. 结论

门户 UI 层已整体改用 [coss ui](https://github.com/cosscom/ui)（Base UI + Tailwind 4，shadcn 式源码分发）。
手写组件层 `src/components/kit` 与旧快照 `shadcn-registry-snapshot` 已删除；页面里不再有裸的 `<button>` 主按钮、`<input>` / `<select>` / `<textarea>`、`<details>`、`role="alert"` 与原生 `title` 提示（保留项见 §7）。

- 测试：30 文件 / 125 例全绿（基线 28 / 120，净增 5 例：2 例表单回归，1 例侧栏辅助文本，2 例执行器称谓）。
- QA 锁：`mock-audit`、`portal-interactions-smoke`、`bundle-budget` 全过，断言无删除。
- 浏览器：29 路由 × 3 宽度（1440 / 1280 / 800）共 87 项检查全过；壳交互 5 项、窄屏断点 6 项、业务流 fe2–fe6 共 25 项断言在全新 mock 上全过（通过行逐段列出断言数）。
- 体积（gzip）：首屏闭包 JS 220 KB（优化前 288 KB，`main` 205 KB）；全部 JS 489 KB（`main` 353 KB）；CSS 30 KB（`main` 15 KB）。明细与取舍见 §11 第 5 条。
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
| 「12 处 aria-pressed」 | 实测只有 4 处是筛选/切换，已迁；其余 8 处是主从列表的选中项，改造时保留为自定义按钮，11-25 按用户裁决改用 coss `SidebarMenuButton`（§11 第 3 条） | CU3 盘点；用户 2026-11-25 |
| 窄屏断点 | 接受 coss 的 800px 分界并加锁（实测值，不是此前记的 768） | 用户 2026-11-25（§11 第 4 条） |
| 体积 | 首屏闭包 288 KB → 220 KB，并设预算锁进 CI；合计不降，属于功能成本 | 用户 2026-11-25（§11 第 5 条） |
| 质量执行器名直出 | 补 `DBT` 映射，未登记的取值不再原样显示 | 用户 2026-11-25（§11 第 2 条） |
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
| 主从列表的选中项（手写 `aria-pressed` 按钮） | coss `SidebarMenu` / `SidebarMenuItem` / `SidebarMenuButton`；内容区的浅色配色由薄组合 `SelectionListItem` 承载（§11 第 3 条） | 8 |

`src/components/app` 现有 15 个文件：薄组合（StatusBadge、CodeTextarea、Loading、TableSkeleton、SearchField、DatePicker、EmptyState、Breadcrumb、ConfirmDialog、SelectionListItem）与纯业务件（FormGrid、ScopeNote、notice、discard-guard、Metric）。

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
| `app-shell.test.tsx` | 新增 1 例；改 mock | 侧栏热区与折叠按钮的辅助文本须含中文（§6）；命令面板改为按需加载后，快捷键钩子迁到独立模块，面板的 mock 里去掉它 |
| `domain.test.ts` | 新增 2 例 | 质量执行器称谓：`DBT` 与 `HTTP` 同一通道、未登记取值不直出（§11 第 2 条） |
| `asset-catalog-page.test.tsx`、`quality-page.test.tsx`、`AssistantLive.test.tsx`、`MpiReviewLive.test.tsx` | 只换渲染函数 | 列表项改用 coss `SidebarMenuButton` 后需要 `SidebarProvider` 上下文，改用 `test-support/render-with-sidebar`；断言一字未改 |
| 其余 18 个文件 | 未改 | — |

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
| `browser-smoke` 通过输出 | 只改输出：通过行列出各段实际执行的断言数（此前业务流通过时不输出任何内容，`--flows` 写错也会显示通过）。断言、路由与步骤未改 |
| `browser-smoke` 路由矩阵 | 增加第 3 档宽度 800px（coss 桌面模式的下界，侧栏展开时内容区最窄）：29 路由 × 3 宽度 = 87 项 |
| **新增** `browser-smoke`「窄屏断点」段 | 6 项断言：799px 不渲染桌面侧栏、导航按钮能打开抽屉、抽屉内有主导航链接、点链接后跳转并收起；800px 渲染展开的侧栏。把 coss 钩子里的分界临时改成 768 会失败 2 项，已反向验证 |
| **新增** `qa/bundle-budget.mjs` | 读 `dist/` 量首屏闭包、全部 JS 与 CSS 的 gzip 体积并卡上限（235 / 520 / 34 KB）；CI 在构建之后执行 |

## 6. 顺带修复的存量缺陷

**结构化采集表单不随表单状态重渲染。** `StructuredTaskFields` 读 `form.state.values` 却没有订阅，而项目所用 `@tanstack/react-form` 1.33.5 的 `useForm` 不随状态重渲染。后果：在该表单里连续输入只剩首字符（实测输入「abc」只留下「a」），选库后源表区域不出现。原生 select 靠自己的 DOM 值掩盖了问题；换成受控的 coss Select 后立即暴露。已在改造前提交 `9044dc0` 上复现。修法：`useStore(form.store, (state) => state.values)`（`@tanstack/react-store` 0.11.2 由传递依赖转为直接依赖，精确版本），并补 2 例回归测试（去掉修复 2 例全挂，恢复后全过）。全库只有这一个 `useForm` 使用点。提交 `11818f0`。

**改造引入、交付前发现并修复的两处缺陷（提交 `00a0246`）。** 都只在控制面不可达时出现，所以靠 mock 的路由矩阵一直没碰到：

- *平台运维页在接口不可达时整页崩溃。* 浮层迁移脚本把 `useDiscardGuard(...)` 提到了「离 Dialog 最近的 `return`」之前，而那个 `return` 之上还有一处「无权限 / 平台不可用」的提前返回；一旦走到提前返回就少调了一个 hook，React 卸载了整页（错误 #300：rendered fewer hooks than expected）。`main` 上同场景不崩溃，确认是改造引入。修法：把 hook 提到所有提前返回之前；另写审计脚本扫过全部 `useDiscardGuard` 调用点，没有第二处。
- *面包屑分隔符嵌在条目内部。* coss 的分隔符本身是 `<li>`，我重写 Breadcrumb 时把它放进了每个条目里，形成 `<li>` 套 `<li>`。已按 coss 写法改为与条目平级。

发现过程值得记下：崩溃是在做完导入块整理（后提交为 `7e57707`）重跑路由矩阵时暴露的——当时 mock 已经停掉，接口全部不可达，`/operations` 报控制台异常。逐层排查（整理前 / `main`）才分清：这一处是改造引入；同一轮里暴露的另两页缺 h1 是存量（§7 第 3 条）。此前的路由矩阵全部建立在 mock 正常响应之上，「控制面整体不可达」这条路径没有被覆盖。

**同类的第三处（提交 `c87e633`）：侧栏边缘热区的英文悬停提示。** 收口时审计了 coss 部件在全部路由与浮层状态下实际渲染的英文辅助文本（`aria-label` / `title` / 读屏文本）。coss `SidebarRail` 自带 `title="Toggle Sidebar"`，鼠标移到侧栏边缘会显示英文提示——这是唯一肉眼可见的一处。coss 把 `props` 展开在最后，已在调用点覆盖成中文，并加 1 例测试（修复前该测试失败于 `"Toggle Sidebar"`）。实测后仍会到达读屏的只剩两处，见 §7 第 1 条。

**存量缺口的修复（提交 `5b3b375`）：质量执行器名直出。** 即 §7 原第 7 条。`data/domain.ts` 的 `executorLabel` 现在把 `DBT` 与 `HTTP` 映射为同一业务称谓（后端对二者是同一通道，且存库前统一大写，门户侧同样不分大小写），未登记的取值落到通用的「质量执行器」而不再原样显示，免得以后后端新增一个执行器名又把缺口打开。补 2 例测试，修复前均失败。

## 7. 仍保留的项

改造期间登记的四项待裁决（主从列表按钮、窄屏断点、体积、执行器名直出）已于 2026-11-25 处理，见 §11。仍未动的几项如下：

1. **仍会到达读屏的两处英文来自 coss 部件内部（未改 coss 源码）：** Toast 视口的 `aria-label="Notifications"`（Base UI `Toast.Viewport` 的默认值，coss 的 `Toasts` 不向视口透传属性）；窄屏侧栏抽屉的读屏标题与说明「Sidebar」「Displays the mobile sidebar.」（写死在 `Sidebar` 的移动端分支）。两处都只有读屏用户会碰到，其中后者只在窄屏出现。此前记录的分页省略号「More pages」**并不外露**：它在带 `aria-hidden` 的子树里，不会被播报，此处更正。顶栏折叠按钮内部的读屏文本「Toggle Sidebar」已被调用点的 `aria-label` 盖住（按角色查不到该英文名的按钮）。
   审计口径：浏览器内扫描全部 29 路由及命令面板、侧栏折叠态、登记弹窗、下拉、提示气泡、窄屏抽屉各状态下 `aria-label` / `title` / `.sr-only` 的纯 ASCII 值，再核对可访问名与 `display`。
2. **源表芯片与版本切换芯片的 `title` 提示保留原生属性**（逐项包 Tooltip 的成本高于收益，且不影响键盘用户）。
3. **未动的既有问题：** 采集任务的「归档」在行菜单里直接执行、没有后果确认（改造前即如此）；5 个页面各自定义了同构的 `Fact`（label / value）组件；控制面不可达时，采集任务详情与数据源浏览两页的不可用状态没有 h1——涉及 3 条路由（任务详情占两条）；`main` 上同样是提前返回 `EmptyState`、先于页头。`api-down-smoke` 目前只断言主工作区非空，不拦这一项。

## 8. 验证记录

| 项 | 结果 |
|---|---|
| `npx tsc -b` | 通过 |
| `npx vitest run` | 30 文件 / 125 例通过 |
| `node qa/mock-audit.mjs` | 通过（17 路由、运行模式可见） |
| `node qa/portal-interactions-smoke.mjs` | 通过 |
| `node scripts/freeze-coss-snapshot.mjs --verify` | 通过：44 项登记完整，42 个已安装源文件与快照一致（未安装：form） |
| `npm run build` | 通过 |
| `node qa/browser-smoke.mjs --serve` | 87 项路由检查通过（29 路由 × 1440 / 1280 / 800；无 console.error、无横向溢出） |
| `node qa/api-down-smoke.mjs` | 29 条路由通过（控制面不可达）；把守卫放回提前返回之后会在 `/operations` 失败，已反向验证 |
| `node qa/browser-smoke.mjs --serve --flows all` | 壳交互 5 项、窄屏断点 6 项、fe2–fe6 共 25 项断言通过（全新 mock；通过行：`fe2 5、fe3 6、fe4 6、fe5 5、fe6 3`） |
| `node qa/bundle-budget.mjs` | 通过：首屏闭包 JS 220.0 KB（上限 235）、全部 JS 489.4 KB（上限 520）、CSS 29.7 KB（上限 34）。同一脚本量优化前的构建会失败，报出首屏闭包 288.4 KB 及其构成 |
| 深色偏好模拟 | 通过（`prefers-color-scheme: dark` 下计算样式与浅色一致） |
| 英文辅助文本审计（浏览器内扫描） | 修复后剩 Toast 视口与窄屏抽屉标题两处读屏文本，见 §7 第 1 条 |
| `node qa/artifact-manifest.mjs --licenses` | 本分支新增生产依赖 2 个（`@daypicker/react`、`@tanstack/react-store`）均为 MIT；生产依赖无未知/未授权许可证 |
| `npm audit`（官方源） | 6 条（2 moderate、4 high）：`@vitest/mocker`、`vitest`、`nanoid`、`source-map-js`、`undici`、`vite`。与 `main` 逐项相同，全部是开发工具链；新增的 `@daypicker/react`、`@tanstack/react-store` 无告警 |

以上各项均在分支最后一个代码提交 `f99bd38` 上执行。`573df9f` 之后的代码提交：`00a0246`（不可达修复与新锁）、`7e57707`（导入整理）、`c87e633`（热区中文辅助文本）、`7dd9fb6`（冒烟脚本分段输出），以及 §11 的 `5b3b375`、`9546c04`、`766753d`、`f99bd38`。

运行业务流前必须重启 mock：控制面有状态，上一轮发布过的服务不会再次出现「发布」按钮。另：`node … | tail` 会吞掉非零退出码，脚本化时用 `set -o pipefail`。

## 9. 前后截图

同一 mock 数据、1440×900。目录 [`portal-coss-ui-20261123/`](portal-coss-ui-20261123/)。「改造后」截图取自 `f99bd38` 的构建。与上一版相比，数据质量页的执行器一栏由「执行器 DBT」变为「质量执行器（在线）」，主从列表的选中项字重变为中等（coss 的选中态）。

重出截图时的两个坑：mock 给「复检中」的问题设的轮询时间是详情生成后 3 秒，到点页面自动同步、问题随即关闭，所以截图要在全新 mock 上按矩阵顺序、页面出现后 1 秒内拍；状态截图脚本会点确认弹窗和行内菜单、改动 mock 数据，必须排在路由截图之后。

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

## 11. 2026-11-25：三项裁决的落地

用户对收口时列出的三项待裁决事项的指示是「完成这三项」。逐项落地如下，每项独立提交。

**1. 推送与合并。** 收口时的 26 个提交原样推送到 `origin/feat/portal-coss-ui`，下面的四笔随后推送。之后用户指示「合并到 main」：`main` 停在分支基点上、无需冲突处理，按上一次前端迁移的惯例以合并提交（不快进）并入。CI 只在推 `main` 时触发，所以这是这批改动在 CI 上的首跑。

**2. 质量执行器名（`5b3b375`）。** 见 §6 末段。

**3. 主从列表的选中项改用 coss（`9546c04`）。** 实测是 8 处（8 个页面各一处），不是此前记的 10 处：AI Data、分析看板、资产目录、数据服务、治理问题、交付中心、问数面、主索引复核。coss 自己的主从布局里，列表项就是 `SidebarMenu > SidebarMenuItem > SidebarMenuButton isActive`，八处照此改写。`SidebarMenuButton` 的默认配色是给深色侧栏用的，薄组合 `components/app/selection-list-item.tsx` 只做三处适配：悬停与选中配色换成内容区的品牌令牌、高度放开以容纳多行、子元素纵向排列。运行时页面本来就在壳的 `SidebarProvider` 之内，无需改动；四个单独渲染页面的测试改用 `test-support/render-with-sidebar`，断言未改。可见变化只有一处：选中项的字重按 coss 的选中态变为中等。页面里不再有手写的 `aria-pressed` 按钮。

**4. 窄屏断点（`766753d`）。** 实测分界是 **800px**，不是此前记录的 768：coss 的 `useIsMobile` 取 `max-md`，而 coss 自带断点表里的 `md` 是 800。799px 及以下是抽屉，800px 起是侧栏。旧壳在 1024px 以下都是抽屉，所以行为变化只发生在 800–1023 这一段：现在是展开的侧栏（232px，内容区 568–791px），折叠成图标栏后内容区 732px。

- 全部 29 条路由在 800 / 900 / 1023 三个宽度下实测：无页面级横向溢出、无被裁切的内容、无控制台异常；网格自动堆叠，宽表格在自己的容器里滚动。
- 799px 与 390px：抽屉 288px 宽、11 个导航项，点「数据接入」后跳转并收起。
- 裁决是接受 coss 的分界：它写在 coss 源码里（不改源码动不了），这段区间实测站得住，目标设备是桌面工作站，窄窗口下可以一键折叠。加锁见 §5：路由矩阵增加 800px 一档，新增「窄屏断点」6 项断言。

**5. 体积（`f99bd38`）。** 同一个脚本（`qa/bundle-budget.mjs`）量三份真实构建，gzip：

| | `main` | 优化前 | 现在 |
|---|---|---|---|
| 首屏闭包 JS（入口 chunk 及其静态导入链） | 205.4 KB | 288.4 KB | 220.0 KB |
| 落在总览页、到首屏出现为止的脚本 | 215.6 KB | 302.1 KB | 271.6 KB |
| 全部 JS | 353.3 KB | 480.8 KB | 489.4 KB |
| CSS | 15.0 KB | 29.7 KB | 29.7 KB |

首屏闭包在改造中涨了 83 KB，其中约 57 KB 是首屏根本用不到的代码，被 `manualChunks` 的分组规则强行带进 `vendor`：表格与表单核心约 28 KB（`main` 上就在首屏，属于存量浪费）；改造把 `@base-ui/` 整体并入 `vendor`，下拉、抽屉、页签、折叠、复选框等只有页面才用的 Base UI 部件约 29 KB 也跟着进了首屏。

- 分包规则改为按包名精确匹配，只把首屏真正要用的库放进 `vendor`；Base UI 不再手工分组，由 Rollup 按实际引用关系拆分。
- 命令面板改为第一次打开时才加载，空闲时预取；壳只常驻快捷键钩子（迁到独立模块）。浏览器实测：快捷键与顶栏按钮都能打开、过滤与跳转正常、Esc 关闭、输入框内不抢占，首屏请求的脚本里没有它。
- `experimentalMinChunkSize: 4000` 合并过小的 chunk（拆分后出现过 28 个不足 2KB 的碎片）。

两处走了弯路、已写进配置注释：react 运行时必须显式归入首屏分组，否则 Rollup 会把它并进第一个引用它的手工分组；`@tanstack/react-store` 属于首屏，路由库自己依赖它。这两处都是先在闭包量测里看出多了不该有的 chunk 才发现的，所以预算锁按产物里的静态 import 算闭包，不看源码。

取舍与如实说明：

- 对每天打开总览页的人，实际改善是 302 → 272 KB（−10%），不是首屏闭包那个数字显示的 68 KB：总览页自己要用表格和下拉，这部分省不掉。与 `main` 相比，落在总览页仍多 56 KB——新壳与新页面用到的 Base UI 部件（菜单、提示、下拉、表格的交互）比旧的手写层多。
- **全部 JS 的合计比优化前多了 8.6 KB**：拆得更细之后，每个 chunk 的包装和跨 chunk 引用让 gzip 效率变差。把小 chunk 合并到更粗能把合计压回去，但首屏会变大（实测：阈值 10000 时首屏 +11 KB、合计 −9 KB；20000 时首屏 +41 KB），按首屏优先取舍。
- 合计本身是功能成本：Base UI 在 `main` 上是 32 KB、现在是 116 KB，对应下拉、抽屉、日期选择、菜单、提示这些真实组件取代原生控件和手写浮层。不删功能降不下来。
- CSS 的 30 KB 里有 84 条深色模式规则（原始 17.5 KB；应用里没有任何地方会加上触发它们的类），gzip 后约 2 KB。去掉它需要在构建管线里加一个自定义 PostCSS 插件裁规则，收益不到首屏的 1%，不值得。

预算锁 `qa/bundle-budget.mjs`：首屏闭包 JS ≤ 235 KB、全部 JS ≤ 520 KB、CSS ≤ 34 KB，约为实测值之上留 7%（CSS 15%）的余量。CI 在构建之后执行（`.github/workflows/ci.yml` 新增一步）。用同一脚本量优化前的构建会失败并报出闭包构成。
