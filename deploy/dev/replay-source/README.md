# 临床 HTTP 回放源

这是无 PHI 的本地验收 fixture，用于在院方未提供 LIS/EMR/手术系统端点时验证 HTTP 连接器合同、租户白名单、`last_success_time` 水位注入和批次审计。它不是生产适配器，也不会被生产 Compose 启动。

启动：

```bash
python3 deploy/dev/replay-source/server.py --port 18084
curl 'http://127.0.0.1:18084/api/lab/results?since=2026-08-11T00:00:00Z&until=2026-08-11T09:00:00Z'
```

预期响应包含 `sourceSystem`、`schemaVersion`、`batchId`、`watermarkStart`、`watermarkEnd` 和 `data`；数据只返回
`since <= update_time < until` 的窗口。在 SeaTunnel 任务配置中使用 `LIS_HTTP_TO_DORIS`，将 source URL 指向该路径；目标 Doris ODS 表应使用 `record_id` UNIQUE KEY。回放同一个 `batchId` 时，平台只承诺 at-least-once，目标表必须依靠 UNIQUE KEY/UPSERT 保持幂等。

医院交接时需要替换 URL、credentialRef、字段映射、增量字段、主键/唯一键和 ODS DDL，并保留一次脱敏样本响应作为验收证据。
