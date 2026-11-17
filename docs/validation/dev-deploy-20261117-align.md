# dev 环境部署记录 · 2026-11-17（设计对齐修复轮，静态包增量）

> 提交基线：`2b63cb8`（main）｜执行：FE7 §7 操作单（仅静态包替换，镜像无变更）
> 回滚目录：`/root/data-os-dev-rollback-20261117-align`（旧 portal-dist + sha256）

## 变更内容

| 对象 | 旧 | 新 |
| --- | --- | --- |
| portal-dist | `6a5fec7e…`（`7ecf3e8` 构建） | **`2e85cc03…`（`2b63cb8` 构建，47 文件，`index-BzJUgIRB.js`）** |
| 容器/镜像/`.env` | 不动 | 不动（本轮纯前端 + 文档） |

内容包括：路由级脏退出守卫（三编辑器）、侧栏 MPI 待复核徽标、采集勾选批量启用/暂停、资产目录 CSV 导出、数据源 Dialog 标题统一、placeholder 令牌对齐、采集第 4 摘要卡「最近 24h 失败」。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| 三处 hash | 宿主 = 容器内 = HTTP `2e85cc0372324f47d6624612410ff213f0a58f7e611f8688907899e4105e30b2`；HTTP 引用 `index-BzJUgIRB.js` 与本地构建一致 |
| 上传完整性 | 远端 47 文件（`COPYFILE_DISABLE=1` 流式 tar，无 AppleDouble） |
| 路由矩阵 | 22 条（17 基线 + 新工作页 + 深链含 `?issue=`）全部 200 |
| 真实 API | system/status DEMO（dev 种子口径）、MPI metrics 2882 身份/352 黄金人/1126 待复核、资产 40 表 88 列、sources/jobs/operations 正常 |
| 浏览器矩阵 | 本机 Chrome 对 `http://172.16.65.59:18081` 跑 6 路由 × 2 宽度 12 项全过 |
| 新特性实测（只读） | 守卫拦侧栏离开→继续编辑输入保留→取消露询问→放弃离开 ✅；侧栏徽标显示真实 1126 ✅；摘要卡「最近 24h 失败」✅；Dialog 标题「登记数据源」✅ |
| 写路径 | 本轮未写入（批量启用/暂停与导出仅在本地 mock 实测；采集表批量为逐个既有单任务合同，无新端点） |

## 环境观察（非回归）

- `/ingestion/new` 默认选中「合成 PostgreSQL JDBC」源（ac2c4e6f，连接指向已停止的 `127.0.0.1:5432`），`/api/v1/sources/{id}/catalogs` 返回 400（connection refused）；页面在「源库」处就地显示「库清单读取失败，请确认连接配置」，模板 JSON 形态不受影响。属 dev 遗留合成源的数据条件，代码未变更该路径；如需消除，把该源连接改到可用实例或将其停用（未执行）。

## 回滚口径

`cp -a /root/data-os-dev-rollback-20261117-align/portal-dist /root/data-os-dev-20260803/portal-dist && docker compose up -d --force-recreate portal`（仅 portal）。远端磁盘 95%（4.4G free），本轮未新增镜像层，暂存目录已清理。
