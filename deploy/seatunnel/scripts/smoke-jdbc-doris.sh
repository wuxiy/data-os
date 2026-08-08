#!/usr/bin/env sh
set -eu

usage() {
  cat >&2 <<'EOF'
Usage: smoke-jdbc-doris.sh

Required environment:
  SEATUNNEL_BASE_URL, JDBC_URL, JDBC_DRIVER, JDBC_USER, JDBC_PASSWORD,
  JDBC_QUERY, DORIS_FENODES, DORIS_DATABASE, DORIS_TABLE,
  DORIS_USER, DORIS_PASSWORD

The script submits one synthetic batch and prints only the external job id and
terminal status. It never prints the generated configuration or credentials.
The caller owns source/target table creation and should run it twice to verify
the target's UPSERT/idempotency contract.
EOF
  exit 64
}

[ "$#" -eq 0 ] || usage
base_url=${SEATUNNEL_BASE_URL:?SEATUNNEL_BASE_URL must be set}
jdbc_url=${JDBC_URL:?JDBC_URL must be set}
jdbc_driver=${JDBC_DRIVER:?JDBC_DRIVER must be set}
jdbc_user=${JDBC_USER:?JDBC_USER must be set}
jdbc_password=${JDBC_PASSWORD:?JDBC_PASSWORD must be set}
jdbc_query=${JDBC_QUERY:?JDBC_QUERY must be set}
doris_fenodes=${DORIS_FENODES:?DORIS_FENODES must be set}
doris_database=${DORIS_DATABASE:?DORIS_DATABASE must be set}
doris_table=${DORIS_TABLE:?DORIS_TABLE must be set}
doris_user=${DORIS_USER:?DORIS_USER must be set}
doris_password=${DORIS_PASSWORD:?DORIS_PASSWORD must be set}
doris_label_prefix=${DORIS_LABEL_PREFIX:-dataos_smoke_$(date -u +%Y%m%d%H%M%S)}

case "$base_url" in
  http://*|https://*) ;;
  *) echo 'SEATUNNEL_BASE_URL must use http:// or https://' >&2; exit 64 ;;
esac

json_escape() {
  # The accepted smoke inputs are operator-supplied JDBC identifiers/SQL. Keep
  # the JSON file private and escape the characters that can break JSON. The
  # documented smoke contract uses one-line SQL/identifiers.
  printf '%s' "$1" | sed 's/[\\]/\\\\/g; s/"/\\"/g'
}

tmp_dir=$(mktemp -d "${TMPDIR:-/tmp}/dataos-seatunnel-smoke.XXXXXX")
cleanup() { rm -rf "$tmp_dir"; }
trap cleanup EXIT HUP INT TERM
config="$tmp_dir/job.json"
cat > "$config" <<EOF
{
  "env": {"job.mode": "BATCH", "parallelism": 1},
  "source": [{
    "plugin_name": "Jdbc",
    "url": "$(json_escape "$jdbc_url")",
    "driver": "$(json_escape "$jdbc_driver")",
    "user": "$(json_escape "$jdbc_user")",
    "password": "$(json_escape "$jdbc_password")",
    "query": "$(json_escape "$jdbc_query")"
  }],
  "sink": [{
    "plugin_name": "Doris",
    "fenodes": "$(json_escape "$doris_fenodes")",
    "database": "$(json_escape "$doris_database")",
    "table": "$(json_escape "$doris_table")",
    "username": "$(json_escape "$doris_user")",
    "password": "$(json_escape "$doris_password")",
    "sink.label-prefix": "$(json_escape "$doris_label_prefix")",
    "sink.enable-2pc": false,
    "schema_save_mode": "CREATE_SCHEMA_WHEN_NOT_EXIST",
    "data_save_mode": "APPEND_DATA",
    "doris.config": {"format": "json", "read_json_by_line": "true"}
  }]
}
EOF

response=$(curl -fsS -X POST "$base_url/submit-job" \
  -H 'Content-Type: application/json' --data-binary "@$config") || {
  echo 'SeaTunnel rejected the JDBC→Doris smoke submission' >&2
  exit 69
}
job_id=$(printf '%s' "$response" | sed -n 's/.*"jobId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
[ -n "$job_id" ] || { echo 'SeaTunnel response did not include jobId' >&2; exit 65; }
printf '%s\n' "job_id=$job_id"

timeout_seconds=${SEATUNNEL_SMOKE_TIMEOUT_SECONDS:-120}
elapsed=0
while [ "$elapsed" -lt "$timeout_seconds" ]; do
  status_response=$(curl -fsS "$base_url/job-info/$job_id") || {
    echo 'SeaTunnel job status endpoint is unavailable' >&2
    exit 69
  }
  job_status=$(printf '%s' "$status_response" \
    | sed -n 's/.*"jobStatus"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
  case "$job_status" in
    FINISHED|SUCCESS|SUCCEEDED)
      printf '%s\n' "job_status=$job_status"
      exit 0
      ;;
    FAILED|ERROR|CANCELED|CANCELLED|STOPPED)
      printf '%s\n' "job_status=$job_status" >&2
      exit 1
      ;;
  esac
  sleep 2
  elapsed=$((elapsed + 2))
done
echo 'SeaTunnel JDBC→Doris smoke timed out; inspect the external job by id' >&2
exit 75
