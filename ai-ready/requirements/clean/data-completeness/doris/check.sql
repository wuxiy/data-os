-- 关键业务列（机构/患者/开方时间/处方状态）任一为空的行占比
SELECT ROUND(
         COALESCE(SUM(CASE WHEN YLJGDM IS NULL OR YLJGDM = ''
                            OR PATIENT_ID IS NULL OR PATIENT_ID = ''
                            OR KFRQ IS NULL
                            OR CFPTZT IS NULL THEN 1 ELSE 0 END), 0)
         / GREATEST(COUNT(*), 1), 6) AS null_ratio
FROM ods_ep.ep_mz_cfzb
