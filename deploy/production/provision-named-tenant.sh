#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
env_file=${DATAOS_PRODUCTION_ENV_FILE:-$script_dir/.env}
if [ ! -r "$env_file" ]; then
  echo "production .env not found: $env_file" >&2
  exit 64
fi

. "$script_dir/../scripts/load-dotenv.sh"
load_dotenv "$env_file"

tenant_code=${DATAOS_DOLPHINSCHEDULER_TENANT_CODE:-}
service_user=${DATAOS_DOLPHINSCHEDULER_SERVICE_USER:-dataos_scheduler}
queue_id=${DATAOS_DOLPHINSCHEDULER_QUEUE_ID:-1}
tenant_description=${DATAOS_DOLPHINSCHEDULER_TENANT_DESCRIPTION:-data-os named tenant}
legacy_workflow_prefix=${DATAOS_LEGACY_SHELL_WORKFLOW_PREFIX:-dataos_gate1_shell_}
legacy_project_code=${DATAOS_LEGACY_SHELL_PROJECT_CODE:-180931789157120}
legacy_job_prefix=${DATAOS_LEGACY_SHELL_JOB_PREFIX:-Gate1 DolphinScheduler E2E }

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

: "${DOLPHINSCHEDULER_DB_HOST:?DOLPHINSCHEDULER_DB_HOST must be set in .env}"
: "${DOLPHINSCHEDULER_DB_NAME:?DOLPHINSCHEDULER_DB_NAME must be set in .env}"
: "${DOLPHINSCHEDULER_DB_USERNAME:?DOLPHINSCHEDULER_DB_USERNAME must be set in .env}"
: "${DOLPHINSCHEDULER_DB_PASSWORD:?DOLPHINSCHEDULER_DB_PASSWORD must be set in .env}"
: "${DATAOS_DB_HOST:?DATAOS_DB_HOST must be set in .env for the provisioning client}"
: "${DATAOS_DB_PASSWORD:?DATAOS_DB_PASSWORD must be set in .env}"

PGHOST="$DOLPHINSCHEDULER_DB_HOST" \
PGPORT="${DOLPHINSCHEDULER_DB_PORT:-5432}" \
PGDATABASE="$DOLPHINSCHEDULER_DB_NAME" \
PGUSER="$DOLPHINSCHEDULER_DB_USERNAME" \
PGPASSWORD="$DOLPHINSCHEDULER_DB_PASSWORD" \
PGSSLMODE="${DOLPHINSCHEDULER_DB_SSLMODE:-disable}" \
psql -v ON_ERROR_STOP=1 \
  -v tenant_code="$tenant_code" \
  -v tenant_description="$tenant_description" \
  -v queue_id="$queue_id" \
  -v service_user="$service_user" \
  -v legacy_workflow_prefix="$legacy_workflow_prefix" \
  -v legacy_project_code="$legacy_project_code" \
  -f "$script_dir/../dolphinscheduler/clinical-tenant-migration.sql"

: "${DATAOS_DB_PASSWORD:?DATAOS_DB_PASSWORD must be set in .env}"
PGHOST="$DATAOS_DB_HOST" \
PGPORT="${DATAOS_DB_PORT:-5432}" \
PGDATABASE="${DATAOS_DB_NAME:-data_os}" \
PGUSER="${DATAOS_DB_USERNAME:-data_os}" \
PGPASSWORD="$DATAOS_DB_PASSWORD" \
PGSSLMODE="${DATAOS_DB_SSLMODE:-disable}" \
psql -v ON_ERROR_STOP=1 \
  -v legacy_job_prefix="$legacy_job_prefix" \
  -f "$script_dir/../data-os/clinical-workflow-migration.sql"

echo "Provisioned DolphinScheduler tenant '$tenant_code' and archived the historical Gate 1 scheduler/data-os projections."
