-- Chunk 溯源完备：无 document_id 或无 source_offset 的 chunk 占比（应恒为 0）
SELECT ROUND(
         COALESCE(SUM(CASE WHEN document_id IS NULL OR document_id = ''
                            OR source_offset IS NULL THEN 1 ELSE 0 END), 0)
         / GREATEST(COUNT(*), 1), 6) AS unattributed_ratio
FROM dataos_ai.chunks
