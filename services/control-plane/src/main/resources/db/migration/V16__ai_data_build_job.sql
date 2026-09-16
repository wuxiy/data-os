-- AI Data 构建任务态（G20-1，backlog AI-4）：build API 异步化的任务表。
-- 投递互斥 = 版本行 build_status 的 CAS（活动任务期间版本为 RUNNING）+
-- 产品级活动任务检查；先例对齐 V14（data-api 异步导出的任务状态机）。
CREATE TABLE IF NOT EXISTS data_os.ai_data_build_job (
    id          VARCHAR(36)  PRIMARY KEY,
    product_id  VARCHAR(36)  NOT NULL,
    tenant_id   VARCHAR(128) NOT NULL,
    version_sn  VARCHAR(32)  NOT NULL,
    recipe_ref  VARCHAR(96),
    status      VARCHAR(16)  NOT NULL,
    result_json TEXT,
    error       VARCHAR(512),
    created_by  VARCHAR(128),
    created_at  TIMESTAMP    NOT NULL,
    started_at  TIMESTAMP,
    finished_at TIMESTAMP,
    CONSTRAINT fk_ai_data_build_job_product FOREIGN KEY (product_id) REFERENCES data_os.ai_data_product(id)
);

CREATE INDEX IF NOT EXISTS idx_ai_data_build_job_product
    ON data_os.ai_data_build_job (product_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_data_build_job_status
    ON data_os.ai_data_build_job (status);
