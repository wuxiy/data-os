# dev 环境部署记录 · 2026-11-17（main 新栈全量上线）

> 提交基线：`48a341d`（main）｜镜像 tag：`0.3.0-main-20261117`｜执行：FE7 §7 操作单
> 回滚目录：`/root/data-os-dev-rollback-20261117-main`（portal-dist、.env、compose、6 份 inspect、旧 hash 清单）

## 变更内容

| 对象 | 旧 | 新 |
| --- | --- | --- |
| control-plane | 0.2.0-govlive-20260808（Boot 3.5.14） | **0.3.0-main-20261117（Boot 4.0.9 / Jackson 3.1.7+2.21.7 / Flyway 11.20.3）** |
| mpi-service | 0.2.1-uxfix-20261110（Boot 3.4.5） | **同 tag（Boot 4.0.9，maxRows -1 修复在内）** |
| quality-runner | 0.2.0-g2g-20261005 | 同 tag（apt 补丁层 + PyJWT 2.14.0） |
| data-api / ai-ready | 0.2.0-g26 / 0.2.0-g23 | 同 tag（PyJWT 2.14.0） |
| portal-dist | antd v3 门户 | **新栈门户（antd 移除、27 路由懒加载），47 文件，`COPYFILE_DISABLE` 防 AppleDouble** |

`.env` 六处镜像 tag 全量切换（含重复的 `DATAOS_CONTROL_PLANE_IMAGE` 行）；`.env` 权限保持 0600。

## 验证证据

| 检查 | 结果 |
| --- | --- |
| 容器健康 | 15 服务全部 Up/healthy（Boot 4 下 Flyway 验证 28+1 迁移通过、无需新迁移） |
| 三处 hash | 宿主 = 容器内 = HTTP `6a5fec7eb876abd3…`（index.html），HTTP 引用 `index-B_moFEcv.js` |
| 路由矩阵 | 22 条路径（17 基线 + 新工作页 + 深链含 `?issue/?task/?asset`）全部 200 |
| system/status | mode DEMO（dev 种子口径）、qualityExecutor HTTP configured、operational READY |
| 真实读 API | sources 10、jobs 77、governance issues 4、MPI（2882 身份/352 黄金人/1126 待复核）、assets 36、data-services 10、deliveries 3、AI products 3、work-items 3、assistant questions 3、platform-operations READY |
| 真实写路径 | POST /sources 建源成功（PENDING）；启动一次真实采集 run → SeaTunnel 接受 → 3 秒后 `SUCCEEDED`（中心采集作业已完成）；run sync 回读一致 |
| 浏览器矩阵 | 本机 Chrome 对 `http://172.16.65.59:18081` 跑 6 路由 × 2 宽度全过，无 console 异常、无横向溢出 |
| 演示边界 | 生产 bundle 无 `VITE_DATAOS_DEMO_MODE` 字符串；横幅显示 dev 种子 DEMO 属 `.env` 的 `DATAOS_SEED_DEMO` 口径 |

## 冒烟残留与清理

- 冒烟创建的「QA 部署冒烟源」无 DELETE 端点（API 无删除合同，404），**留作可识别的部署痕迹**；采集冒烟 run 与幂等键 `dev-smoke-20261117-1` 留在运行历史（属正常业务事实，不回滚）。
- 远端磁盘 95%（4.4G free）：旧 tag 镜像保留即回滚面，未清理；18.9GB 可回收层数据已记录，是否清理由用户决定。

## 回滚口径

静态包+镜像 tag 均可回退：`.env` tag 改回旧值 + `cp -a rollback/portal-dist` + `docker compose up -d --force-recreate` 对应服务即可；已产生的采集/源登记等业务事实不随包回滚。生产发布不在本次授权内。
