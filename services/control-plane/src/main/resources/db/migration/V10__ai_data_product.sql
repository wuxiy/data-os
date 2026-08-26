-- AI Data Product 一等域对象：产品 / 版本 / Recipe 登记。
-- 风格对齐 V1 基线：data_os schema、VARCHAR(36) UUID 主键、VARCHAR(128) tenant_id、TIMESTAMP、显式约束名。

CREATE TABLE IF NOT EXISTS data_os.ai_data_product (
    id              VARCHAR(36)  PRIMARY KEY,
    tenant_id       VARCHAR(128) NOT NULL,
    name            VARCHAR(128) NOT NULL,
    product_type    VARCHAR(32)  NOT NULL,
    owner           VARCHAR(64)  NOT NULL,
    workflow_type   VARCHAR(32)  NOT NULL,
    source_desc     TEXT         NOT NULL,
    current_version VARCHAR(32)  NOT NULL,
    lifecycle       VARCHAR(16)  NOT NULL,
    created_at      TIMESTAMP    NOT NULL,
    updated_at      TIMESTAMP    NOT NULL,
    CONSTRAINT uq_ai_data_product_name UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS data_os.ai_data_product_version (
    id             VARCHAR(36) PRIMARY KEY,
    product_id     VARCHAR(36) NOT NULL,
    version_sn     VARCHAR(32) NOT NULL,
    recipe_ref     VARCHAR(96),
    git_commit     VARCHAR(64),
    snapshot_at    DATE,
    readiness_json TEXT,
    build_status   VARCHAR(16) NOT NULL,
    created_at     TIMESTAMP   NOT NULL,
    CONSTRAINT uq_ai_data_product_version UNIQUE (product_id, version_sn),
    CONSTRAINT fk_ai_data_product_version_product FOREIGN KEY (product_id) REFERENCES data_os.ai_data_product(id)
);

CREATE TABLE IF NOT EXISTS data_os.ai_recipe_registry (
    id            VARCHAR(36) PRIMARY KEY,
    name          VARCHAR(96) NOT NULL,
    version       VARCHAR(32) NOT NULL,
    git_ref       VARCHAR(64) NOT NULL,
    registered_at TIMESTAMP   NOT NULL,
    CONSTRAINT uq_ai_recipe_registry UNIQUE (name, version)
);
