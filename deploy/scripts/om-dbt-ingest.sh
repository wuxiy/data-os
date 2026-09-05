#!/usr/bin/env bash
# G7-1/G7-2 质量测试资产化（幂等）：生成 dbt 产物并以 OM Dbt workflow
# （挂在 doris-dataos 服务上）摄取——dbt 测试转为 OM TestCase。
# 详见 docs/dbt-lineage-g7-review-and-plan-20260822.md。
#
# 产物版本（载荷性，2026-09-04 实测）：OM 1.6.0 的 dbt-artifacts-parser 原生
# 吃 dbt 1.10 的 manifest v12 / run-results v6，但拒收其 metadata 新增键
# （invocation_started_at / quoting，extra_forbidden）——剥离后直通。
# 1.5.11 时代的 dbt-1.7 双源降维链（v11/v5）已退役。catalog 由 dbt docs
# generate 产出并同法剥离（2026-09-05 补喂 DataModel 面，备忘 P3 残留小项）。
#
# 用法（部署机上）：
#   bash om-dbt-ingest.sh                 # 全流程（生成产物 + 摄取 + 对账）
#   SKIP_TESTS=1 bash om-dbt-ingest.sh    # 不跑 dbt test（无 run_results，TestCase 无最近结果）
#   CHECK_ONLY=1 bash om-dbt-ingest.sh    # 只对账，不生成不写 OM
# 口令来源同 om-ingest-doris-assets.sh。产物宿主目录：DBT_ARTIFACTS_DIR。
# 令牌时效：workflow 全量约 15 分钟，依赖 Keycloak per-client
# access.token.lifespan（dataos-om-ingest=1800s；realm 默认 300s 会在中途过期）。
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
INGESTION_IMAGE="${INGESTION_IMAGE:-openmetadata/ingestion:1.6.0}"
RUNNER_CONTAINER="${RUNNER_CONTAINER:-data-os-dev-quality-runner-1}"
DBT_PROJECT_DIR="${DBT_PROJECT_DIR:-/opt/dataos/quality/dbt}"
DBT_TARGET="${DBT_TARGET:-quality}"
DBT_ARTIFACTS_DIR="${DBT_ARTIFACTS_DIR:-/root/om-g7/artifacts}"

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
  echo '== 2/4 生成 dbt 原生产物（v12/v6 + 兼容性剥离）=='
  mkdir -p "$DBT_ARTIFACTS_DIR"

  # runner 原生 dbt 1.10 跑真实测试（连库），manifest/run_results 直接取自
  # target 目录。dbt 测试失败（数据质量 FAIL）不影响产物产出。
  RUN_RESULTS_LINE=""
  docker exec "$RUNNER_CONTAINER" sh -c "rm -rf /tmp/om-g7-target" 2>/dev/null || true
  if [ "${SKIP_TESTS:-0}" != "1" ]; then
    if dbt_exec test; then :; fi
    docker cp "$RUNNER_CONTAINER:/tmp/om-g7-target/run_results.json" "$DBT_ARTIFACTS_DIR/run_results.json"
    RUN_RESULTS_LINE="        dbtRunResultsFilePath: /opt/dbt-artifacts/run_results.json"
  fi
  # docs generate 连库产出 manifest + catalog（catalog 是 OM DataModel 的列信息
  # 来源；SKIP_TESTS 时由它一并承担 parse 职责）。ephemeral model 不进 catalog
  # 的 nodes 段（只物化关系入库），sources 段仍完整。
  if dbt_exec docs generate; then :; fi
  docker cp "$RUNNER_CONTAINER:/tmp/om-g7-target/manifest.json" "$DBT_ARTIFACTS_DIR/manifest.json"
  docker cp "$RUNNER_CONTAINER:/tmp/om-g7-target/catalog.json" "$DBT_ARTIFACTS_DIR/catalog.json"
  CATALOG_LINE="        dbtCatalogFilePath: /opt/dbt-artifacts/catalog.json"

  # OM 1.6.0 内置 dbt-artifacts-parser 拒收 dbt 1.10 的 metadata 新增键
  # （extra_forbidden，2026-09-04 实测），剥离后 v12/v6 直通。
  python3 - "$DBT_ARTIFACTS_DIR" <<'PY'
import json, sys
base = sys.argv[1]
for name, keys in (("manifest.json", ("invocation_started_at", "quoting")),
                   ("run_results.json", ("invocation_started_at",)),
                   ("catalog.json", ("invocation_started_at", "quoting"))):
    try:
        doc = json.load(open(f"{base}/{name}"))
    except FileNotFoundError:
        continue
    removed = [k for k in keys if doc.get("metadata", {}).pop(k, None) is not None]
    json.dump(doc, open(f"{base}/{name}", "w"))
    print(f"{name} scrubbed: {removed}")
