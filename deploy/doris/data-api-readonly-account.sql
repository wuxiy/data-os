-- G13 执行面专用只读账号：ToB 数据 API 网关（services/data-api）。
-- 授权面：电子处方 ODS 全部表 + 科研队列 + 患者 360 聚合宽表；不含任何源系统账号。
-- 渲染口径与 G6 om-readonly-account.sql 一致（管理员会话 sed 注入明文，
-- 文件本身零口令可进 Git；SET PASSWORD 右侧须 PASSWORD()，裸串会被当 hash）。

CREATE USER IF NOT EXISTS 'dataos_api_ro'@'%'
  IDENTIFIED BY '__DATA_API_RO_PASSWORD__';
SET PASSWORD FOR 'dataos_api_ro'@'%' = PASSWORD('__DATA_API_RO_PASSWORD__');

-- 表级显式授权（不用库级通配，越权面最小）
GRANT SELECT_PRIV ON ods_ep.ep_mz_cfzb TO 'dataos_api_ro'@'%';
GRANT SELECT_PRIV ON ods_ep.ep_mz_ypcfmx TO 'dataos_api_ro'@'%';
GRANT SELECT_PRIV ON ods_ep.ep_mz_cfzb_edge TO 'dataos_api_ro'@'%';
GRANT SELECT_PRIV ON ods_ep.ep_mz_ypcfmx_edge TO 'dataos_api_ro'@'%';
GRANT SELECT_PRIV ON medical_platform_datasets.ds_research_cohort TO 'dataos_api_ro'@'%';
GRANT SELECT_PRIV ON medical_platform_marts.dws_patient_360 TO 'dataos_api_ro'@'%';

-- compute group 门槛（G6/G10 同坑：新账号缺 USAGE 会查询报错）
GRANT USAGE_PRIV ON COMPUTE GROUP default_compute_group TO 'dataos_api_ro'@'%';

-- 留证：授权面自检（执行后应只出现上述表 SELECT）
SHOW GRANTS FOR 'dataos_api_ro'@'%';
