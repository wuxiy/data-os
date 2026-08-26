-- MPI 匹配结果可信面：AUTO_MATCH 与 REVIEW 合计占比（NO_MATCH/HARD_CONFLICT 视为不可信）
SELECT ROUND(
         COALESCE(SUM(CASE WHEN outcome IN ('AUTO_MATCH', 'REVIEW') THEN 1 ELSE 0 END), 0)
         / GREATEST(COUNT(*), 1), 6) AS trusted_ratio
FROM dataos_mpi.mpi_match_result
