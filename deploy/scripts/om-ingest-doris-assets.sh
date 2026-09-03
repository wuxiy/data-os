#!/usr/bin/env bash
# G6 资产目录补全（幂等）：OpenMetadata 建/更 doris-dataos 服务 + 摄取
# data-os 自有三库（ods_ep / dataos_quality_acceptance / dataos_mpi）结构
# 元数据 + 逐库逐表列对账。详见 docs/om-assets-g6-review-and-plan-20260821.md。
#
# 用法（部署机上）：
#   bash om-ingest-doris-assets.sh               # 全流程（provision + 摄取 + 对账）
#   CHECK_ONLY=1 bash om-ingest-doris-assets.sh  # 只对账，不写 OM
# 口令来源（.env 或环境）：
#   DATAOS_OM_INGEST_CLIENT_SECRET  Keycloak dataos-om-ingest client secret
#   DORIS_OM_PASSWORD               dataos_om_ro 口令（或 DORIS_OM_SECRET_FILE）
# 账号前提：dataos_om_ro 由 deploy/doris/om-readonly-account.sql 幂等建号，
# 仅授三库 SELECT（G6-1：OM 摄取身份与业务账号分离）。
# 可选覆盖：ENV_FILE、KEYCLOAK_TOKEN_URL、OM_API_BASE、OM_NETWORK、
#   INGESTION_IMAGE、DATAOS_OM_INGEST_SECRET_FILE、DORIS_OM_SECRET_FILE、
#   DORIS_FE_HOST/PORT、DORIS_USER
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

DORIS_OM_SECRET_FILE="${DORIS_OM_SECRET_FILE:-/root/.doris-om-ro-pw}"
DORIS_OM_PASSWORD="${DORIS_OM_PASSWORD:-}"
if [ -z "$DORIS_OM_PASSWORD" ] && [ -r "$DORIS_OM_SECRET_FILE" ]; then
  DORIS_OM_PASSWORD=$(cat "$DORIS_OM_SECRET_FILE")
fi
[ -n "$DORIS_OM_PASSWORD" ] || {
  echo "缺少 DORIS_OM_PASSWORD（或 $DORIS_OM_SECRET_FILE 文件）" >&2; exit 1; }
export DORIS_OM_PASSWORD

