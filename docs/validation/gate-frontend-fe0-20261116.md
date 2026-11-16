# FE0 前端技术栈迁移验收：基线与依赖冻结

> 日期：2026-11-16｜Gate：FE0｜状态：**通过**（本地；未推送）
> 计划：[前端技术栈迁移实施计划](../frontend-stack-migration-plan-20261116.md)｜代码基线：`64aa39b`

## 1. 结论

- 旧基线在本机重跑，**45 项测试 / 10 文件全绿**，双 QA 与生产构建通过；旧 `dist` 指纹已记录。
- 冻结目标依赖**全部按精确补丁安装成功**，类型检查、运行探针与最小 Tailwind 构建通过。
- 兼容风险结论：**可以进入 FE1**。未发现必须升级 Vite/TS/React 主版本的问题。
- 一处环境偏差：本机系统默认 Node 为 24.3.0；FE0 用 fnm 安装并在全部验证命令中固定使用 22.23.5（npm 10.9.9），未修改系统默认版本。CI 改为读取 `.node-version`。

## 2. 旧基线重跑（Node 22.23.5）

| 检查 | 命令 | 结果 |
| --- | --- | --- |
| 依赖安装 | `npm ci` | 214 包，成功 |
| 类型 | `npx tsc -b` | 通过 |
| 测试 | `npx vitest run` | 10 文件 / 45 用例全绿 |
| mock 边界 | `node qa/mock-audit.mjs` | passed（9 静态页门禁） |
| 交互烟测 | `node qa/portal-interactions-smoke.mjs` | passed |
| 构建 | `npm run build` | 成功 |

旧制品指纹（FE7 回滚比对基线）：

| 制品 | 大小 | SHA-256 |
| --- | --- | --- |
| `dist/index.html` | 834 B | `930c16d6cdc568c3a23cf4f25f25972e886394f93982c2d8983123ff73a35b58` |
| `dist/assets/index-D0tF2b3I.js` | 1,495.23 kB | 见 `dist/` 同次构建产物 |
| `dist/assets/index-D4UC-Gva.css` | 136.18 kB | 同上 |

## 3. 冻结依赖（resolved 实测）

| 依赖 | 计划目标 | 实际 resolved | 结论 |
| --- | --- | --- | --- |
| node / npm | 22.23.5 / 10.9.9 | 22.23.5 / 10.9.9 | 一致（`.node-version` + `packageManager`） |
| react / react-dom | 19.2.8 | 19.2.8 | 一致 |
| typescript / vite / plugin-react | 5.7.3 / 6.4.3 / 4.7.0 | 5.7.3 / 6.4.3 / 4.7.0 | 一致 |
| vitest / jsdom | 4.1.10 / 29.1.1 | 4.1.10 / 29.1.1 | 一致 |
| tailwindcss / @tailwindcss/vite | 4.3.5 / 4.3.5 | 4.3.5 / 4.3.5 | 一致 |
| @base-ui/react | 1.9.0 | 1.9.0 | 一致 |
| @tanstack/react-router | 1.170.46 | 1.170.46 | 一致 |
| @tanstack/react-query | 5.107.1 | 5.107.1 | 一致 |
| @tanstack/react-table | 9.3.1 | 9.3.1 | 一致 |
| @tanstack/react-form | 1.33.5 | 1.33.5 | 一致 |
| playwright | 1.65.1 | 1.65.1 | 一致 |
| @types/node | 22.19.3 | 22.19.3 | 一致 |
| clsx / tailwind-merge / cva / tw-animate-css | 2.1.1 / 3.7.0 / 0.7.1 / 1.4.0 | 同左 | 一致 |
| antd（迁移期保留） | 6.6.6 | 6.6.6 | 一致 |

全部为精确补丁（`--save-exact`），`package-lock.json` 记录完整性哈希；`@superset-ui/embedded-sdk`、`dayjs`、`lucide-react` 保持原范围不变。

## 4. 兼容探针（临时，未入库）

探针文件 `src/compat-probe.test.tsx` 在验证后删除，覆盖：

| 探针 | 结果 |
| --- | --- |
| Router：代码路由 + `createMemoryHistory` + `validateSearch` + 渲染 | 通过 |
| Query：`QueryClientProvider` + `useQuery` 取数 | 通过 |
| Table v9：`tableFeatures({ rowPaginationFeature, rowSelectionFeature })` + `useTable` + `columnHelper.columns([...])` | 通过 |
| Form：`useForm` 字段状态 | 通过 |
| Base UI：`Dialog.Root/Trigger/Portal/Popup` 渲染 | 通过 |
| 样式辅助：`clsx` + `twMerge` + `cva` | 通过 |
| Tailwind 4：`@tailwindcss/vite` 在 Vite 6 上产出一份 utility（拆分导入、无 preflight） | 构建通过 |

**Table v9 实测要点（供 FE1 实现）**：

- 必须使用 `tableFeatures({...})` 注册特性；`createColumnHelper<typeof features, TData>()`。
- 列数组用 `helper.columns([...])` 保留逐列值类型；直接传数组会被放宽为 `unknown` 并触发类型错误。
- `useTable` 返回值以 `table.state` 投影读取状态；`table.Subscribe` 供局部订阅。

## 5. shadcn registry 冻结

- CLI 版本：`shadcn@4.23.0`；样式：`base-nova`（Base UI 底座的官方默认）。
- 快照：`prototype/shadcn-registry-snapshot/base-nova/*.json`（37 个组件/原语），清单与 SHA-256 见同目录 `manifest.json`。
- FE1 依据快照生成 `src/components/ui/` 源码，并记录每处对批准视觉（v0.2 令牌、13px 基准、密集表格）的适配；CI 不重新拉取 registry。
- `registry` 中的 `cn` 依赖不是可下载条目（返回 HTML），`cn()` 由项目 `src/lib/utils.ts` 自持。

## 6. 未验证与限制

- 本轮未运行浏览器端到端矩阵（FE1 起建立 `qa/browser-smoke.mjs`）。
- Playwright 1.65.1 已安装；浏览器二进制未在本轮预取，浏览器验收在 FE1 首次使用时准备并记录。
- 未推送，远端 CI 未执行；FE0 不改变任何业务路由、接口或页面行为。
