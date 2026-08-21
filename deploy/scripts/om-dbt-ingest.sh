#!/usr/bin/env bash
# G7-1/G7-2 质量测试资产化（幂等）：在 quality-runner 容器生成 dbt
# manifest/catalog(/run_results)，建/更 OM Dbt 服务实体（dbt-quality-runner）
# 并摄取——dbt 测试转为 OM TestCase、source 表挂 DataModel。
# 详见 docs/dbt-lineage-g7-review-and-plan-20260822.md。
#
# 用法（部署机上）：
#   bash om-dbt-ingest.sh                 # 全流程（生成产物 + provision + 摄取 + 对账）
#   SKIP_TESTS=1 bash om-dbt-ingest.sh    # 不跑 dbt test（无 run_results，TestCase 无最近结果）
#   CHECK_ONLY=1 bash om-dbt-ingest.sh    # 只对账，不生成不写 OM
# 口令来源同 om-ingest-doris-assets.sh。产物宿主目录：DBT_ARTIFACTS_DIR。
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
. "$SCRIPT_DIR/load-dotenv.sh"
load_dotenv "${ENV_FILE:-$SCRIPT_DIR/../../.env}"

OM_SECRET="${DATAOS_OM_INGEST_CLIENT_SECRET:-}"
OM_INGEST_SECRET_FILE="${OM_INGEST_SECRET_FILE:-/root/.om-ingest-client-secret}"
if [ -z "$OM_SECRET" ] && [ -r "$OM_INGEST_SECRET_FILE" ]; then
  OM_SECRET=$(cat "$OM_INGEST_SECRET_FILE")
fi
[ -n "$OM_SECRET" ] || { echo "缺少 ingestion-bot client secret" >&2; exit 1; }

KEYCLOAK_TOKEN_URL="${KEYCLOAK_TOKEN_URL:-http://localhost:8180/auth/realms/data-platform/protocol/openid-connect/token}"
OM_API_BASE="${OM_API_BASE:-https://localhost:8445/api/v1}"
OM_NETWORK="${OM_NETWORK:-medical-platform_platform-net}"
INGESTION_IMAGE="${INGESTION_IMAGE:-openmetadata/ingestion:1.5.11}"
RUNNER_CONTAINER="${RUNNER_CONTAINER:-data-os-dev-quality-runner-1}"
DBT_PROJECT_DIR="${DBT_PROJECT_DIR:-/opt/dataos/quality/dbt}"
DBT_TARGET="${DBT_TARGET:-quality}"
DBT_ARTIFACTS_DIR="${DBT_ARTIFACTS_DIR:-/root/om-g7/artifacts}"
SERVICE_NAME="dbt-quality-runner"

om_api() {
  local method=$1 path=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -sk -X "$method" -H "Authorization: Bearer $OM_JWT" -H 'Content-Type: application/json' \
      -d "$body" "$OM_API_BASE$path"
  else
    curl -sk -X "$method" -H "Authorization: Bearer $OM_JWT" "$OM_API_BASE$path"
  fi
}

dbt_exec() { # dbt_exec ARGS...（容器内 target-path 固定 /tmp/om-g7-target）
  docker exec -w "$DBT_PROJECT_DIR" "$RUNNER_CONTAINER" \
    dbt "$@" --profiles-dir "$DBT_PROJECT_DIR" --target "$DBT_TARGET" \
    --target-path /tmp/om-g7-target --no-use-colors
}

