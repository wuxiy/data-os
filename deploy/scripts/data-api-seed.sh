#!/usr/bin/env bash
# G13 数据服务种子：三个真实数据面服务定义（PUBLISHED）+ 一个演示 API Key。
# 幂等：以 (tenant_id, code) 与 key_hash 为锚点，重复执行更新而非报错。
#
# 用法（远端 dev 机，控制面 PG 容器内执行）：
#   DATAOS_DATA_API_DEMO_KEY=dataos_sk_xxx ./data-api-seed.sh
# 明文 Key 只进调用方手中与 0600 文件（/root/.data-api-demo-key），库内仅 hash。
set -euo pipefail

TENANT="${DATAOS_SEED_TENANT:-default}"
DEMO_KEY="${DATAOS_DATA_API_DEMO_KEY:-}"
if [ -z "$DEMO_KEY" ]; then
  echo "DATAOS_DATA_API_DEMO_KEY 未提供（openssl rand -hex 32 生成，前缀 dataos_sk_）" >&2
  exit 1
fi
KEY_HASH=$(printf '%s' "$DEMO_KEY" | sha256sum | awk '{print $1}')

PG_CONTAINER="${PG_CONTAINER:-data-os-dev-control-plane-db-1}"
PSQL=(docker exec -i "$PG_CONTAINER" psql -U dataos -d dataos)

# ---- 服务定义（SQL 模板已经 repo 侧 SqlTemplateValidator 同规则审过）----

$PSQL <<SQL
INSERT INTO data_os.data_service
  (id, tenant_id, code, name, description, version_sn, status, sql_template,
   parameters_json, columns_json, max_rows, timeout_seconds, owner, created_at, updated_at)
VALUES
  ('g13-svc-prescription', '$TENANT', 'prescription-daily-summary', '处方日汇总',
   '按日期区间汇总电子处方量（ods_ep 真实数据，聚合口径，无患者明细）',
   'v1', 'PUBLISHED',
   'SELECT SUBSTR(KFRQ, 1, 10) AS stat_date, COUNT(*) AS prescriptions FROM ods_ep.ep_mz_cfzb WHERE SUBSTR(KFRQ, 1, 10) BETWEEN :start_date AND :end_date GROUP BY SUBSTR(KFRQ, 1, 10) ORDER BY stat_date',
   '[{"name":"start_date","type":"date","required":true,"description":"开始日期（YYYY-MM-DD）"},{"name":"end_date","type":"date","required":true,"description":"结束日期（含）"}]',
   '[{"name":"stat_date","type":"date","description":"统计日期"},{"name":"prescriptions","type":"number","description":"处方张数"}]',
   500, 30, 'data-team', NOW(), NOW()),
  ('g13-svc-cohort', '$TENANT', 'research-cohort-masked', '科研队列（脱敏）',
   '科研队列出队投影：不含姓名与证件号，仅脱敏标识与质量分（PHI 守卫：name/id_card 列不进模板）',
   'v1', 'PUBLISHED',
   'SELECT patient_id, hospital_code, gender, birth_date, quality_score, consent_status FROM medical_platform_datasets.ds_research_cohort WHERE hospital_code = :hospital_code AND quality_score >= :min_quality_score',
   '[{"name":"hospital_code","type":"string","required":true,"description":"医院代码（Key 授权交集内）"},{"name":"min_quality_score","type":"number","required":false,"description":"质量分下限","defaultValue":"0"}]',
   '[{"name":"patient_id","type":"string","description":"患者标识"},{"name":"hospital_code","type":"string","description":"医院代码"},{"name":"gender","type":"string","description":"性别"},{"name":"birth_date","type":"date","description":"出生日期"},{"name":"quality_score","type":"number","description":"质量分"},{"name":"consent_status","type":"string","description":"知情同意状态"}]',
   200, 30, 'data-team', NOW(), NOW()),
  ('g13-svc-p360', '$TENANT', 'patient-360-stats', '患者 360 汇总统计',
   '按医院聚合的患者 360 诊疗统计（无患者明细行）',
   'v1', 'PUBLISHED',
   'SELECT hospital_code, COUNT(*) AS patients, SUM(outp_visit_count) AS outpatient_visits, SUM(inp_visit_count) AS inpatient_visits FROM medical_platform_marts.dws_patient_360 WHERE hospital_code = :hospital_code GROUP BY hospital_code',
   '[{"name":"hospital_code","type":"string","required":true,"description":"医院代码"}]',
   '[{"name":"hospital_code","type":"string","description":"医院代码"},{"name":"patients","type":"number","description":"患者数"},{"name":"outpatient_visits","type":"number","description":"门诊人次合计"},{"name":"inpatient_visits","type":"number","description":"住院人次合计"}]',
   100, 30, 'data-team', NOW(), NOW())
ON CONFLICT (tenant_id, code) DO UPDATE SET
  sql_template = EXCLUDED.sql_template,
  parameters_json = EXCLUDED.parameters_json,
  columns_json = EXCLUDED.columns_json,
  status = 'PUBLISHED',
  updated_at = NOW();

-- 演示 Key：挂在处方汇总服务下，医院授权 *
INSERT INTO data_os.data_service_key
  (id, service_id, tenant_id, caller_name, key_hash, key_prefix,
   allowed_hospitals_json, daily_quota, status, created_at)
VALUES
  ('g13-key-demo', 'g13-svc-prescription', '$TENANT', '内测演示调用方',
   '$KEY_HASH', '${DEMO_KEY:0:16}', '["*"]', 1000, 'ACTIVE', NOW())
ON CONFLICT (key_hash) DO UPDATE SET
  status = 'ACTIVE',
  daily_quota = 1000,
  revoked_at = NULL;
SQL

echo "seed 完成：3 服务 PUBLISHED + 演示 Key（hash ${KEY_HASH:0:12}…）"
