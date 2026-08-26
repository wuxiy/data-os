-- 脱敏有效性：哈希/归一列中明文手机号或身份证模式命中数（应恒为 0）
SELECT ROUND(
         COALESCE(SUM(CASE WHEN contact_hash REGEXP '^1[0-9]{10}$'
                            OR id_card_hash REGEXP '^[0-9]{17}[0-9Xx]$' THEN 1 ELSE 0 END), 0)
         / GREATEST(COUNT(*), 1), 6) AS plaintext_hit_ratio
FROM dataos_mpi.mpi_source_identity