echo '== 1/5 签发 ingestion-bot 令牌 =='
OM_JWT=$(curl -s -X POST "$KEYCLOAK_TOKEN_URL" \
  -d grant_type=client_credentials -d client_id=dataos-om-ingest \
  -d client_secret="$OM_SECRET" |
  python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
[ ${#OM_JWT} -gt 100 ] || { echo '令牌签发失败' >&2; exit 1; }
echo "token-len=${#OM_JWT}"

if [ "${CHECK_ONLY:-0}" != "1" ]; then
  echo '== 2/5 生成 dbt 产物（quality-runner 容器）=='
  # parse 不连库（manifest）；docs generate 只读连库（catalog）；
  # test 提供最近结果（不带 --store-failures，不写审计库）。
  dbt_exec parse | tail -2
  dbt_exec docs generate | tail -2
  RUN_RESULTS_LINE=""
  if [ "${SKIP_TESTS:-0}" != "1" ]; then
    if dbt_exec test; then :; fi
    RUN_RESULTS_LINE="        dbtRunResultsFilePath: /opt/dbt-artifacts/run_results.json"
  fi
  mkdir -p "$DBT_ARTIFACTS_DIR"
  docker exec "$RUNNER_CONTAINER" sh -c 'ls /tmp/om-g7-target/*.json' | sed 's|.*/||' | while read -r F; do
    docker cp "$RUNNER_CONTAINER:/tmp/om-g7-target/$F" "$DBT_ARTIFACTS_DIR/$F"
  done
  ls -la "$DBT_ARTIFACTS_DIR"
  for REQUIRED in manifest.json catalog.json; do
    [ -s "$DBT_ARTIFACTS_DIR/$REQUIRED" ] || { echo "缺少产物 $REQUIRED" >&2; exit 1; }
  done

  echo '== 3/5 服务 provision（幂等 upsert Dbt 服务实体）=='
  # Dbt 服务的 connection 是文件路径（ingestion 容器挂载点），无口令。
  CONNECTION=$(python3 - "$([ -s "$DBT_ARTIFACTS_DIR/run_results.json" ] && echo yes || echo no)" <<'PY'
import json, sys
config = {
    "type": "Dbt",
    "dbtConfigSource": {
        "dbtConfigType": "Local",
        "dbtManifestFilePath": "/opt/dbt-artifacts/manifest.json",
        "dbtCatalogFilePath": "/opt/dbt-artifacts/catalog.json",
    },
}
if sys.argv[1] == "yes":
    config["dbtConfigSource"]["dbtRunResultsFilePath"] = "/opt/dbt-artifacts/run_results.json"
print(json.dumps(config))
PY
)
  EXISTING=$(om_api GET "/services/databaseServices/name/$SERVICE_NAME")
  if echo "$EXISTING" | grep -q '"code":404'; then
    om_api POST /services/databaseServices "$(python3 -c "
import json,sys
print(json.dumps({'name':'$SERVICE_NAME','serviceType':'Dbt',
 'description':'quality-runner dbt 工程（质量测试资产化，G7）；产物由 om-dbt-ingest.sh 生成',
 'connection':{'config':json.loads(sys.argv[1])}}))" "$CONNECTION")" | head -c 200
    echo; echo "服务已创建：$SERVICE_NAME"
  else
    SERVICE_ID=$(echo "$EXISTING" | python3 -c 'import sys,json;print(json.load(sys.stdin)["id"])')
    curl -sk -X PATCH -H "Authorization: Bearer $OM_JWT" \
      -H 'Content-Type: application/json-patch+json' \
      -d "$(python3 -c "
import json,sys
print(json.dumps([{'op':'replace','path':'/connection/config',
 'value':json.loads(sys.argv[1])}]))" "$CONNECTION")" \
      "$OM_API_BASE/services/databaseServices/$SERVICE_ID" >/dev/null
    echo "服务已更新：$SERVICE_NAME"
  fi

  echo '== 4/5 摄取（Dbt connector → TestCase/DataModel）=='
  YAML=$(mktemp /tmp/om-dbt-XXXXXX.yaml)
  trap 'rm -f "$YAML"' EXIT
  chmod 600 "$YAML"
  # 渲染令牌与可选的 run_results 行（缩进敏感：RUN_RESULTS_LINE 已含 8 空格前导）。
  python3 - "$SCRIPT_DIR/../config/openmetadata/dbt-quality-runner-ingestion.yaml.template" \
    "$OM_JWT" "$RUN_RESULTS_LINE" "$YAML" <<'PY'
import sys
template, jwt, run_results_line, out = sys.argv[1:5]
text = template.replace("__OM_JWT__", jwt)
text = text.replace("__DBT_RUN_RESULTS_LINE__", run_results_line)
open(out, "w").write(text)
PY
  docker run --rm --user 0:0 --network "$OM_NETWORK" \
    -v "$YAML":/opt/ingest.yaml:ro -v "$DBT_ARTIFACTS_DIR":/opt/dbt-artifacts:ro \
    --entrypoint python3 "$INGESTION_IMAGE" -m metadata ingest -c /opt/ingest.yaml 2>&1 | tail -25
fi

echo '== 5/5 对账：dbt 测试数 vs OM TestCase =='
MANIFEST_TESTS=$(python3 -c '
import json
doc = json.load(open("'"$DBT_ARTIFACTS_DIR"'/manifest.json"))
nodes = doc.get("nodes", {})
print(sum(1 for n in nodes.values() if n.get("resource_type") == "test"))')
OM_TESTS=$(om_api GET "/testCases?limit=200" | python3 -c '
import sys, json
data = json.load(sys.stdin).get("data", [])
print(len(data))')
echo "dbt manifest 测试数：$MANIFEST_TESTS；OM TestCase 数：$OM_TESTS"
EP_EXPECT=4
EP_GOT=$(om_api GET "/testCases?limit=200" | python3 -c '
import sys, json
data = json.load(sys.stdin).get("data", [])
names = " ".join(t.get("name", "") + " " + t.get("fullyQualifiedName", "") for t in data)
for rule in ["quality_ep_edge_cfzb_id_unique", "quality_ep_edge_cfzb_id_not_null",
             "quality_ep_edge_cfzb_cfptzt_values", "quality_ep_edge_ypcfmx_cfzid_fk"]:
    print(rule, "OK" if rule in names else "MISSING")')
echo "$EP_GOT"
FAIL=0
[ "$MANIFEST_TESTS" = "$OM_TESTS" ] || { echo '测试数量不一致'; FAIL=1; }
echo "$EP_GOT" | grep -q MISSING && FAIL=1
[ "$FAIL" = 0 ] && echo '对账结论：PASS' || { echo '对账结论：FAIL'; exit 1; }