PY

  ls -la "$DBT_ARTIFACTS_DIR"
  [ -s "$DBT_ARTIFACTS_DIR/manifest.json" ] || { echo "缺少产物 manifest.json" >&2; exit 1; }

  echo '== 3/4 摄取（Dbt connector → TestCase）=='
  # dbt test 与 workflow 全量耗时可观（实测合计 ~16 分钟），摄取前重签令牌。
  OM_JWT=$(issue_jwt)
  [ ${#OM_JWT} -gt 100 ] || { echo '令牌重签失败' >&2; exit 1; }
  # dbt 摄取不需要独立服务实体：workflow 挂在 doris-dataos 上，dbt 配置
  # （DbtLocalConfig，文件路径为 ingestion 容器挂载点）随 yaml 提供。
  YAML=$(mktemp /tmp/om-dbt-XXXXXX.yaml)
  # 留存最近一次渲染结果（排障用；600 权限，含令牌）
  trap 'cp "$YAML" /tmp/om-g7-last-rendered.yaml 2>/dev/null; chmod 600 /tmp/om-g7-last-rendered.yaml; rm -f "$YAML"' EXIT
  chmod 600 "$YAML"
  # 渲染令牌与可选的 run_results/catalog 行（缩进敏感：两行已含 8 空格前导）。
  python3 - "$SCRIPT_DIR/../config/openmetadata/dbt-quality-runner-ingestion.yaml.template" \
    "$OM_JWT" "$RUN_RESULTS_LINE" "$CATALOG_LINE" "$YAML" <<'PY'
import sys
template, jwt, run_results_line, catalog_line, out = sys.argv[1:6]
text = open(template).read().replace("__OM_JWT__", jwt)
text = text.replace("__DBT_RUN_RESULTS_LINE__", run_results_line)
text = text.replace("__DBT_CATALOG_LINE__", catalog_line)
open(out, "w").write(text)
PY
  docker run --rm --user 0:0 --network "$OM_NETWORK" \
    -v "$YAML":/opt/ingest.yaml:ro -v "$DBT_ARTIFACTS_DIR":/opt/dbt-artifacts:ro \
    --entrypoint python3 "$INGESTION_IMAGE" -m metadata ingest -c /opt/ingest.yaml 2>&1 | tail -25
fi

echo '== 4/4 对账：dbt 测试数 vs OM TestCase；dbt model 数 vs OM DataModel =='
# OM 1.6.0 的 TestCase 端点在 /dataQuality/testCases（/testCases 已 404）。
MANIFEST_TESTS=$(python3 -c '
import json
doc = json.load(open("'"$DBT_ARTIFACTS_DIR"'/manifest.json"))
nodes = doc.get("nodes", {})
print(sum(1 for n in nodes.values() if n.get("resource_type") == "test"))')
OM_TESTS=$(om_api GET "/dataQuality/testCases?limit=200" | python3 -c '
import sys, json
data = json.load(sys.stdin).get("data", [])
print(len(data))')
echo "dbt manifest 测试数：$MANIFEST_TESTS；OM TestCase 数：$OM_TESTS"
EP_GOT=$(om_api GET "/dataQuality/testCases?limit=200" | python3 -c '
import sys, json
data = json.load(sys.stdin).get("data", [])
names = " ".join(t.get("name", "") + " " + t.get("fullyQualifiedName", "") for t in data)
for rule in ["quality_ep_edge_cfzb_id_unique", "quality_ep_edge_cfzb_id_not_null",
             "quality_ep_edge_cfzb_cfptzt_values", "quality_ep_edge_ypcfmx_cfzid_fk"]:
    print(rule, "OK" if rule in names else "MISSING")')
echo "$EP_GOT"
FAIL=0
# OM 侧含历史 TestCase（G7 时代遗留），故以「不少于 manifest 测试数」为口径。
[ "$OM_TESTS" -ge "$MANIFEST_TESTS" ] || { echo '测试数量不足'; FAIL=1; }
echo "$EP_GOT" | grep -q MISSING && FAIL=1

# DataModel 面为信息项（不判 FAIL）：ephemeral model 不进 catalog nodes，
# OM 据此不建 DataModel——结构性 0 时如实报告，处置归备忘 P3。
MANIFEST_MODELS=$(python3 -c '
import json
doc = json.load(open("'"$DBT_ARTIFACTS_DIR"'/manifest.json"))
print(sum(1 for n in doc.get("nodes", {}).values() if n.get("resource_type") == "model"))')
CATALOG_NODES=$(python3 -c '
import json, os
path = "'"$DBT_ARTIFACTS_DIR"'/catalog.json"
print(len(json.load(open(path)).get("nodes", {})) if os.path.exists(path) else 0)')
OM_DATAMODELS=$(om_api GET "/dataModels?limit=1" | python3 -c '
import sys, json
print(json.load(sys.stdin).get("paging", {}).get("total", 0))')
echo "dbt manifest model 数：$MANIFEST_MODELS；catalog 物化节点数：$CATALOG_NODES；OM DataModel 数：$OM_DATAMODELS"
if [ "$OM_DATAMODELS" -lt "$MANIFEST_MODELS" ]; then
  echo '说明：DataModel 少于 manifest model 数——ephemeral model 无物化关系，不进 catalog（结构性，见备忘 P3）'
fi
[ "$FAIL" = 0 ] && echo '对账结论：PASS' || { echo '对账结论：FAIL'; exit 1; }
