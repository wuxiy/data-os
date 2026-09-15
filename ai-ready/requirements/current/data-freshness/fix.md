# data_freshness remediation

## 口径与阈值演进记录

- G9 立项：绑定边缘模拟链路表 `ep_mz_cfzb_edge`（G5 MiNiFi 前置机链路，当时活跃），
  阈值 pass 48h / warn 168h；
- 2026-09-15（G17/AI-1）：边缘链路已收档（末次更新 2026-08-20），检查重绑**活跃采集
  链路**（G16b SeaTunnel 直连 DM）的落库表 `ep_mz_cfzb` UPDATE_TIME 水位；阈值改为
  **dev 环境口径** pass 720h（30 天）/ warn 2160h（90 天）——dev 测试源（EP 域 DM
  测试库）活动窗口截至 2026-09-03，无持续新增流量，30 天口径表示「近一月内源有活动」。
  生产接入持续流量后另立生产 SLA（如 48h），在 requirement.yaml 版本化变更。

## 修复路径

检查 SeaTunnel 同步作业（脚本触发制，P2 待编排进状态机）与源端活动状态后重跑同步。
