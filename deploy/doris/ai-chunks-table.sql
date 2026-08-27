-- G10 RAG 数据集工厂产物表（幂等）。由管理员会话渲染执行：
--   sed "s|__AI_RO_PASSWORD__|$PW|" deploy/doris/ai-chunks-table.sql | mysql ...
-- UNIQUE KEY(chunk_id) 使构建幂等重跑为覆盖写；dataos_om_ro（G9 评估只读账号）
-- 授只读。

CREATE DATABASE IF NOT EXISTS dataos_ai;

CREATE TABLE IF NOT EXISTS dataos_ai.chunks (
    chunk_id       VARCHAR(64)  NOT NULL COMMENT '内容指纹 chunk id',
    document_id    VARCHAR(64)  NOT NULL COMMENT '文档指纹（溯源必填）',
    section        VARCHAR(256) NULL     COMMENT '所属章节标题',
    source_offset  INT          NOT NULL COMMENT '块序号起点（溯源必填）',
    content        TEXT         NOT NULL,
    quality_score  DOUBLE       NOT NULL,
    recipe_version VARCHAR(32)  NOT NULL,
    built_at       DATETIME     NOT NULL
) ENGINE=OLAP
UNIQUE KEY(chunk_id)
DISTRIBUTED BY HASH(chunk_id) BUCKETS 4
PROPERTIES ("replication_num" = "1");

GRANT SELECT_PRIV ON dataos_ai.* TO 'dataos_om_ro'@'%';

-- 构建写入专用账号（最小面：仅 dataos_ai 库 LOAD；口令由部署机生成）
CREATE USER IF NOT EXISTS 'dataos_ai_writer'@'%'
  IDENTIFIED BY '__AI_WRITER_PASSWORD__';
SET PASSWORD FOR 'dataos_ai_writer'@'%' = PASSWORD('__AI_WRITER_PASSWORD__');
GRANT LOAD_PRIV ON dataos_ai.* TO 'dataos_ai_writer'@'%';
-- Doris 3.x：任何执行路径都要求 compute group USAGE（G6 同坑）
GRANT USAGE_PRIV ON COMPUTE GROUP default_compute_group TO 'dataos_ai_writer'@'%';

SHOW GRANTS FOR 'dataos_ai_writer'@'%';
SHOW TABLES FROM dataos_ai;
