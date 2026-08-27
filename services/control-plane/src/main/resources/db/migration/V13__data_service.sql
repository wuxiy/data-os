-- 数据服务面（G13）：定义 / API Key / 调用审计三表。
-- 风格对齐 V1 基线：data_os schema、VARCHAR(36) UUID 主键、VARCHAR(128) tenant_id、TIMESTAMP、显式约束名。

CREATE TABLE IF NOT EXISTS data_os.data_service (
    id               VARCHAR(36)  PRIMARY KEY,
    tenant_id        VARCHAR(128) NOT NULL,
    code             VARCHAR(64)  NOT NULL,
    name             VARCHAR(128) NOT NULL,
    description      TEXT         NOT NULL,
    version_sn       VARCHAR(32)  NOT NULL,
    status           VARCHAR(16)  NOT NULL,
    sql_template     TEXT         NOT NULL,
    parameters_json  TEXT         NOT NULL,
    columns_json     TEXT         NOT NULL,
    max_rows         INT          NOT NULL,
    timeout_seconds  INT          NOT NULL,
    owner            VARCHAR(64)  NOT NULL,
    created_at       TIMESTAMP    NOT NULL,
    updated_at       TIMESTAMP    NOT NULL,
    CONSTRAINT uq_data_service_code UNIQUE (tenant_id, code)
);

CREATE TABLE IF NOT EXISTS data_os.data_service_key (
    id                    VARCHAR(36)  PRIMARY KEY,
    service_id            VARCHAR(36)  NOT NULL,
    tenant_id             VARCHAR(128) NOT NULL,
    caller_name           VARCHAR(128) NOT NULL,
    key_hash              CHAR(64)     NOT NULL,
    key_prefix            VARCHAR(24)  NOT NULL,
    allowed_hospitals_json TEXT        NOT NULL,
    daily_quota           INT          NOT NULL,
    status                VARCHAR(16)  NOT NULL,
    created_at            TIMESTAMP    NOT NULL,
    last_used_at          TIMESTAMP,
    revoked_at            TIMESTAMP,
    CONSTRAINT uq_data_service_key_hash UNIQUE (key_hash),
    CONSTRAINT fk_data_service_key_service FOREIGN KEY (service_id) REFERENCES data_os.data_service(id)
);

CREATE TABLE IF NOT EXISTS data_os.data_service_call (
    id               VARCHAR(36)  PRIMARY KEY,
    service_id       VARCHAR(36)  NOT NULL,
    tenant_id        VARCHAR(128) NOT NULL,
    key_id           VARCHAR(36),
    idempotency_key  VARCHAR(64)  NOT NULL,
    parameters_json  TEXT,
    row_count        INT          NOT NULL,
    truncated        BOOLEAN      NOT NULL DEFAULT FALSE,
    elapsed_ms       INT          NOT NULL,
    status_code      INT          NOT NULL,
    called_at        TIMESTAMP    NOT NULL,
    CONSTRAINT uq_data_service_call_idem UNIQUE (idempotency_key),
    CONSTRAINT fk_data_service_call_service FOREIGN KEY (service_id) REFERENCES data_os.data_service(id)
);

CREATE INDEX IF NOT EXISTS idx_data_service_call_service_time
    ON data_os.data_service_call (service_id, called_at DESC);
