-- MPI 批处理态存储（Doris）。由平台管理员在 FE(MySQL 协议) 执行一次，幂等。
-- 口令不进入本仓库：账号与授权由 deploy/scripts/provision-mpi-storage.sh 参数化执行。
CREATE DATABASE IF NOT EXISTS dataos_mpi;

-- 源身份：装载管道幂等写入（UNIQUE KEY 覆盖）。哈希列占位（EP 无身份证/联系方式
-- 明文场景），年龄仅展示证据。
CREATE TABLE IF NOT EXISTS dataos_mpi.mpi_source_identity (
    tenant_id VARCHAR(64) NOT NULL COMMENT '租户',
    institution_code VARCHAR(64) NOT NULL COMMENT '机构代码（YLJGDM）',
    source_system VARCHAR(32) NOT NULL COMMENT '来源系统（EP）',
    source_key VARCHAR(128) NOT NULL COMMENT '源身份键（机构内患者主键）',
    patient_id VARCHAR(64) NULL,
    card_no_norm VARCHAR(64) NULL COMMENT '归一卡号',
    name_norm VARCHAR(128) NOT NULL COMMENT '归一姓名',
    gender VARCHAR(8) NULL COMMENT '归一性别 M/F/U',
    age_display VARCHAR(16) NULL COMMENT '年龄（仅展示，不进规则）',
    contact_hash VARCHAR(128) NULL,
    id_card_hash VARCHAR(128) NULL,
    mpi_person_id VARCHAR(64) NULL COMMENT '黄金人回写列',
    loaded_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
) ENGINE=OLAP
UNIQUE KEY(tenant_id, source_system, source_key)
DISTRIBUTED BY HASH(source_key) BUCKETS 8
PROPERTIES ("replication_num" = "1");

-- 候选对：Blocking 产出，pair_id 为确定性哈希（tenant|identityA|identityB），
-- 跨召回规则按 pair 去重（装载 SQL 聚合，覆盖写幂等）。
CREATE TABLE IF NOT EXISTS dataos_mpi.mpi_candidate_pair (
    pair_id BIGINT NOT NULL COMMENT '确定性 pair id',
    tenant_id VARCHAR(64) NOT NULL,
    identity_a VARCHAR(128) NOT NULL COMMENT '源身份键（字典序较小侧）',
    identity_b VARCHAR(128) NOT NULL COMMENT '源身份键（字典序较大侧）',
    blocking_rule VARCHAR(16) NOT NULL COMMENT 'B3/B4/B6',
    generated_at DATETIME NOT NULL
) ENGINE=OLAP
UNIQUE KEY(pair_id)
DISTRIBUTED BY HASH(pair_id) BUCKETS 8
PROPERTIES ("replication_num" = "1");

-- 匹配结果：三态 + 硬冲突 + 逐字段证据（证据 JSON 不含明文证件/联系方式）。
CREATE TABLE IF NOT EXISTS dataos_mpi.mpi_match_result (
    pair_id BIGINT NOT NULL,
    tenant_id VARCHAR(64) NOT NULL,
    identity_a VARCHAR(128) NOT NULL,
    identity_b VARCHAR(128) NOT NULL,
    rule_id VARCHAR(16) NOT NULL COMMENT '命中的规则（M-ep1 等）',
    rule_version VARCHAR(32) NOT NULL,
    outcome VARCHAR(24) NOT NULL COMMENT 'AUTO_MATCH/REVIEW/NO_MATCH/HARD_CONFLICT',
    evidence TEXT NOT NULL,
    decided_at DATETIME NOT NULL
) ENGINE=OLAP
UNIQUE KEY(pair_id)
DISTRIBUTED BY HASH(pair_id) BUCKETS 8
PROPERTIES ("replication_num" = "1");
