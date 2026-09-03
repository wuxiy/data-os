#!/usr/bin/env bash
# G1.4 血缘链（幂等）：OpenMetadata 建/更 superset-dataos 仪表盘服务 +
# 摄取「电子处方嵌入验证」仪表盘（图表/数据模型/血缘 → doris-dataos）。
# 详见 docs/lineage-g1-g2-review-and-plan-20260820.md 决策 D5。
#
# 用法（部署机上）：
#   bash om-ingest-superset.sh
# 凭据来源（.env 或环境）：
#   DATAOS_OM_INGEST_CLIENT_SECRET  Keycloak dataos-om-ingest client secret
#   SUPERSET_USER / SUPERSET_PASSWORD  Superset API 账号（默认 spike 管理员）
# 可选覆盖：SUPERSET_PASSWORD_FILE、ENV_FILE、KEYCLOAK_TOKEN_URL、OM_API_BASE、
#   OM_NETWORK、INGESTION_IMAGE、OM_INGEST_SECRET_FILE
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/load-dotenv.sh"
load_dotenv "${ENV_FILE:-$SCRIPT_DIR/../../.env}"

OM_SECRET="${DATAOS_OM_INGEST_CLIENT_SECRET:-}"
OM_INGEST_SECRET_FILE="${OM_INGEST_SECRET_FILE:-/root/.om-ingest-client-secret}"
if [ -z "$OM_SECRET" ] && [ -r "$OM_INGEST_SECRET_FILE" ]; then
  OM_SECRET=$(cat "$OM_INGEST_SECRET_FILE")
fi
[ -n "$OM_SECRET" ] || { echo "缺少 DATAOS_OM_INGEST_CLIENT_SECRET" >&2; exit 1; }
SUPERSET_USER="${SUPERSET_USER:-dataos-spike}"
SUPERSET_PASSWORD="${SUPERSET_PASSWORD:-}"
SUPERSET_PASSWORD_FILE="${SUPERSET_PASSWORD_FILE:-/root/spike-hapi/superset-spike-pw}"
if [ -z "$SUPERSET_PASSWORD" ] && [ -r "$SUPERSET_PASSWORD_FILE" ]; then
  SUPERSET_PASSWORD=$(cat "$SUPERSET_PASSWORD_FILE")
fi
[ -n "$SUPERSET_PASSWORD" ] || { echo "缺少 SUPERSET_PASSWORD" >&2; exit 1; }

KEYCLOAK_TOKEN_URL="${KEYCLOAK_TOKEN_URL:-http://localhost:8180/auth/realms/data-platform/protocol/openid-connect/token}"
OM_API_BASE="${OM_API_BASE:-https://localhost:8445/api/v1}"
OM_NETWORK="${OM_NETWORK:-medical-platform_platform-net}"
INGESTION_IMAGE="${INGESTION_IMAGE:-openmetadata/ingestion:1.6.0}"
SERVICE_NAME="superset-dataos"

om_api() { # om_api METHOD PATH [JSON_BODY]
  local method=$1 path=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -sk -X "$method" -H "Authorization: Bearer $OM_JWT" -H 'Content-Type: application/json' \
      -d "$body" "$OM_API_BASE$path"
  else
    curl -sk -X "$method" -H "Authorization: Bearer $OM_JWT" "$OM_API_BASE$path"
  fi
}

echo '== 1/3 签发 ingestion-bot 令牌 =='
OM_JWT=$(curl -s -X POST "$KEYCLOAK_TOKEN_URL" \
  -d grant_type=client_credentials -d client_id=dataos-om-ingest \
  -d client_secret="$OM_SECRET" |
  python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
[ ${#OM_JWT} -gt 100 ] || { echo '令牌签发失败' >&2; exit 1; }
echo "token-len=${#OM_JWT}"

echo '== 2/3 服务 provision（幂等 upsert superset-dataos）=='
CONNECTION=$(python3 - "$SUPERSET_USER" "$SUPERSET_PASSWORD" <<'PY'
import json, sys
print(json.dumps({
    "type": "Superset", "hostPort": "http://superset:8088",
    "connection": {"username": sys.argv[1], "password": sys.argv[2],
                   "provider": "db"},
    "supportsMetadataExtraction": True,
}))
PY
)
EXISTING=$(om_api GET "/services/dashboardServices/name/$SERVICE_NAME")
if echo "$EXISTING" | grep -q '"code":404'; then
  om_api POST /services/dashboardServices "$(python3 -c "
import json,sys
print(json.dumps({'name':'$SERVICE_NAME','serviceType':'Superset',
 'description':'data-os Superset（嵌入式分析页，见 G4）',
 'connection':{'config':json.loads(sys.argv[1])}}))" "$CONNECTION")" >/dev/null
  echo "服务已创建：$SERVICE_NAME"
else
  om_api PUT "/services/dashboardServices" "$(python3 -c "
import json,sys
e=json.loads(sys.argv[1]); e['connection']={'config':json.loads(sys.argv[2])}
print(json.dumps(e))" "$EXISTING" "$CONNECTION")" >/dev/null
  echo "服务已更新：$SERVICE_NAME"
fi

echo '== 3/3 摄取仪表盘 + 血缘（→ doris-dataos）=='
YAML=$(mktemp /tmp/om-superset-XXXXXX.yaml)
trap 'rm -f "$YAML"' EXIT
chmod 600 "$YAML"
sed -e "s|__OM_JWT__|$OM_JWT|" \
    "$SCRIPT_DIR/../config/openmetadata/superset-dataos-ingestion.yaml.template" > "$YAML"
docker run --rm --user 0:0 --network "$OM_NETWORK" -v "$YAML":/opt/ingest.yaml:ro \
  --entrypoint python3 "$INGESTION_IMAGE" -m metadata ingest -c /opt/ingest.yaml 2>&1 |
  grep -E "Workflow|Success|Errors|Source Summary|Processed|Updated|Warnings|Filtered" | tail -12

echo '== 摘要：superset-dataos 实体与血缘 =='
om_api GET "/dashboards?service=$SERVICE_NAME&limit=20" |
  python3 -c 'import sys,json
for d in json.load(sys.stdin).get("data",[]):
    print("  dashboard:", d["fullyQualifiedName"], "| charts:", len(d.get("charts",[])))'
om_api GET "/charts?service=$SERVICE_NAME&limit=20" |
  python3 -c 'import sys,json
for c in json.load(sys.stdin).get("data",[]):
    print("  chart:", c["fullyQualifiedName"])'
om_api GET "/lineage/table/name/doris-dataos.default.ods_ep.ep_mz_cfzb?upstreamDepth=3" |
  python3 -c '
import sys, json
d = json.load(sys.stdin)
nodes = d.get("nodes", [])
edges = d.get("edges", [])
print(f"  lineage nodes={len(nodes)} edges={len(edges)}")
for e in edges[:10]:
    print("    edge:", e.get("fromEntity"), "->", e.get("toEntity"))
'
