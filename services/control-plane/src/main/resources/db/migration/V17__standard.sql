-- 数据标准中心（G22）：标准集合、不可变版本、数据元、值域代码与审计事件。
-- 事实源 = 治理注册库；OpenMetadata 只接收发布后的术语投影（失败置 SYNC_PENDING
-- 人工重试，不反向成为流程状态源）。
CREATE TABLE IF NOT EXISTS data_os.data_standard (
    id          VARCHAR(36)  PRIMARY KEY,
    tenant_id   VARCHAR(128) NOT NULL,
    code        VARCHAR(64)  NOT NULL,
    name        VARCHAR(128) NOT NULL,
    description VARCHAR(512) NOT NULL DEFAULT '',
    owner       VARCHAR(128) NOT NULL DEFAULT '',
    created_by  VARCHAR(128) NOT NULL DEFAULT '',
    created_at  TIMESTAMP    NOT NULL,
    updated_at  TIMESTAMP    NOT NULL,
    CONSTRAINT uq_data_standard_tenant_code UNIQUE (tenant_id, code)
);

-- 版本不可变：只有 DRAFT 可改内容；PUBLISHED 只能被新版本取代（自动置 DEPRECATED）。
-- 版本号服务端单调递增（导入携带版本号时拒绝倒退）。
CREATE TABLE IF NOT EXISTS data_os.data_standard_version (
    id           VARCHAR(36)  PRIMARY KEY,
    standard_id  VARCHAR(36)  NOT NULL,
    tenant_id    VARCHAR(128) NOT NULL,
    version_no   INT          NOT NULL,
    status       VARCHAR(16)  NOT NULL,
    created_by   VARCHAR(128) NOT NULL DEFAULT '',
    submitted_at TIMESTAMP,
    published_at TIMESTAMP,
    deprecated_at TIMESTAMP,
    sync_status  VARCHAR(16)  NOT NULL DEFAULT 'SYNC_PENDING',
    synced_at    TIMESTAMP,
    created_at   TIMESTAMP    NOT NULL,
    updated_at   TIMESTAMP    NOT NULL,
    CONSTRAINT fk_data_standard_version_standard FOREIGN KEY (standard_id)
        REFERENCES data_os.data_standard (id),
    CONSTRAINT uq_data_standard_version_no UNIQUE (standard_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_data_standard_version_std
    ON data_os.data_standard_version (standard_id, version_no DESC);

-- 数据元：类型白名单 STRING/INTEGER/DECIMAL/DATE/DATETIME/BOOLEAN/CODE；
-- CODE 型必须有非空值域；asset_ref 记录受影响资产引用（影响范围的数据源）。
CREATE TABLE IF NOT EXISTS data_os.data_standard_element (
    id          VARCHAR(36)   PRIMARY KEY,
    version_id  VARCHAR(36)   NOT NULL,
    code        VARCHAR(64)   NOT NULL,
    name        VARCHAR(128)  NOT NULL,
    data_type   VARCHAR(16)   NOT NULL,
    required    BOOLEAN       NOT NULL DEFAULT FALSE,
    definition  VARCHAR(1024) NOT NULL DEFAULT '',
    sensitivity VARCHAR(16)   NOT NULL DEFAULT 'NORMAL',
    asset_ref   VARCHAR(256)  NOT NULL DEFAULT '',
    sort_order  INT           NOT NULL DEFAULT 0,
    created_at  TIMESTAMP     NOT NULL,
    CONSTRAINT fk_data_standard_element_version FOREIGN KEY (version_id)
        REFERENCES data_os.data_standard_version (id),
    CONSTRAINT uq_data_standard_element_code UNIQUE (version_id, code)
);

CREATE TABLE IF NOT EXISTS data_os.data_standard_value (
    id           VARCHAR(36)  PRIMARY KEY,
    element_id   VARCHAR(36)  NOT NULL,
    code         VARCHAR(64)  NOT NULL,
    display_name VARCHAR(128) NOT NULL,
    valid_from   VARCHAR(32)  NOT NULL DEFAULT '',
    valid_to     VARCHAR(32)  NOT NULL DEFAULT '',
    sort_order   INT          NOT NULL DEFAULT 0,
    created_at   TIMESTAMP    NOT NULL,
    CONSTRAINT fk_data_standard_value_element FOREIGN KEY (element_id)
        REFERENCES data_os.data_standard_element (id),
    CONSTRAINT uq_data_standard_value_code UNIQUE (element_id, code)
);

CREATE TABLE IF NOT EXISTS data_os.data_standard_event (
    id          VARCHAR(36)  PRIMARY KEY,
    standard_id VARCHAR(36)  NOT NULL,
    version_id  VARCHAR(36)  NOT NULL DEFAULT '',
    tenant_id   VARCHAR(128) NOT NULL,
    event_type  VARCHAR(24)  NOT NULL,
    actor       VARCHAR(128) NOT NULL DEFAULT '',
    detail      VARCHAR(1024) NOT NULL DEFAULT '',
    created_at  TIMESTAMP    NOT NULL,
    CONSTRAINT fk_data_standard_event_standard FOREIGN KEY (standard_id)
        REFERENCES data_os.data_standard (id)
);

CREATE INDEX IF NOT EXISTS idx_data_standard_event_std
    ON data_os.data_standard_event (standard_id, created_at DESC);
