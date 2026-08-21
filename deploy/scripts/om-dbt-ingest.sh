#!/usr/bin/env bash
# G7-1/G7-2 质量测试资产化（幂等）：生成 OM 1.5.11 兼容的 dbt 产物并以
# OM Dbt workflow（挂在 doris-dataos 服务上）摄取——dbt 测试转为 OM
# TestCase、source 表挂 DataModel。详见 docs/dbt-lineage-g7-review-and-plan-20260822.md。
#
# 产物版本兼容（载荷性，实测）：OM 1.5.11 的 dbt_artifacts_parser 只吃到
# manifest v11 / run-results v5；quality-runner 镜像的 dbt 1.10 产 v12/v6。
# 策略分源生成——manifest/catalog 用临时容器 dbt-core 1.7（dbt-mysql 连
# Doris，工程 yml 副本经 dbt-compat-yml-downgrade.py 降级），run_results 用
# runner 原生 dbt 1.10 跑（真实结果）再经 dbt-compat-rr-downgrade.py 转 v5。
#
# 用法（部署机上）：
#   bash om-dbt-ingest.sh                 # 全流程（生成产物 + 摄取 + 对账）
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
DBT17_IMAGE="${DBT17_IMAGE:-python:3.12.8-slim}"

om_api() {
  local method=$1 path=$2 body=${3:-}
  if [ -n "$body" ]; then
    curl -sk -X "$method" -H "Authorization: Bearer $OM_JWT" -H 'Content-Type: application/json' \
      -d "$body" "$OM_API_BASE$path"
  else
    curl -sk -X "$method" -H "Authorization: Bearer $OM_JWT" "$OM_API_BASE$path"
  fi
}

dbt_exec() { # dbt_exec ARGS...（runner 容器内 target-path 固定 /tmp/om-g7-target）
  docker exec -w "$DBT_PROJECT_DIR" "$RUNNER_CONTAINER" \
    dbt "$@" --profiles-dir "$DBT_PROJECT_DIR" --target "$DBT_TARGET" \
    --target-path /tmp/om-g7-target --no-use-colors
}

# 从 runner 容器提取 dbt 账号环境（生成容器与 runner 同库同账号）。
DBT_ENV_ARGS=( )
for VAR in DORIS_FE_HOST DORIS_FE_PORT DORIS_DBT_USER DORIS_DBT_PASSWORD DORIS_DATABASE DORIS_EP_DATABASE; do
  VAL=$(docker inspect "$RUNNER_CONTAINER" --format "{{range .Config.Env}}{{println .}}{{end}}" |
    grep "^${VAR}=" | cut -d= -f2- || true)
  DBT_ENV_ARGS+=(-e "$VAR=$VAL")
done

issue_jwt() {
  curl -s -X POST "$KEYCLOAK_TOKEN_URL" \
    -d grant_type=client_credentials -d client_id=dataos-om-ingest \
    -d client_secret="$OM_SECRET" |
    python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])'
}

