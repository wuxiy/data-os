#!/usr/bin/env bash
# G1 血缘锚点（幂等）：OpenMetadata 建/更 doris-dataos 服务 + 摄取 ods_ep
# 结构元数据 + 表/列对账。详见 docs/lineage-g1-g2-review-and-plan-20260820.md。
#
# 用法（部署机上）：
#   bash om-ingest-ods-ep.sh          # 全流程（provision + 摄取 + 对账）
#   CHECK_ONLY=1 bash om-ingest-ods-ep.sh   # 只对账，不写 OM
# 口令来源（.env 或环境）：
#   DATAOS_OM_INGEST_CLIENT_SECRET  Keycloak dataos-om-ingest client secret
#   DORIS_PASSWORD                  dataos_quality_ro 口令（建服务用）
# 可选覆盖：ENV_FILE、KEYCLOAK_TOKEN_URL、OM_API_BASE、OM_NETWORK、
#   INGESTION_IMAGE、OM_INGEST_SECRET_FILE、DORIS_FE_HOST/PORT
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/load-dotenv.sh"
load_dotenv "${ENV_FILE:-$SCRIPT_DIR/../../.env}"

OM_SECRET="${DATAOS_OM_INGEST_CLIENT_SECRET:-}"
OM_INGEST_SECRET_FILE="${OM_INGEST_SECRET_FILE:-/root/.om-ingest-client-secret}"
if [ -z "$OM_SECRET" ] && [ -r "$OM_INGEST_SECRET_FILE" ]; then
  OM_SECRET=$(cat "$OM_INGEST_SECRET_FILE")
fi
if [ -z "$OM_SECRET" ]; then
  echo "缺少 DATAOS_OM_INGEST_CLIENT_SECRET（或 $OM_INGEST_SECRET_FILE 文件）" >&2
  exit 1
fi
export DATAOS_OM_INGEST_CLIENT_SECRET="$OM_SECRET"
: "${DORIS_PASSWORD:?请在 .env 提供 DORIS_PASSWORD（dataos_quality_ro）}"

KEYCLOAK_TOKEN_URL="${KEYCLOAK_TOKEN_URL:-http://localhost:8180/auth/realms/data-platform/protocol/openid-connect/token}"
OM_API_BASE="${OM_API_BASE:-https://localhost:8445/api/v1}"
OM_NETWORK="${OM_NETWORK:-medical-platform_platform-net}"
INGESTION_IMAGE="${INGESTION_IMAGE:-openmetadata/ingestion:1.5.11}"
DORIS_FE_HOST="${DORIS_FE_HOST:-172.16.66.8}"
DORIS_FE_PORT="${DORIS_FE_PORT:-9030}"
DORIS_USER="${DORIS_USER:-dataos_quality_ro}"
SERVICE_NAME="doris-dataos"
# dev 机已预拉镜像（Docker Hub 不可达），mysql 客户端用于对账直查。
# 口令经 MYSQL_PWD 注入，避免出现在 mysql 命令行与告警里。
MYSQL=(docker run --rm --network "$OM_NETWORK" -e MYSQL_PWD="$DORIS_PASSWORD" mysql:8.0 mysql -h "$DORIS_FE_HOST" -P "$DORIS_FE_PORT" -u "$DORIS_USER")

om_api() { # om_api METHOD PATH [JSON_BODY]
  local method=$1 path=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -sk -X "$method" -H "Authorization: Bearer $OM_JWT" -H 'Content-Type: application/json' \
      -d "$body" "$OM_API_BASE$path"
  else
    curl -sk -X "$method" -H "Authorization: Bearer $OM_JWT" "$OM_API_BASE$path"
  fi
}

