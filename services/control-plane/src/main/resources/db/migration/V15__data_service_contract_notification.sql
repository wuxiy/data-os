-- 数据服务合同通知面（P8 余项，H3 续）：订阅 / 合同事件 / 投递发件箱三表。
-- 风格对齐 V13/V14：data_os schema、VARCHAR(36) UUID 主键、显式约束名。
-- 投递状态机与 governance_notifications 同款（租约抢占 + 退避 + SKIPPED 留痕）。

-- 调用方订阅：绑定到 API Key（归属 = 创建 Key；webhook_secret 为外发签名素材，存明文）。
CREATE TABLE IF NOT EXISTS data_os.data_service_subscription (
    id               VARCHAR(36)  PRIMARY KEY,
    service_id       VARCHAR(36)  NOT NULL,
    tenant_id        VARCHAR(128) NOT NULL,
    key_id           VARCHAR(36)  NOT NULL,
    key_hash         CHAR(64)     NOT NULL,
    caller_name      VARCHAR(128) NOT NULL,
    webhook_url      VARCHAR(512) NOT NULL,
    webhook_secret   VARCHAR(128) NOT NULL,
    status           VARCHAR(16)  NOT NULL,
    created_at       TIMESTAMP    NOT NULL,
    revoked_at       TIMESTAMP,
    CONSTRAINT fk_data_service_subscription_service FOREIGN KEY (service_id) REFERENCES data_os.data_service(id),
    CONSTRAINT fk_data_service_subscription_key FOREIGN KEY (key_id) REFERENCES data_os.data_service_key(id)
);

CREATE INDEX IF NOT EXISTS idx_data_service_subscription_service
    ON data_os.data_service_subscription (service_id, status);

-- 合同事件：不可变事实（PUBLISHED / UPDATED / DEPRECATED + diff），双通道分发
-- （webhook 推送 + 调用方 API 轮询）。
CREATE TABLE IF NOT EXISTS data_os.data_service_contract_event (
    id               VARCHAR(36)  PRIMARY KEY,
    service_id       VARCHAR(36)  NOT NULL,
    tenant_id        VARCHAR(128) NOT NULL,
    service_code     VARCHAR(64)  NOT NULL,
    change_type      VARCHAR(16)  NOT NULL,
    from_version     VARCHAR(32)  NOT NULL,
    to_version       VARCHAR(32)  NOT NULL,
    diff_json        TEXT,
    created_at       TIMESTAMP    NOT NULL,
    CONSTRAINT fk_data_service_contract_event_service FOREIGN KEY (service_id) REFERENCES data_os.data_service(id)
);

CREATE INDEX IF NOT EXISTS idx_data_service_contract_event_service
    ON data_os.data_service_contract_event (service_id, created_at DESC);

-- 投递发件箱：每（事件 × 订阅）一条；idempotency_key 幂等，重放安全。
CREATE TABLE IF NOT EXISTS data_os.data_service_delivery (
    id               VARCHAR(36)  PRIMARY KEY,
    event_id         VARCHAR(36)  NOT NULL,
    subscription_id  VARCHAR(36)  NOT NULL,
    tenant_id        VARCHAR(128) NOT NULL,
    status           VARCHAR(16)  NOT NULL,
    attempt_count    INT          NOT NULL DEFAULT 0,
    last_error       VARCHAR(512),
    next_attempt_at  TIMESTAMP,
    locked_until     TIMESTAMP,
    locked_by        VARCHAR(64),
    delivered_at     TIMESTAMP,
    idempotency_key  VARCHAR(96)  NOT NULL,
    created_at       TIMESTAMP    NOT NULL,
    updated_at       TIMESTAMP    NOT NULL,
    CONSTRAINT uq_data_service_delivery_idem UNIQUE (idempotency_key),
    CONSTRAINT fk_data_service_delivery_event FOREIGN KEY (event_id) REFERENCES data_os.data_service_contract_event(id),
    CONSTRAINT fk_data_service_delivery_subscription FOREIGN KEY (subscription_id) REFERENCES data_os.data_service_subscription(id)
);

CREATE INDEX IF NOT EXISTS idx_data_service_delivery_due
    ON data_os.data_service_delivery (status, next_attempt_at);
