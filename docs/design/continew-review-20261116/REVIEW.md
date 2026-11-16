# 医数中枢前端重构设计审核稿

用户已于 **2026-11-16 批准原型 v0.2**，视觉与操作容器分工成为实施依据。[实施计划](../../frontend-stack-migration-plan-20261116.md)仍待用户审核，正式迁移尚未启动，未安装新依赖。原型为独立静态 HTML，数据均为合成样例；其检查结果不代表正式门户业务迁移已验收。批准制品见 [SHA-256 清单](APPROVED-BASELINE.json)。

**v0.2 交互修订**：按用户反馈区分操作容器，详见 [抽屉/弹窗适配矩阵](OVERLAY-GUIDE.md)、[26 个现有覆盖层盘点](OVERLAY-AUDIT.md) 与 [Continew 源码依据](CONTINEW-OVERLAYS.md)。本轮已在原型落地短表单 Dialog、删除 AlertDialog、独立任务编辑页与退出保护；未将全部存量建议表述为已实施。

## 页面范围

按已确认的「总览 → 数据接入 → 数据质量 → 数据资产」主线，覆盖四类工作面：

| 页面 | 审核内容 |
| --- | --- |
| 总览 | 关键指标、优先待办、趋势与异常入口的主次关系 |
| 数据接入 | 任务清单、搜索筛选、列显示、分页与任务详情 |
| 数据质量 | 问题队列、状态筛选、责任链与证据详情 |
| 数据资产 | 资产目录、检索筛选、资产信息与关联证据 |

直接打开本目录的 **`review.html`** 即可离线审核，样式、图标和交互均已内嵌，无需安装依赖。

