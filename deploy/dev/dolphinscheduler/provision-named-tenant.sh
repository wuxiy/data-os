#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
deploy_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
sql_file="$script_dir/../../dolphinscheduler/clinical-tenant-migration.sql"
data_os_sql_file="$script_dir/../../data-os/clinical-workflow-migration.sql"

if [ -f "$deploy_dir/docker-compose.yml" ] && [ -f "$deploy_dir/dolphinscheduler/docker-compose.yml" ]; then
  compose_dir=$deploy_dir
else
  compose_dir=$(CDPATH= cd -- "$script_dir/../../.." && pwd)
fi
env_file=${DATAOS_DEV_ENV_FILE:-$deploy_dir/.env}
[ -r "$env_file" ] || env_file="$compose_dir/.env"

. "$script_dir/../../scripts/load-dotenv.sh"
load_dotenv "$env_file"

tenant_code=${DATAOS_DOLPHINSCHEDULER_TENANT_CODE:-}
service_user=${DATAOS_DOLPHINSCHEDULER_SERVICE_USER:-dataos_scheduler}
queue_id=${DATAOS_DOLPHINSCHEDULER_QUEUE_ID:-1}
tenant_description=${DATAOS_DOLPHINSCHEDULER_TENANT_DESCRIPTION:-data-os named tenant}
db_user=${DOLPHINSCHEDULER_DB_USERNAME:-dolphinscheduler}
db_name=${DOLPHINSCHEDULER_DB_NAME:-dolphinscheduler}
legacy_workflow_prefix=${DATAOS_LEGACY_SHELL_WORKFLOW_PREFIX:-dataos_gate1_shell_}
legacy_project_code=${DATAOS_LEGACY_SHELL_PROJECT_CODE:-180931789157120}
legacy_job_prefix=${DATAOS_LEGACY_SHELL_JOB_PREFIX:-Gate1 DolphinScheduler E2E }
data_os_db_host=${DATAOS_DB_HOST:-keycloak-db}
data_os_db_name=${DATAOS_DB_NAME:-keycloak}
data_os_db_user=${DATAOS_DB_USERNAME:-keycloak}

tenant_code_normalized=$(printf '%s' "$tenant_code" | tr '[:upper:]' '[:lower:]')
case "$tenant_code_normalized" in
  ""|default)
    echo "DATAOS_DOLPHINSCHEDULER_TENANT_CODE must be a non-default named tenant" >&2
    exit 64
    ;;
esac
case "$legacy_workflow_prefix" in
  dataos_gate1_shell_*) ;;
  *) echo "DATAOS_LEGACY_SHELL_WORKFLOW_PREFIX must use dataos_gate1_shell_*" >&2; exit 64 ;;
esac
case "$legacy_project_code" in
  ""|*[!0-9]*) echo "DATAOS_LEGACY_SHELL_PROJECT_CODE must be numeric" >&2; exit 64 ;;
esac
case "$legacy_job_prefix" in
  "Gate1 DolphinScheduler E2E "*|dataos_gate1_shell_*) ;;
  *) echo "DATAOS_LEGACY_SHELL_JOB_PREFIX is outside the historical Gate 1 scope" >&2; exit 64 ;;
esac

cd "$compose_dir"
docker compose \
  --env-file "$env_file" \
  -f docker-compose.yml \
  -f dolphinscheduler/docker-compose.yml \
  --profile scheduler \
  exec -T dolphinscheduler-postgresql \
  psql -v ON_ERROR_STOP=1 \
    -U "$db_user" \
    -d "$db_name" \
    -v tenant_code="$tenant_code" \
    -v tenant_description="$tenant_description" \
    -v queue_id="$queue_id" \
    -v service_user="$service_user" \
    -v legacy_workflow_prefix="$legacy_workflow_prefix" \
    -v legacy_project_code="$legacy_project_code" \
    -f - < "$sql_file"

: "${DATAOS_DB_PASSWORD:?DATAOS_DB_PASSWORD must be available in .env or the environment}"
docker compose \
  --env-file "$env_file" \
  -f docker-compose.yml \
  -f dolphinscheduler/docker-compose.yml \
  --profile scheduler \
  exec -T dolphinscheduler-postgresql \
  env PGPASSWORD="$DATAOS_DB_PASSWORD" \
  psql -v ON_ERROR_STOP=1 \
    -h "$data_os_db_host" \
    -U "$data_os_db_user" \
    -d "$data_os_db_name" \
    -v legacy_job_prefix="$legacy_job_prefix" \
    -f - < "$data_os_sql_file"

echo "Provisioned DolphinScheduler tenant '$tenant_code' and archived the historical Gate 1 scheduler/data-os projections."
