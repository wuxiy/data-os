-- G11 认证审批：CERTIFIED 只能经人工审批（架构 §27 Automatic Check + Human Approval）。
-- 风格对齐 V1/V10 基线。

CREATE TABLE IF NOT EXISTS data_os.ai_certification_request (
    id                VARCHAR(36)  PRIMARY KEY,
    product_id        VARCHAR(36)  NOT NULL,
    version_sn        VARCHAR(32)  NOT NULL,
    readiness_overall DOUBLE       NOT NULL,
    certification     VARCHAR(24)  NOT NULL,
    decision          VARCHAR(16)  NOT NULL DEFAULT 'PENDING',
    decision_note     VARCHAR(500),
    requested_by      VARCHAR(128) NOT NULL,
    decided_by        VARCHAR(128),
    decided_at        TIMESTAMP,
    created_at        TIMESTAMP    NOT NULL,
    CONSTRAINT fk_ai_certification_request_product FOREIGN KEY (product_id)
        REFERENCES data_os.ai_data_product(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_cert_request_product
    ON data_os.ai_certification_request (product_id, created_at DESC);