本机预览：[打开可点击原型](http://127.0.0.1:5189/)；四页可直接通过 `#overview`、`#ingestion`、`#quality`、`#assets` 定位。

需要重新启动本机预览时，在仓库根目录运行：

```bash
python3 -m http.server 5189 --bind 127.0.0.1 --directory docs/design/continew-review-20261116
```

可编辑源文件为 `index.html`、`styles.css`、`app.js`、`icons.js`、`interaction-patterns.js`。修改后运行 `node docs/design/continew-review-20261116/build-review.mjs` 更新离线包。`review.html` 是独立交付包，不代表新的正式门户工程。

## 参考与采用方式

参考项目为 [continew-ui-next](https://github.com/ppxb/continew-ui-next)。本轮依据公开源码提炼设计，未实测参考在线站，源码中的交互不视为已完成浏览器验证。

| 采用的设计 | 来源与应用 |
| --- | --- |
| 分组侧栏与收起模式 | [AppSidebar](https://github.com/ppxb/continew-ui-next/blob/master/src/components/app-shell/sidebar/app-sidebar.tsx)、[NavMain](https://github.com/ppxb/continew-ui-next/blob/master/src/components/app-shell/sidebar/nav-main.tsx)：保留稳定的业务入口、分组和展开层级。 |
| 48px 顶栏内页签 | [AppShell](https://github.com/ppxb/continew-ui-next/blob/master/src/components/app-shell/index.tsx)、[HeaderTabs](https://github.com/ppxb/continew-ui-next/blob/master/src/components/app-shell/header/header-tabs.tsx)：将搜索、页签与全局工具安排在紧凑顶栏内，减少框架占高。 |
| 中性白灰与蓝色主动作 | [globals.css](https://github.com/ppxb/continew-ui-next/blob/master/src/styles/globals.css)、[偏好默认值](https://github.com/ppxb/continew-ui-next/blob/master/src/lib/preferences/preferences-config.ts)、[主题色](https://github.com/ppxb/continew-ui-next/blob/master/src/lib/preferences/theme.ts)：以白灰建立层次，蓝色用于选中态和主动作；异常状态保留文字说明。 |
| 连续表格工作面 | [ListPageCard](https://github.com/ppxb/continew-ui-next/blob/master/src/components/list-page-card.tsx)、[DataTable](https://github.com/ppxb/continew-ui-next/blob/master/src/components/data-table.tsx)、[TableToolbar](https://github.com/ppxb/continew-ui-next/blob/master/src/components/table-toolbar.tsx)：标题、筛选、工具、表格、分页连续排列，避免反复嵌套容器。 |
| 右侧详情抽屉 | [EntityDrawer](https://github.com/ppxb/continew-ui-next/blob/master/src/components/entity-drawer.tsx)：保留清单上下文，在右侧展示对象、证据和操作反馈。 |

适配本项目的三处调整：侧栏采用 256px（1280px 桌面下收至 232px），质量抽屉扩至 610px 容纳证据与五类关联对象，页面搜索保留已有的 ⌘ / Ctrl K。治理六类入口在侧栏展开，质量页不再重复占用一排业务导航。

## 设计图

| 文件 | 内容 |
| --- | --- |
| `00-concept.png` | 内置 imagegen 生成的总览概念图，[生成记录](IMAGE-PROMPT.md) |
| `01-overview-1440.png` | 总览，最终浏览器截图 |
| `02-ingestion-1440.png` | 采集任务，最终浏览器截图 |
| `03-quality-1440.png` | 数据质量，最终浏览器截图 |
| `04-assets-1440.png` | 资产目录，最终浏览器截图 |
| `05-quality-detail-1440.png` | 质量事件证据与影响 |
| `06-responsibility-chain-1440.png` | 责任链的五类对象、编号与来源 |
| `07-asset-detail-1440.png` | 资产概览与上下游关系 |
| `08-new-task-1440.png` | 独立任务编辑页与默认可见的配置 JSON |
| `09-error-state-1440.png` | 服务不可用时的就地恢复入口 |
| `10-source-dialog-1440.png` | 三字段数据源登记 Dialog |
| `11-task-copy-dialog-1440.png` | 两字段任务复制 Dialog |
| `12-rule-delete-1440.png` | 规则删除 AlertDialog，默认聚焦取消 |
| `13-unsaved-exit-1440.png` | 编辑页离开时的未保存确认 |
| `14-task-editor-1440.png` | 完整任务工作区，来源/策略与配置并排 |

最终审核以交互原型和浏览器截图为准。

## 保留的业务语义

沿用现有领域词汇、功能归属与状态含义。治理责任链继续区分问题、资产、规则、责任人和工单，并呈现关联标识、来源与时间；复检请求登记与规则执行结果分别表达；资产元数据与质量结论区分来源。原型操作不产生真实采集、复检、保存、发布或业务持久化事实。

## 目标技术栈映射

以下为审核通过后实施时的职责划分，本轮静态原型不代表这些依赖已经接入。

| 技术 | 负责范围 |
| --- | --- |
| React 19 + TypeScript + Vite | 页面、组件、类型约束与构建 |
| shadcn/ui | 导航、按钮、表格容器、对话框、抽屉等基础组件 |
| Tailwind 4 | 视觉令牌、布局、间距、颜色及组件样式 |
| TanStack Router | 路由、深链与搜索参数，承载可恢复的检索和筛选条件 |
| TanStack Query | 服务数据加载、刷新、错误、缓存失效与动作后的数据同步 |
| TanStack Table | 列、排序、筛选、选择与分页等表格状态 |
| TanStack Form | 仅在复杂表单需要统一校验与字段状态时按需使用 |
| TanStack Virtual | 仅在大列表经规模验证需要虚拟化时按需使用 |

「TanStack 全家桶」按实际职责选择，不解释为安装所有相关依赖。

## 本轮审核点

1. **布局密度**：桌面首屏是否足够紧凑，待办、指标与工作区主次是否清楚。
2. **导航层级**：业务分组、侧栏收起与顶栏页签是否便于定位和切换。
3. **表格交互**：搜索、筛选、列显示、分页及反馈是否符合日常工作习惯。
4. **抽屉证据**：详情是否保留清单上下文，责任链、数据来源与状态含义是否可追溯。

## 验证与范围

- 本机独立 Chrome 完成 74 项检查：既有 57 项回归，加 17 项容器交互检查。覆盖四页 × 1440/1280 桌面宽度 × 五状态，以及短表单/确认弹窗/独立页、失败保值、提交互斥、未保存保护、跨详情页签草稿保留、详情转表单不叠层、Popover、焦点和 Esc。
- 四页无页面横向溢出、无框架错误覆盖层、无控制台运行异常。补验 1920px 与减少动态效果。1280×800 保留正常页面纵向滚动。
- 抽屉支持 Tab 首尾循环、Esc 关闭与焦点归还；复检登记后阻止重复提交，等待异步结果。
- 离线 `review.html` 直接打开后导航与抽屉通过，未产生 HTTP 请求或运行异常。
- 现有门户的 mock audit 与 portal interactions smoke 通过；未修改其源码、依赖或测试。
- Browser plugin 未提供，原型验证使用已安装 Playwright 与 Chrome，无新增依赖。参考在线站的 CUA 访问审核超时，未取得页面观察权限；参考设计只依据公开源码，没有通过其他浏览器绕过该限制。
- 静态设计检测器缺少 HTML/CSS 解析依赖，降级为正则，不能据此宣称完整对比度或可访问性审计通过。唯一提示为参考风格的 Geist 字体，交付使用本地字体回退。

上述检查只验证本地审核原型。其余页面的详细设计、真实接口、登录授权与新技术栈迁移仍待后续工作；本轮未提交推送或部署。