echo '== 1/4 签发 ingestion-bot 令牌 =='
OM_JWT=$(issue_jwt)
[ ${#OM_JWT} -gt 100 ] || { echo '令牌签发失败' >&2; exit 1; }
echo "token-len=${#OM_JWT}"

if [ "${CHECK_ONLY:-0}" != "1" ]; then
  echo '== 2/4 生成 OM 兼容 dbt 产物（分源）=='
  mkdir -p "$DBT_ARTIFACTS_DIR"

  # (a) 临时容器 dbt-core 1.7 + dbt-mysql：manifest v11（parse 不连库）+
  #     catalog v1（docs generate 只读连库；Doris 兼容 MySQL 协议）。
  #     工程 yml 副本先降级（data_tests->tests、arguments 平铺）。
  rm -rf /tmp/om-g7-project /tmp/om-g17-target && mkdir -p /tmp/om-g17-target
  docker cp "$RUNNER_CONTAINER:$DBT_PROJECT_DIR" /tmp/om-g7-project
  docker run --rm --network "$OM_NETWORK" "${DBT_ENV_ARGS[@]}" \
    -e DATAOS_TEST_NAMESPACE=om-g7 \
    -v /tmp/om-g7-project:/work:ro \
    -v "$SCRIPT_DIR/dbt-compat-yml-downgrade.py":/downgrade.py:ro \
    -v /tmp/om-g17-target:/tmp/t \
    "$DBT17_IMAGE" sh -c '
      pip -q install "dbt-mysql==1.7.0" "pyyaml" >/dev/null 2>&1
      mkdir -p /gen && cp -r /work/models /work/macros /work/dbt_project.yml /gen/
      python3 /downgrade.py /gen
      printf "dataos_quality:\n  target: quality\n  outputs:\n    quality:\n      type: mysql\n      server: \"%s\"\n      port: %s\n      username: \"%s\"\n      password: \"%s\"\n      schema: \"%s\"\n      threads: 1\n" \
        "$DORIS_FE_HOST" "${DORIS_FE_PORT:-9030}" "$DORIS_DBT_USER" "$DORIS_DBT_PASSWORD" "${DORIS_DATABASE:-dataos_quality_acceptance}" > /tmp/profiles.yml
      cd /gen
      dbt parse --profiles-dir /tmp --target quality --target-path /tmp/t 2>&1 | tail -1
      dbt docs generate --profiles-dir /tmp --target quality --target-path /tmp/t 2>&1 | tail -1
    '
  cp /tmp/om-g17-target/manifest.json "$DBT_ARTIFACTS_DIR/manifest.json"
  cp /tmp/om-g17-target/catalog.json "$DBT_ARTIFACTS_DIR/catalog.json"
  rm -rf /tmp/om-g7-project /tmp/om-g17-target

  # (b) runner 原生 dbt 1.10 跑真实测试（连库，产出 v6），再降维 v5。
  RUN_RESULTS_LINE=""
  if [ "${SKIP_TESTS:-0}" != "1" ]; then
    docker exec "$RUNNER_CONTAINER" sh -c "rm -rf /tmp/om-g7-target" 2>/dev/null || true
    if dbt_exec test; then :; fi
    docker cp "$RUNNER_CONTAINER:/tmp/om-g7-target/run_results.json" "$DBT_ARTIFACTS_DIR/run_results.json"
    python3 "$SCRIPT_DIR/dbt-compat-rr-downgrade.py" "$DBT_ARTIFACTS_DIR/run_results.json"
    RUN_RESULTS_LINE="        dbtRunResultsFilePath: /opt/dbt-artifacts/run_results.json"
  fi

  ls -la "$DBT_ARTIFACTS_DIR"
  for REQUIRED in manifest.json catalog.json; do
    [ -s "$DBT_ARTIFACTS_DIR/$REQUIRED" ] || { echo "缺少产物 $REQUIRED" >&2; exit 1; }
  done

  echo '== 3/4 摄取（Dbt connector → TestCase/DataModel）=='
  # 产物生成含 pip install 与多轮降维迭代，耗时可能超过 token TTL
  # （实测 Expired token!），摄取前重签。
  OM_JWT=$(issue_jwt)
  [ ${#OM_JWT} -gt 100 ] || { echo '令牌重签失败' >&2; exit 1; }
  # OM 1.5 的 dbt 摄取不需要独立服务实体：workflow 挂在 doris-dataos 上，
  # dbt 配置（DbtLocalConfig，文件路径为 ingestion 容器挂载点）随 yaml 提供。
  YAML=$(mktemp /tmp/om-dbt-XXXXXX.yaml)
  # 留存最近一次渲染结果（排障用；600 权限，含令牌）
  trap 'cp "$YAML" /tmp/om-g7-last-rendered.yaml 2>/dev/null; chmod 600 /tmp/om-g7-last-rendered.yaml; rm -f "$YAML"' EXIT
  chmod 600 "$YAML"
  # 渲染令牌与可选的 run_results 行（缩进敏感：RUN_RESULTS_LINE 已含 8 空格前导）。
  python3 - "$SCRIPT_DIR/../config/openmetadata/dbt-quality-runner-ingestion.yaml.template" \
    "$OM_JWT" "$RUN_RESULTS_LINE" "$YAML" <<'PY'
import sys
template, jwt, run_results_line, out = sys.argv[1:5]
text = open(template).read().replace("__OM_JWT__", jwt)
text = text.replace("__DBT_RUN_RESULTS_LINE__", run_results_line)
open(out, "w").write(text)
PY
  docker run --rm --user 0:0 --network "$OM_NETWORK" \
    -v "$YAML":/opt/ingest.yaml:ro -v "$DBT_ARTIFACTS_DIR":/opt/dbt-artifacts:ro \
    --entrypoint python3 "$INGESTION_IMAGE" -m metadata ingest -c /opt/ingest.yaml 2>&1 | tail -25
fi

echo '== 4/4 对账：dbt 测试数 vs OM TestCase =='
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
