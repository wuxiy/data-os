-- G12 数据飞轮（Learning Plane）：评测失败样本反馈。处置只改状态，
-- 版本/语料变更均由人工触发（候选不自动上线）。

CREATE TABLE IF NOT EXISTS data_os.ai_evaluation_feedback (
    id            VARCHAR(36)  PRIMARY KEY,
    product_id    VARCHAR(36)  NOT NULL,
    version_sn    VARCHAR(32)  NOT NULL,
    question      VARCHAR(500) NOT NULL,
    metric        VARCHAR(48)  NOT NULL,
    outcome       VARCHAR(16)  NOT NULL,
    feedback_type VARCHAR(24)  NOT NULL,
    detail        VARCHAR(1000),
    status        VARCHAR(16)  NOT NULL DEFAULT 'CREATED',
    resolution    VARCHAR(500),
    created_by    VARCHAR(128) NOT NULL,
    resolved_by   VARCHAR(128),
    resolved_at   TIMESTAMP,
    created_at    TIMESTAMP    NOT NULL,
    CONSTRAINT fk_ai_evaluation_feedback_product FOREIGN KEY (product_id)
        REFERENCES data_os.ai_data_product(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_eval_feedback_product
    ON data_os.ai_evaluation_feedback (product_id, created_at DESC);
