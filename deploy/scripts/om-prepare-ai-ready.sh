#!/usr/bin/env bash
# G9-9 AI Ready 评估数据准备（幂等）：OpenMetadata 打 PII 标签 + 三库表描述。
# 使 pii_classification / semantic_documentation 探针有真实治理数据可评。
# 用法（部署机上）：bash om-prepare-ai-ready.sh
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

OM_JWT=$(curl -s -X POST "$KEYCLOAK_TOKEN_URL" \
  -d grant_type=client_credentials -d client_id=dataos-om-ingest \
  -d client_secret="$OM_SECRET" |
  python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
[ ${#OM_JWT} -gt 100 ] || { echo '令牌签发失败' >&2; exit 1; }
export OM_JWT

python3 <<'PY'
import json, os, ssl, sys, urllib.request

api = os.environ["OM_API_BASE"].rstrip("/")
jwt = os.environ["OM_JWT"]
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(api + path, data=data, method=method)
    req.add_header("Authorization", f"Bearer {jwt}")
    if data:
        req.add_header("Content-Type", "application/json-patch+json" if method == "PATCH"
                       else "application/json")
    with urllib.request.urlopen(req, context=ctx) as resp:
        text = resp.read().decode()
    return json.loads(text) if text else {}

# 1) 使用内置标签 PersonalData.Personal（OM 1.5 需要分类下的具体标签实例）
PERSONAL_FQN = "PersonalData.Personal"

# 2) mpi_source_identity 敏感列打标签（幂等：PATCH tags 以全量清单提交）
TABLE = "doris-dataos.default.dataos_mpi.mpi_source_identity"
PII_COLUMNS = ["name_norm", "card_no_norm", "contact_hash", "id_card_hash"]
table = call("GET", f"/tables/name/{TABLE}?fields=columns,tags")
table_id = table["id"]
# OM 的 JSON-Patch 对列数组按索引定位（列名会被误解析为数字 -> 500）
patch = []
for index, column in enumerate(table.get("columns", [])):
    if column["name"] in PII_COLUMNS:
        patch.append({"op": "add", "path": f"/columns/{index}/tags",
                      "value": [{"tagFQN": PERSONAL_FQN}]})
if patch:
    call("PATCH", f"/tables/{table_id}", patch)
    print(f"tagged {len(patch)} PII columns on {TABLE}")
else:
    print("PII columns already tagged (no patch needed)")

# 3) 三库业务表补中文描述（幂等：仅空描述时 PATCH）
DESCRIPTIONS = {
    "ods_ep": {
        "ep_mz_cfzb": "电子处方处方主表（DM 采集镜像；机构/患者/开方时间/状态）",
        "ep_mz_cfzb_inc": "电子处方主表增量镜像（UNIQUE KEY 幂等）",
        "ep_mz_ypcfmx": "电子处方药品明细表（药品编码/数量/用法）",
        "ep_mz_cfzb_edge": "处方主表边缘链路增量（前置机经中转桶落库；G5）",
        "ep_mz_ypcfmx_edge": "药品明细边缘链路增量（前置机经中转桶落库；G5）",
    },
    "dataos_quality_acceptance": {
        "quality_sample": "质量验收合成样本表（规则演示与验收口径）",
    },
    "dataos_mpi": {
        "mpi_source_identity": "MPI 源身份表（四段身份键 + 归一姓名 + 哈希联系方式）",
        "mpi_candidate_pair": "MPI 候选对表（Blocking 产出，确定性 pair_id）",
        "mpi_match_result": "MPI 匹配结果表（三态 + 硬冲突 + 逐字段证据）",
    },
}
described = 0
for schema, tables in DESCRIPTIONS.items():
    for name, description in tables.items():
        fqn = f"doris-dataos.default.{schema}.{name}"
        entity = call("GET", f"/tables/name/{fqn}")
        if str(entity.get("description") or "").strip():
            continue
        call("PATCH", f"/tables/{entity['id']}",
             [{"op": "add", "path": "/description", "value": description}])
        described += 1
print(f"described {described} tables")
print("AI Ready 数据准备完成")
PY
