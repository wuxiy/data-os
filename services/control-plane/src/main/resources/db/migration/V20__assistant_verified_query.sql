-- 受控智能问数（G26）：已验证问题注册表 + 问数审计。事实源=治理注册库；
-- 查询执行独占在 Data API（/internal/v1/verified-queries），控制面只做问题匹配、
-- 用户范围与回答编排；审计只存结局与计数，不存结果行（患者面零落库）。
CREATE TABLE IF NOT EXISTS data_os.assistant_verified_question (
    id               VARCHAR(36)  PRIMARY KEY,
    tenant_id        VARCHAR(128) NOT NULL,
    code             VARCHAR(64)  NOT NULL,
    question         VARCHAR(256) NOT NULL,
    aliases_json     TEXT         NOT NULL DEFAULT '[]',
    param_schema_json TEXT        NOT NULL DEFAULT '[]',
    service_code     VARCHAR(64)  NOT NULL,
    answer_template  VARCHAR(512) NOT NULL DEFAULT '',
    status           VARCHAR(16)  NOT NULL,
    created_by       VARCHAR(128) NOT NULL DEFAULT '',
    created_at       TIMESTAMP    NOT NULL,
    updated_at       TIMESTAMP    NOT NULL,
    CONSTRAINT uq_assistant_question_code UNIQUE (tenant_id, code)
);

CREATE INDEX IF NOT EXISTS idx_assistant_question_tenant
    ON data_os.assistant_verified_question (tenant_id, status);

-- 问数审计：一次提问一行（含拒答），反馈可追溯到具体行；outcome 取值
-- ANSWERED / REFUSED_NO_MATCH / REFUSED_PARAM_INVALID / REFUSED_FORBIDDEN /
-- REFUSED_SERVICE_OFFLINE / REFUSED_RATE_LIMITED / REFUSED_UNAVAILABLE / ERROR。
CREATE TABLE IF NOT EXISTS data_os.assistant_query_audit (
    id              VARCHAR(36)  PRIMARY KEY,
    tenant_id       VARCHAR(128) NOT NULL,
    institution_id  VARCHAR(128) NOT NULL DEFAULT '',
    user_id         VARCHAR(128) NOT NULL DEFAULT '',
    question_text   VARCHAR(512) NOT NULL DEFAULT '',
    question_code   VARCHAR(64)  NOT NULL DEFAULT '',
    service_code    VARCHAR(64)  NOT NULL DEFAULT '',
    service_version VARCHAR(16)  NOT NULL DEFAULT '',
    params_json     TEXT         NOT NULL DEFAULT '{}',
    row_count       INT          NOT NULL DEFAULT 0,
    elapsed_ms      INT          NOT NULL DEFAULT 0,
    outcome         VARCHAR(32)  NOT NULL,
    detail          VARCHAR(512) NOT NULL DEFAULT '',
    feedback_rating VARCHAR(16)  NULL,
    feedback_note   VARCHAR(512) NULL,
    feedback_at     TIMESTAMP    NULL,
    created_at      TIMESTAMP    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_assistant_query_audit_tenant
    ON data_os.assistant_query_audit (tenant_id, created_at DESC);

-- 首批三个已验证问题（对齐 G13/G16e 已发布数据服务；参数契约与服务一致）。
-- 问题管理端点不在 G26 固定三接口内：Beta 期以迁移为版本化事实源，
-- 后续管理面另立 gate（见备忘）。
INSERT INTO data_os.assistant_verified_question
    (id, tenant_id, code, question, aliases_json, param_schema_json, service_code,
     answer_template, status, created_by, created_at, updated_at)
VALUES
    ('b1a2a000-2600-4000-8000-0000000000a1', 'default', 'prescription-daily-summary',
     '查询一段时间内每天的处方量趋势',
     '["最近每天开了多少处方","每日处方量趋势","按天统计处方量","处方量按日汇总"]',
     '[{"name":"start_date","type":"date","required":true},{"name":"end_date","type":"date","required":true}]',
     'prescription-daily-summary',
     '已为您统计 {start_date} 至 {end_date} 的每日处方量，共 {row_count} 天，口径 {service_code} {service_version}。',
     'PUBLISHED', 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('b1a2a000-2600-4000-8000-0000000000a2', 'default', 'prescription-department-daily',
     '查询各科室每天的处方量',
     '["科室日处方量","每天各科室开了多少处方","按科室统计处方"]',
     '[{"name":"start_date","type":"date","required":true},{"name":"end_date","type":"date","required":true}]',
     'prescription-department-daily',
     '已为您统计 {start_date} 至 {end_date} 各科室的每日处方量，共 {row_count} 行，口径 {service_code} {service_version}。',
     'PUBLISHED', 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
    ('b1a2a000-2600-4000-8000-0000000000a3', 'default', 'medicine-record-daily',
     '查询每天的用药记录量',
     '["每日用药记录数","按天统计用药记录","用药记录日汇总"]',
     '[{"name":"start_date","type":"date","required":true},{"name":"end_date","type":"date","required":true}]',
     'medicine-record-daily',
     '已为您统计 {start_date} 至 {end_date} 的每日用药记录量，共 {row_count} 天，口径 {service_code} {service_version}。',
     'PUBLISHED', 'system', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
