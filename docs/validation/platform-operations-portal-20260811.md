# 技术域组件门户集成验收记录（2026-08-11）

## 交付内容

- 门户新增 `/operations`“平台运维舱”，仅在技术角色上下文显示左侧菜单。
- 控制面新增 `GET /api/v1/platform-operations`，服务端探测 SeaTunnel `/overview`、DolphinScheduler `/actuator/health` 和 RustFS `/health`。
- 门户只接收健康状态、非敏感摘要指标和预先配置的浏览器入口 URL；不返回内部探针地址、调度器 Token、对象存储密钥、连接串或业务数据。
- OIDC 强制模式下，`data-engineer`、`platform-operator`、`platform-admin` 允许访问；其他身份得到 403。开发 `AUTH_MODE=DISABLED` 仅用于联调。

## 配置

控制面环境变量：

```dotenv
SEATUNNEL_BASE_URL=http://seatunnel-master:8080
DATAOS_DOLPHINSCHEDULER_UI_URL=http://<开发机>:18083/dolphinscheduler/ui/
DATAOS_RUSTFS_ENDPOINT=http://rustfs:9000
DATAOS_RUSTFS_CONSOLE_URL=http://<开发机>:19001/rustfs/console/
```

其中 `*_UI_URL` 是浏览器入口，`DATAOS_RUSTFS_ENDPOINT` 是控制面在平台网络内使用的服务端探针地址。
生产环境不要将内部服务地址直接填写为浏览器入口；应填院内反向代理或技术网段可达地址，并由网关
继续执行 OIDC、网络分区和审计策略。

## 验证清单

| 检查项 | 预期 |
| --- | --- |
| 前端构建 | `npm run build` 通过，包含 `/operations` 深链 |
| 后端测试 | OIDC viewer 访问平台接口返回 403；技术角色返回 200 |
| 敏感信息 | 平台接口响应不包含 token、secret、password 或内部凭据字段 |
| 业务账号体验 | 业务角色不显示“平台运维”，手工访问路由显示技术域拒绝页 |
| 组件状态 | SeaTunnel、DolphinScheduler、RustFS 分别展示 UP/DOWN/未配置及最后检查时间 |
| 外链 | DolphinScheduler UI 使用 `/dolphinscheduler/ui/`，RustFS 使用 `/rustfs/console/`，均新标签页打开 |

## 边界

本页面是技术运维入口，不把 DolphinScheduler、RustFS 的管理能力复制到业务门户，也不把组件 UI
暴露给甲方人员。真正的组件管理权限仍由各组件自身账号、院内网络和 OIDC/SSO 策略控制。
