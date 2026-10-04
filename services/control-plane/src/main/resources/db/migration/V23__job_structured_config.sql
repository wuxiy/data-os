-- G2G 批次 1 第二刀（采集任务深水区）：结构化任务意图与编译产物同存。
-- structured_json 保存表单形态（表/SQL、白名单、序列键、目标库表等），
-- config_json 仍是对接外部执行器的编译产物；JSON 直接覆盖时清空结构化意图。
ALTER TABLE data_os.ingestion_job_configs ADD COLUMN IF NOT EXISTS structured_json TEXT NULL;
