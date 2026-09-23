-- 受控问数治理面（G27）：问题生命周期事件留痕。对齐 delivery_event 口径——
-- 管理动作（创建/编辑/发布/停用/删除）逐条落事件，问题行只保留当前状态；
-- 事件按租户+问题过滤，删除问题时事件保留（按 code 仍可追溯）。
CREATE TABLE IF NOT EXISTS data_os.assistant_question_event (
    id            VARCHAR(36)  PRIMARY KEY,
    tenant_id     VARCHAR(128) NOT NULL,
    question_id   VARCHAR(36)  NOT NULL,
    question_code VARCHAR(64)  NOT NULL,
    action        VARCHAR(16)  NOT NULL,
    actor         VARCHAR(128) NOT NULL DEFAULT '',
    detail_json   TEXT         NOT NULL DEFAULT '{}',
    created_at    TIMESTAMP    NOT NULL,
    CONSTRAINT ck_assistant_question_event_action
        CHECK (action IN ('CREATED', 'UPDATED', 'PUBLISHED', 'DEPRECATED', 'DELETED'))
);

CREATE INDEX IF NOT EXISTS idx_assistant_question_event_tenant
    ON data_os.assistant_question_event (tenant_id, question_code, created_at DESC);
