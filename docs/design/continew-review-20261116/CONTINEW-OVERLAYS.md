# 弹窗与侧栏详情的使用约定（审核建议）

核对参考项目 [continew-ui-next](https://github.com/ppxb/continew-ui-next) 的提交 **`24eb89cf7253abf6b6c774e0bffdbf869667d0ff`**（2026-11-16，`feat(shell): add widget toggles and centralise global shortcuts`）。本轮只阅读公开源码，未在线实测；以下区分参考已有行为与 data-os 的自主建议。2026-11-16 原型与容器原则已通过审核；正式迁移范围以待审核的实施计划为准。

## 参考项目实际分工

当前文件树中未见独立的 `EntityDialog`、`ResponsiveDialog` 复用件。实际组合是业务级 `EntityDrawer`、`DeleteConfirmDialog`，以及基于 Base UI 的 `Dialog`、`AlertDialog`、`Drawer` 基础件；不能把参考项目概括为“所有操作都进抽屉”。

| 已读业务调用 | 实际容器与内容 |
| --- | --- |
| [用户完整编辑](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/routes/%28main%29/%28app%29/system/user/-components/user-form-drawer.tsx) | `EntityDrawer`，用户信息、部门、角色、状态等完整表单；正文滚动，底部取消/保存。 |
| [用户重置密码](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/routes/%28main%29/%28app%29/system/user/-components/user-reset-password-dialog.tsx) | 居中 `Dialog`，新密码与确认密码两个字段。 |
| [给用户分配角色](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/routes/%28main%29/%28app%29/system/user/-components/user-assign-roles-dialog.tsx) | `Dialog`，读取当前角色后呈现一个角色选择器；包含骨架、失败与取消状态。 |
| [文件重命名/建文件夹](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/routes/%28main%29/%28app%29/system/file/-components/file-name-dialog.tsx) | `Dialog`，单个名称字段，输入自动聚焦。 |
| [用户详情](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/routes/%28main%29/%28app%29/system/user/-components/user-detail-drawer.tsx) | 只读 `EntityDrawer`，信息网格与查询状态；关闭动画期间保留上次详情。 |
| [角色功能权限树](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/routes/%28main%29/%28app%29/system/role/-components/role-permission-drawer.tsx) | 36rem（576px）`EntityDrawer`，树检索、父子联动、勾选和保存，仍围绕当前角色完成一次授权。 |
| [任务配置](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/routes/%28main%29/%28app%29/schedule/job/-components/job-form-drawer.tsx) | 40rem（640px）`EntityDrawer`，基础、调度、任务、高级四组配置；**参考项目仍使用抽屉**。 |
| [删除用户](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/routes/%28main%29/%28app%29/system/user/-components/user-delete-dialog.tsx) | 复用 `DeleteConfirmDialog`，底层为 `AlertDialog`，明确对象及不可恢复后果。 |
| [立即执行任务](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/routes/%28main%29/%28app%29/schedule/job/-components/job-trigger-dialog.tsx) / [恢复默认](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/routes/%28main%29/%28app%29/system/config/-components/config-reset-dialog.tsx) | `AlertDialog`；确认用途也覆盖有明显影响的一次性动作，并非仅删除。 |

上述调用可归纳为：集中、短暂的输入用 Dialog；需要保留对象清单上下文的详情与编辑用 Drawer；需要明确选择的一次性动作用 AlertDialog。这是从调用归纳的设计规律，源码没有按字段数自动选择容器的规则。

## 关闭、忙碌与焦点

- **抽屉关闭**：[EntityDrawer](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/components/entity-drawer.tsx) 统一检查 `closeDisabled` 与 `canClose()`。前者同时禁用右上关闭按钮；后者允许业务在保存中拒绝关闭。用户/任务表单使用 `canClose`，角色权限使用 `closeDisabled`；底部取消由各业务自行禁用。
- **异步确认**：[DeleteConfirmDialog](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/components/delete-confirm-dialog.tsx) 在请求中禁止关闭、禁用取消与确认，显示进度；成功后刷新相关查询并关闭，失败保留弹窗。其 [AlertDialogAction](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/components/ui/alert-dialog.tsx) 是普通按钮，点击本身不会自动关闭。
- **普通表单**：重置密码、角色分配、改名在提交中拒绝关闭，禁用取消与提交；重置密码同时禁用输入。不能据此声称所有复杂表单字段在请求中均已禁用。
- **并非所有忙碌路径一致**：恢复默认仅在 `ConfigResetDialog` 内禁用按钮；[安全配置调用](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/routes/%28main%29/%28app%29/system/config/-components/config-security.tsx) 直接传递状态 setter，未增加与删除确认相同的关闭守卫。不应把按钮禁用等同于全部关闭路径已封锁。
- **焦点**：[Dialog](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/components/ui/dialog.tsx) 与 [Drawer](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/components/ui/drawer.tsx) 委托 Base UI 管理模态与焦点，未自定义 `initialFocus`/`finalFocus`。Base UI 的[默认约定](https://base-ui.com/react/components/dialog)包括模态焦点圈定、首次可聚焦控件及关闭后归还触发器或先前焦点；这属于库契约，未在参考站实测。用户、角色、任务及密码表单还会在校验后手动聚焦首个 `aria-invalid` 控件，改名输入显式 `autoFocus`。
- **未见 dirty 守卫**：本次已读业务调用中未见 `isDirty`、离开确认或“放弃未保存修改”流程；已有关闭守卫主要针对请求进行中。[useFillFormOnce](https://github.com/ppxb/continew-ui-next/blob/24eb89cf7253abf6b6c774e0bffdbf869667d0ff/src/hooks/use-fill-form-once.ts) 负责打开/切换对象时填值与重置，不是未保存修改保护。

## data-os 的借鉴与自主增强

| 建议容器 | 适用场景与边界 |
| --- | --- |
| 短表单 `Dialog` | 改名、指派负责人、少量集中输入；操作结束后返回原工作面。借鉴参考已有分工。 |
| 对象详情 `Sheet` | 从问题、任务或资产清单打开证据与对象详情，保留当前筛选、选择和滚动位置。借鉴参考侧边详情模式；data-os 建议以 Sheet 实现，不声称参考使用同名业务组件。 |
| 不可逆/高影响 `AlertDialog` | 删除、永久关闭、覆盖或恢复默认等明确确认，展示对象、后果及取消；确认后等待真实结果。 |
| 长任务独立页 | 复杂采集配置、多步骤、脚本/JSON、预览和长时间编辑，提供足够工作宽度及可恢复入口。**这是 data-os 的建议，参考任务配置本身仍在 Drawer 中。** |

容器按工作上下文、所需宽度、交互深度与编辑时长判断，不能只数输入字段。角色权限树虽有复杂勾选，但单一对象、单一授权目的且需要保留角色清单上下文，可继续使用足够宽的 Sheet/Drawer；跨对象比较、多步骤编排或大面积编辑再进入独立页。

**自主增强**：为可编辑 Dialog、Sheet 与独立页统一增加 dirty 保护；取消、关闭按钮、Esc、遮罩和路由离开走同一判断。存在未保存修改时先确认放弃，继续编辑时保留字段与焦点。提交中拒绝重复提交及非预期关闭；焦点进入、圈定、错误定位与归还均需在 data-os 原型和正式实现中验证。这些是本项目建议，不能记作参考项目已经全部具备的能力。
