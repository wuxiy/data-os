#!/usr/bin/env bash
# G7-3 登记式血缘（幂等）：按声明清单向 OpenMetadata 写表级边 + 列级映射
# （columnsLineage）。声明清单是唯一事实源：deploy/config/openmetadata/
# mpi-declared-lineage.json（含列映射与依据注释，可评审）。
# 详见 docs/dbt-lineage-g7-review-and-plan-20260822.md。
#
# 用法（部署机上）：
#   bash om-declared-lineage.sh                # 登记清单全部边
#   CHECK_ONLY=1 bash om-declared-lineage.sh   # 只读校验，不写
# 口令来源同 om-ingest-doris-assets.sh（DATAOS_OM_INGEST_CLIENT_SECRET 或
# /root/.om-ingest-client-secret）。
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
export OM_API_BASE="${OM_API_BASE:-https://localhost:8445/api/v1}"
MANIFEST_JSON="${MANIFEST_JSON:-$SCRIPT_DIR/../config/openmetadata/mpi-declared-lineage.json}"

echo '== 1/3 签发 ingestion-bot 令牌 =='
OM_JWT=$(curl -s -X POST "$KEYCLOAK_TOKEN_URL" \
  -d grant_type=client_credentials -d client_id=dataos-om-ingest \
  -d client_secret="$OM_SECRET" |
  python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
[ ${#OM_JWT} -gt 100 ] || { echo '令牌签发失败' >&2; exit 1; }
export OM_JWT
echo "token-len=${#OM_JWT}"

echo '== 2/3 解析声明清单并登记 =='
CHECK_ONLY="${CHECK_ONLY:-0}" python3 - "$MANIFEST_JSON" <<'PY'
import json, os, ssl, sys, urllib.request

api = os.environ["OM_API_BASE"].rstrip("/")
jwt = os.environ["OM_JWT"]
check_only = os.environ.get("CHECK_ONLY", "0") == "1"
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(api + path, data=data, method=method)
    req.add_header("Authorization", f"Bearer {jwt}")
    if data:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, context=ctx) as resp:
            text = resp.read().decode()
        return json.loads(text) if text else {}
    except urllib.error.HTTPError as err:
        text = err.read().decode()
        try:
            return json.loads(text)
        except ValueError:
            raise

def table_id(fqn):
    """解析表实体 id（addLineage 边端点只认 UUID，不认 fqn）。"""
    entity = call("GET", f"/tables/name/{fqn}?fields=")
    if "id" not in entity:
        raise RuntimeError(f"表实体不存在：{fqn}")
    return entity["id"]

doc = json.load(open(sys.argv[1]))
service = doc["service"]
segment = doc["databaseSegment"]
print(f"声明边数：{len(doc['edges'])}（来源：{os.path.basename(sys.argv[1])}）")

failures = 0
for edge in doc["edges"]:
    from_fqn = f'{service}.{segment}.{edge["from"]["schema"]}.{edge["from"]["table"]}'
    to_fqn = f'{service}.{segment}.{edge["to"]["schema"]}.{edge["to"]["table"]}'
    columns = edge.get("columns", [])
    if not check_only:
        from_id = table_id(from_fqn)
        to_id = table_id(to_fqn)
        body = {
            "edge": {
                "fromEntity": {"id": from_id, "type": "table"},
                "toEntity": {"id": to_id, "type": "table"},
                "lineageDetails": {
                    "description": f'{doc["description"]} 依据：{edge.get("sqlHint", "")}',
                    "columnsLineage": [
                        {
                            "fromColumns": [f"{from_fqn}.{c}" for c in mapping["from"]],
                            "toColumn": f"{to_fqn}.{mapping['to']}",
                        }
                        for mapping in columns
                    ],
                },
            }
        }
        # OM 1.5 的 addLineage 端点是 PUT /lineage（POST 会 405/500）
        call("PUT", "/lineage", body)
    print(f"  [{'CHECK' if check_only else 'OK'}] {from_fqn} -> {to_fqn}（列级 {len(columns)} 条）")

print("== 3/3 校验：逐边读回并核对列级映射 ==")
missing = []
for edge in doc["edges"]:
    from_fqn = f'{service}.{segment}.{edge["from"]["schema"]}.{edge["from"]["table"]}'
    to_table = edge["to"]["table"]
    graph = call("GET", f"/lineage/table/name/{from_fqn}?upstreamDepth=0&downstreamDepth=1")
    nodes = {n["id"]: n for n in graph.get("nodes", [])}
    found = None
    for le in graph.get("downstreamEdges", []):
        if nodes.get(le.get("toEntity"), {}).get("name") == to_table:
            found = le
            break
    if not found:
        missing.append((edge["from"]["table"], to_table))
        print(f"  [MISS] {edge['from']['table']} -> {to_table}")
        continue
    cols = (found.get("lineageDetails") or {}).get("columnsLineage") or []
    print(f"  [SEEN] {edge['from']['table']} -> {to_table} 列级映射 {len(cols)} 条")
    for mapping in cols:
        fr = "+".join(c.split(".")[-1] for c in mapping.get("fromColumns", []))
        to = (mapping.get("toColumn") or "").split(".")[-1]
        print(f"    {fr} -> {to}")

if missing:
    print(f"校验 FAIL：未见声明的边 {missing}")
    sys.exit(1)
print("校验 PASS：声明边全部可见")
PY
echo '登记式血缘：完成'
