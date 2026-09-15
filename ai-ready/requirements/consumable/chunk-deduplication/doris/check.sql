-- Chunk 去重完备：内容指纹重复的 chunk 占比（应恒为 0）
SELECT ROUND(
         (COUNT(*) - COUNT(DISTINCT MD5(content))) / GREATEST(COUNT(*), 1), 6) AS dup_content_ratio
FROM dataos_ai.chunks
