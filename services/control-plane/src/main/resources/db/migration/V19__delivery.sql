-- 交付中心（G25）：交付项目、交付项（四类引用）、不可变验收快照（checksum +
-- 幂等键唯一）与审计事件。事实源=各域既有状态（数据服务/合同事件、AI 产品
-- 版本与认证、OM 资产、Superset 仪表盘、质量运行结论）；交付域不自建副本状态机。

CREATE TABLE IF NOT EXISTS data_os.delivery_project (
    id                   VARCHAR(36)  PRIMARY KEY,
    tenant_id            VARCHAR(128) NOT NULL,
    code                 VARCHAR(64)  NOT NULL,
    name                 VARCHAR(128) NOT NULL,
    scope                VARCHAR(512) NOT NULL DEFAULT '',
    owner                VARCHAR(128) NOT NULL DEFAULT '',
    target_date          DATE         NULL,
    status               VARCHAR(24)  NOT NULL,
    accepted_snapshot_id VARCHAR(36)  NULL,
    created_by           VARCHAR(128) NOT NULL DEFAULT '',
    created_at           TIMESTAMP    NOT NULL,
    updated_at           TIMESTAMP    NOT NULL,
    CONSTRAINT uq_delivery_project_code UNIQUE (tenant_id, code)
);

-- 交付项：引用类型 + 引用标识（ASSET/AI_DATA_PRODUCT 用 UUID 或 OM 四段 fqn，
-- DASHBOARD 用 Superset id，DATA_SERVICE 用控制面服务 id）。存在性与可交付性
-- 检查在提交（READY 前）逐项执行，引用下线后提交即被阻断。
CREATE TABLE IF NOT EXISTS data_os.delivery_item (
    id         VARCHAR(36)  PRIMARY KEY,
    project_id VARCHAR(36)  NOT NULL,
    tenant_id  VARCHAR(128) NOT NULL,
    ref_type   VARCHAR(24)  NOT NULL,
    ref_id     VARCHAR(256) NOT NULL,
    note       VARCHAR(512) NOT NULL DEFAULT '',
    created_by VARCHAR(128) NOT NULL DEFAULT '',
    created_at TIMESTAMP    NOT NULL,
    CONSTRAINT fk_delivery_item_project FOREIGN KEY (project_id)
        REFERENCES data_os.delivery_project (id),
    CONSTRAINT uq_delivery_item_ref UNIQUE (project_id, ref_type, ref_id)
);

-- 不可变验收快照：manifest_json 是白名单证据全文（项目、逐项证据、质量结论、
-- 认证/合同状态、运行摘要、事件清单），checksum = manifest_json 的 SHA-256。
-- 幂等键租户内全局唯一：同一幂等键只生成一份快照。
CREATE TABLE IF NOT EXISTS data_os.delivery_snapshot (
    id              VARCHAR(36)  PRIMARY KEY,
    project_id      VARCHAR(36)  NOT NULL,
    tenant_id       VARCHAR(128) NOT NULL,
    checksum        VARCHAR(64)  NOT NULL,
    manifest_json   TEXT         NOT NULL,
    idempotency_key VARCHAR(128) NOT NULL,
    created_by      VARCHAR(128) NOT NULL DEFAULT '',
    created_at      TIMESTAMP    NOT NULL,
    CONSTRAINT fk_delivery_snapshot_project FOREIGN KEY (project_id)
        REFERENCES data_os.delivery_project (id),
    CONSTRAINT uq_delivery_snapshot_idem UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_delivery_snapshot_project
    ON data_os.delivery_snapshot (project_id, created_at DESC);

-- 状态/验收/归档事件；幂等键非空时租户内唯一（状态动作重放按事件判定），
-- 非幂等事件（创建、加项、被阻断尝试）键为 NULL 可重复出现。
CREATE TABLE IF NOT EXISTS data_os.delivery_event (
    id              VARCHAR(36)  PRIMARY KEY,
    project_id      VARCHAR(36)  NOT NULL,
    tenant_id       VARCHAR(128) NOT NULL,
    event_type      VARCHAR(24)  NOT NULL,
    actor           VARCHAR(128) NOT NULL DEFAULT '',
    idempotency_key VARCHAR(128) NULL,
    detail          TEXT         NOT NULL DEFAULT '',
    created_at      TIMESTAMP    NOT NULL,
    CONSTRAINT fk_delivery_event_project FOREIGN KEY (project_id)
        REFERENCES data_os.delivery_project (id),
    CONSTRAINT uq_delivery_event_idem UNIQUE (tenant_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_delivery_event_project
    ON data_os.delivery_event (project_id, created_at DESC);