KEYCLOAK_TOKEN_URL="${KEYCLOAK_TOKEN_URL:-http://localhost:8180/auth/realms/data-platform/protocol/openid-connect/token}"
OM_API_BASE="${OM_API_BASE:-https://localhost:8445/api/v1}"
OM_NETWORK="${OM_NETWORK:-medical-platform_platform-net}"
INGESTION_IMAGE="${INGESTION_IMAGE:-openmetadata/ingestion:1.6.0}"
DORIS_FE_HOST="${DORIS_FE_HOST:-172.16.66.8}"
DORIS_FE_PORT="${DORIS_FE_PORT:-9030}"
DORIS_USER="${DORIS_USER:-dataos_om_ro}"
SERVICE_NAME="doris-dataos"
# G6-2：data-os 自有三库；dataos_quality_audit 空库与 data-ops 遗留库不纳入。
TARGET_DATABASES=(ods_ep dataos_quality_acceptance dataos_mpi)
# dev 机已预拉镜像（Docker Hub 不可达），mysql 客户端用于对账直查。
# 口令经 MYSQL_PWD 注入，避免出现在 mysql 命令行与告警里。
MYSQL=(docker run --rm --network "$OM_NETWORK" -e MYSQL_PWD="$DORIS_OM_PASSWORD" mysql:8.0 mysql -h "$DORIS_FE_HOST" -P "$DORIS_FE_PORT" -u "$DORIS_USER")

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
  CONNECTION=$(python3 - "$DORIS_USER" "$DORIS_OM_PASSWORD" "$DORIS_FE_HOST" "$DORIS_FE_PORT" <<'PY'
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
 'description':'data-os Doris 资产（只读账号 dataos_om_ro，范围 ods_ep/质量验收/MPI 三库）',
 'connection':{'config':json.loads(sys.argv[1])}}))" "$CONNECTION")" | head -c 200
    echo; echo "服务已创建：$SERVICE_NAME"
  else
    # 连接更新必须走 PATCH：PUT /services/databaseServices 会静默忽略
    # connection 字段（G6 实测：PUT 后服务实体仍持旧账号，导致 workflow
    # 按旧账号枚举库、目标库整体缺位且无任何报错）。
    SERVICE_ID=$(echo "$EXISTING" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
    curl -sk -X PATCH -H "Authorization: Bearer $OM_JWT" \
      -H 'Content-Type: application/json-patch+json' \
      -d "$(python3 -c "
import json,sys
print(json.dumps([{'op':'replace','path':'/connection/config',
 'value':json.loads(sys.argv[1])}]))" "$CONNECTION")" \
      "$OM_API_BASE/services/databaseServices/$SERVICE_ID" >/dev/null
    ACTUAL=$(om_api GET "/services/databaseServices/name/$SERVICE_NAME" |
      python3 -c 'import sys,json;print(json.load(sys.stdin)["connection"]["config"]["username"])')
    [ "$ACTUAL" = "$DORIS_USER" ] || { echo "服务连接更新未生效（username=$ACTUAL）" >&2; exit 1; }
    echo "服务已更新：$SERVICE_NAME（连接账号 $ACTUAL）"
  fi


  echo '== 3/4 摄取三库（结构元数据，无 profiler）=='
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

echo '== 4/4 对账：OM 资产 vs Doris 实际结构（逐库逐表）=='
FAIL=0
TOTAL_TABLES=0
for DB in "${TARGET_DATABASES[@]}"; do
  echo "-- 库 $DB"
  "${MYSQL[@]}" -N -e "SHOW TABLES FROM $DB;" | sort > /tmp/doris-tables.txt
  om_api GET "/tables?database=$SERVICE_NAME.default.$DB&limit=100" |
    python3 -c 'import sys,json
for t in json.load(sys.stdin).get("data", []):
    print(t["name"])' | sort > /tmp/om-tables.txt
  # 逐表列对账（列名集合比对；类型差异仅记录）
  while read -r T; do
    [ -n "$T" ] || continue
    "${MYSQL[@]}" -N -e "SHOW COLUMNS FROM $DB.$T;" | awk '{print $1}' | sort > /tmp/doris-cols.txt
    fetch_om_cols() {
      om_api GET "/tables/name/$SERVICE_NAME.default.$DB.$T?fields=columns" |
        python3 -c 'import sys,json
cols=json.load(sys.stdin).get("columns",[])
print("\n".join(c["name"] for c in cols))' | sort > /tmp/om-cols.txt
    }
    fetch_om_cols
    # OM 1.5 的 fields=columns 懒加载偶发空响应（实测与实体写入窗口相关）：
    # Doris 侧非空而 OM 侧为空时重取一次，仍空才判 FAIL。
    if [ ! -s /tmp/om-cols.txt ] && [ -s /tmp/doris-cols.txt ]; then
      sleep 2
      fetch_om_cols
    fi
    if diff -q /tmp/doris-cols.txt /tmp/om-cols.txt >/dev/null; then
      echo "  [PASS] $T 列一致（$(wc -l < /tmp/om-cols.txt | tr -d " ") 列）"
    else
      echo "  [FAIL] $T 列不一致："; diff /tmp/doris-cols.txt /tmp/om-cols.txt | sed 's/^/      /'
      FAIL=1
    fi
  done < /tmp/om-tables.txt
  DT=$(wc -l < /tmp/doris-tables.txt | tr -d ' ')
  OT=$(wc -l < /tmp/om-tables.txt | tr -d ' ')
  TOTAL_TABLES=$((TOTAL_TABLES + OT))
  echo "  表数：Doris=$DT OM=$OT"
  diff /tmp/doris-tables.txt /tmp/om-tables.txt >/dev/null || {
    echo '  表清单不一致：'; diff /tmp/doris-tables.txt /tmp/om-tables.txt | sed 's/^/    /'; FAIL=1; }
done
echo "三库合计 OM 表数：$TOTAL_TABLES"
[ "$FAIL" = 0 ] && echo '对账结论：PASS（三库表与列清单零差异）' || { echo '对账结论：FAIL'; exit 1; }
