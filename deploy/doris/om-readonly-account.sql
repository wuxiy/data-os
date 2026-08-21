-- G6-1：OM 摄取专用只读账号（幂等）。由管理员会话渲染执行：
--   sed "s|__OM_RO_PASSWORD__|$PW|" deploy/doris/om-readonly-account.sql | mysql ...
-- 口令占位不进任何日志；文件本身零口令可进 Git。
-- 授权范围 = data-os 自有三库（与 om-ingest-doris-assets.sh 的
-- TARGET_DATABASES 一致）；data-ops 遗留库与 dataos_quality_audit 不授。
-- G3 纪律保持：dataos_quality_ro / dataos_mpi 的授权面不受影响。

CREATE USER IF NOT EXISTS 'dataos_om_ro'@'%'
  IDENTIFIED BY '__OM_RO_PASSWORD__';
-- Doris 语法：SET PASSWORD 右侧须 PASSWORD('明文')，裸字符串会被当作 hash。
SET PASSWORD FOR 'dataos_om_ro'@'%' = PASSWORD('__OM_RO_PASSWORD__');

GRANT SELECT_PRIV ON ods_ep.* TO 'dataos_om_ro'@'%';
GRANT SELECT_PRIV ON dataos_quality_acceptance.* TO 'dataos_om_ro'@'%';
GRANT SELECT_PRIV ON dataos_mpi.* TO 'dataos_om_ro'@'%';

-- 留证：授权面自检（执行后应只出现三库 SELECT）
SHOW GRANTS FOR 'dataos_om_ro'@'%';
