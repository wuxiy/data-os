-- 数据服务导出面（P7，H3）：大结果集异步导出的任务表与调用审计 kind 列。
-- 风格对齐 V13：data_os schema、VARCHAR(36) UUID 主键、显式约束名。

CREATE TABLE IF NOT EXISTS data_os.data_service_export (
    id               VARCHAR(36)  PRIMARY KEY,
    service_id       VARCHAR(36)  NOT NULL,
    tenant_id        VARCHAR(128) NOT NULL,
    key_hash         CHAR(64)     NOT NULL,
    status           VARCHAR(16)  NOT NULL,
    parameters_json  TEXT,
    row_count        BIGINT       NOT NULL DEFAULT 0,
    file_bytes       BIGINT,
    artifact_uri     TEXT,
    error            VARCHAR(512),
    created_at       TIMESTAMP    NOT NULL,
    updated_at       TIMESTAMP    NOT NULL,
    expires_at       TIMESTAMP,
    CONSTRAINT fk_data_service_export_service FOREIGN KEY (service_id) REFERENCES data_os.data_service(id)
);

CREATE INDEX IF NOT EXISTS idx_data_service_export_time
    ON data_os.data_service_export (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_data_service_export_status
    ON data_os.data_service_export (status);

-- 调用审计补 kind（query/export）：导出完成同样计入配额窗口，审计可区分形态。
ALTER TABLE data_os.data_service_call
    ADD COLUMN IF NOT EXISTS kind VARCHAR(16) NOT NULL DEFAULT 'query';