echo '== 1/4 签发 ingestion-bot 令牌 =='
OM_JWT=$(curl -s -X POST "$KEYCLOAK_TOKEN_URL" \
  -d grant_type=client_credentials -d client_id=dataos-om-ingest \
  -d client_secret="$DATAOS_OM_INGEST_CLIENT_SECRET" |
  python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
[ ${#OM_JWT} -gt 100 ] || { echo '令牌签发失败' >&2; exit 1; }
echo "token-len=${#OM_JWT}"

if [ "${CHECK_ONLY:-0}" != "1" ]; then
  echo '== 2/4 服务 provision（幂等 upsert doris-dataos）=='
  CONNECTION=$(python3 - "$DORIS_USER" "$DORIS_PASSWORD" "$DORIS_FE_HOST" "$DORIS_FE_PORT" <<'PY'
import json, sys
print(json.dumps({
    "type": "Doris", "scheme": "doris",
    "username": sys.argv[1], "password": sys.argv[2],
    "hostPort": f"{sys.argv[3]}:{sys.argv[4]}",
    "supportsMetadataExtraction": True,
}))
PY
)
  EXISTING=$(om_api GET "/services/databaseServices/name/$SERVICE_NAME")
  if echo "$EXISTING" | grep -q '"code":404'; then
    om_api POST /services/databaseServices "$(python3 -c "
import json,sys
print(json.dumps({'name':'$SERVICE_NAME','serviceType':'Doris',
 'description':'data-os Doris ODS（只读账号 dataos_quality_ro，范围 ods_ep）',
 'connection':{'config':json.loads(sys.argv[1])}}))" "$CONNECTION")" | head -c 200
    echo; echo "服务已创建：$SERVICE_NAME"
  else
    om_api PUT "/services/databaseServices" "$(python3 -c "
import json,sys
e=json.loads(sys.argv[1]); e['connection']={'config':json.loads(sys.argv[2])}
print(json.dumps(e))" "$EXISTING" "$CONNECTION")" >/dev/null
    echo "服务已更新：$SERVICE_NAME"
  fi

  echo '== 3/4 摄取 ods_ep（结构元数据，无 profiler）=='
  YAML=$(mktemp /tmp/om-ingest-XXXXXX.yaml)
  trap 'rm -f "$YAML"' EXIT
  chmod 600 "$YAML"
  # 渲染令牌；其余占位无（连接在服务实体内）。
  sed "s|__OM_JWT__|$OM_JWT|" \
    "$SCRIPT_DIR/../config/openmetadata/doris-dataos-ingestion.yaml.template" > "$YAML"
  # 令牌文件保持 600/root；一次性容器以 root 运行以读取只读挂载。
  docker run --rm --user 0:0 --network "$OM_NETWORK" -v "$YAML":/opt/ingest.yaml:ro \
    --entrypoint python3 "$INGESTION_IMAGE" -m metadata ingest -c /opt/ingest.yaml
fi

echo '== 4/4 对账：OM 资产 vs Doris 实际结构 =='
"${MYSQL[@]}" -N -e "SHOW TABLES FROM ods_ep;" | sort > /tmp/doris-tables.txt
om_api GET "/tables?database=$SERVICE_NAME.default.ods_ep&limit=100" |
  python3 -c 'import sys,json
for t in json.load(sys.stdin).get("data", []):
    print(t["name"])' | sort > /tmp/om-tables.txt
# 逐表列对账（列名集合比对；类型差异仅记录）
FAIL=0
while read -r T; do
  [ -n "$T" ] || continue
  "${MYSQL[@]}" -N -e "SHOW COLUMNS FROM ods_ep.$T;" | awk '{print $1}' | sort > /tmp/doris-cols.txt
  om_api GET "/tables/name/$SERVICE_NAME.default.ods_ep.$T?fields=columns" |
    python3 -c 'import sys,json
cols=json.load(sys.stdin).get("columns",[])
print("\n".join(c["name"] for c in cols))' | sort > /tmp/om-cols.txt
  if diff -q /tmp/doris-cols.txt /tmp/om-cols.txt >/dev/null; then
    echo "  [PASS] $T 列一致（$(wc -l < /tmp/om-cols.txt | tr -d " ") 列）"
  else
    echo "  [FAIL] $T 列不一致："; diff /tmp/doris-cols.txt /tmp/om-cols.txt | sed 's/^/      /'
    FAIL=1
  fi
done < /tmp/om-tables.txt
DT=$(wc -l < /tmp/doris-tables.txt | tr -d ' ')
OT=$(wc -l < /tmp/om-tables.txt | tr -d ' ')
echo "表数：Doris=$DT OM=$OT"
diff /tmp/doris-tables.txt /tmp/om-tables.txt >/dev/null || { echo '表清单不一致：'; diff /tmp/doris-tables.txt /tmp/om-tables.txt | sed 's/^/  /'; FAIL=1; }
[ "$FAIL" = 0 ] && echo '对账结论：PASS（表与列清单零差异）' || { echo '对账结论：FAIL'; exit 1; }
