-- 标准映射（G23）：映射集、不可变版本（checksum 门控激活）、映射项（受控转换白名单）、
-- 聚合验证证据与审计事件。事实源=治理注册库；质量执行器只做只读聚合验证。
CREATE TABLE IF NOT EXISTS data_os.standard_mapping_set (
    id                VARCHAR(36)  PRIMARY KEY,
    tenant_id         VARCHAR(128) NOT NULL,
    code              VARCHAR(64)  NOT NULL,
    name              VARCHAR(128) NOT NULL,
    source_asset      VARCHAR(256) NOT NULL,
    dataset           VARCHAR(128) NOT NULL,
    standard_id       VARCHAR(36)  NOT NULL,
    active_version_id VARCHAR(36)  NULL,
    created_by        VARCHAR(128) NOT NULL DEFAULT '',
    created_at        TIMESTAMP    NOT NULL,
    updated_at        TIMESTAMP    NOT NULL,
    CONSTRAINT uq_standard_mapping_set_code UNIQUE (tenant_id, code),
    CONSTRAINT fk_standard_mapping_set_standard FOREIGN KEY (standard_id)
        REFERENCES data_os.data_standard (id)
);

-- 版本不可变：只有 DRAFT 可改；IN_REVIEW→ACTIVE 必须有同 checksum 的 PASS 验证证据；
-- RETIRED→ACTIVE 仅经回退端点。checksum 是激活门控的比对基准。
CREATE TABLE IF NOT EXISTS data_os.standard_mapping_version (
    id             VARCHAR(36)  PRIMARY KEY,
    mapping_set_id VARCHAR(36)  NOT NULL,
    tenant_id      VARCHAR(128) NOT NULL,
    version_no     INT          NOT NULL,
    status         VARCHAR(16)  NOT NULL,
    checksum       VARCHAR(64)  NOT NULL,
    created_by     VARCHAR(128) NOT NULL DEFAULT '',
    submitted_at   TIMESTAMP,
    activated_at   TIMESTAMP,
    retired_at     TIMESTAMP,
    created_at     TIMESTAMP    NOT NULL,
    updated_at     TIMESTAMP    NOT NULL,
    CONSTRAINT fk_standard_mapping_version_set FOREIGN KEY (mapping_set_id)
        REFERENCES data_os.standard_mapping_set (id),
    CONSTRAINT uq_standard_mapping_version_no UNIQUE (mapping_set_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_standard_mapping_version_set
    ON data_os.standard_mapping_version (mapping_set_id, version_no DESC);

-- 映射项：源字段（安全标识符，质量执行器侧二次校验）、目标数据元、
-- 受控转换 COPY/TRIM/UPPER/DATE_FORMAT/VALUE_MAP（禁止任意 SQL/脚本/表达式）、
-- 人工结论。VALUE_MAP 的 param 是 {源值: 标准值域代码} JSON。
CREATE TABLE IF NOT EXISTS data_os.standard_mapping_item (
    id                 VARCHAR(36)  PRIMARY KEY,
    version_id         VARCHAR(36)  NOT NULL,
    source_column      VARCHAR(128) NOT NULL,
    target_element_code VARCHAR(64) NOT NULL,
    transform          VARCHAR(16)  NOT NULL,
    transform_param    TEXT         NOT NULL DEFAULT '',
    conclusion         VARCHAR(16)  NOT NULL DEFAULT 'CONFIRMED',
    note               VARCHAR(512) NOT NULL DEFAULT '',
    sort_order         INT          NOT NULL DEFAULT 0,
    created_at         TIMESTAMP    NOT NULL,
    CONSTRAINT fk_standard_mapping_item_version FOREIGN KEY (version_id)
        REFERENCES data_os.standard_mapping_version (id),
    CONSTRAINT uq_standard_mapping_item_column UNIQUE (version_id, source_column)
);

-- 验证证据：记录验证时的版本内容 checksum（激活门控比对）与聚合结果
-- （类型兼容/空值率/覆盖率/未映射 TOP N/数据时间）；不含任何行级数据。
CREATE TABLE IF NOT EXISTS data_os.standard_mapping_validation (
    id          VARCHAR(36)  PRIMARY KEY,
    version_id  VARCHAR(36)  NOT NULL,
    tenant_id   VARCHAR(128) NOT NULL,
    checksum    VARCHAR(64)  NOT NULL,
    status      VARCHAR(8)   NOT NULL,
    result_json TEXT         NOT NULL,
    data_time   VARCHAR(64)  NOT NULL DEFAULT '',
    created_by  VARCHAR(128) NOT NULL DEFAULT '',
    created_at  TIMESTAMP    NOT NULL,
    CONSTRAINT fk_standard_mapping_validation_version FOREIGN KEY (version_id)
        REFERENCES data_os.standard_mapping_version (id)
);

CREATE INDEX IF NOT EXISTS idx_standard_mapping_validation_version
    ON data_os.standard_mapping_validation (version_id, created_at DESC);

CREATE TABLE IF NOT EXISTS data_os.standard_mapping_event (
    id             VARCHAR(36)  PRIMARY KEY,
    mapping_set_id VARCHAR(36)  NOT NULL,
    version_id     VARCHAR(36)  NOT NULL DEFAULT '',
    tenant_id      VARCHAR(128) NOT NULL,
    event_type     VARCHAR(24)  NOT NULL,
    actor          VARCHAR(128) NOT NULL DEFAULT '',
    detail         VARCHAR(1024) NOT NULL DEFAULT '',
    created_at     TIMESTAMP    NOT NULL,
    CONSTRAINT fk_standard_mapping_event_set FOREIGN KEY (mapping_set_id)
        REFERENCES data_os.standard_mapping_set (id)
);

CREATE INDEX IF NOT EXISTS idx_standard_mapping_event_set
    ON data_os.standard_mapping_event (mapping_set_id, created_at DESC);
