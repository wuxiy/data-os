-- G17 AI-2：EP 真实采集语料产物表（与合成语料 dataos_ai.chunks 分表，
-- 评测检索互不污染）。列结构与 chunks 一致；由 dataos_ai_writer 写入。
-- 用法：以具备 dataos_ai 库 DDL 权限的账号执行（与 G10 chunks 同口径）。
CREATE TABLE IF NOT EXISTS dataos_ai.chunks_ep (
  `chunk_id` varchar(64) NOT NULL COMMENT "内容指纹 chunk id",
  `document_id` varchar(64) NOT NULL COMMENT "文档指纹（溯源必填）",
  `section` varchar(256) NULL COMMENT "所属章节（EP 口径为就诊科室）",
  `source_offset` int NOT NULL COMMENT "块序号起点（溯源必填）",
  `content` text NOT NULL,
  `quality_score` double NOT NULL,
  `recipe_version` varchar(32) NOT NULL,
  `built_at` datetime NOT NULL
) ENGINE=OLAP
UNIQUE KEY(`chunk_id`)
DISTRIBUTED BY HASH(`chunk_id`) BUCKETS 4
PROPERTIES (
"file_cache_ttl_seconds" = "0",
"is_being_synced" = "false",
"storage_medium" = "hdd",
"storage_format" = "V2",
"inverted_index_storage_format" = "V2",
"enable_unique_key_merge_on_write" = "true",
"light_schema_change" = "true",
"disable_auto_compaction" = "false",
"enable_single_replica_compaction" = "false"
);
