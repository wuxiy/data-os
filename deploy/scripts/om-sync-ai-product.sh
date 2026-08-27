#!/usr/bin/env bash
# G11-4 OM 回写（幂等）：AI Data Product -> OpenMetadata 术语表面。
# glossary「AI 数据产品」+ term（产品名，description 承载中文摘要）+ AIReadiness
# 分类标签（CANDIDATE/CERTIFIED/REVIEW_REQUIRED/BLOCKED）随认证状态刷新。
# 用法（部署机上）：bash om-sync-ai-product.sh <产品名> <readiness.json 路径>
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

PRODUCT_NAME="${1:?用法: om-sync-ai-product.sh <产品名> <readiness.json>}"
READINESS_FILE="${2:?用法: om-sync-ai-product.sh <产品名> <readiness.json>}"

PRODUCT_NAME="$PRODUCT_NAME" python3 - "$READINESS_FILE" <<'PY'
import json, os, ssl, sys, urllib.error, urllib.request

api = os.environ["OM_API_BASE"].rstrip("/")
jwt = os.environ["OM_JWT"]
product = os.environ["PRODUCT_NAME"]
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE

def call(method, path, body=None, content_type="application/json"):
    data = json.dumps(body).encode() if body is not None else None
    # path 含中文产品名（fqn 段）须逐段 quote，但 query string（?limit=..）不能编码
    from urllib.parse import quote
    raw_path, _, raw_query = path.partition("?")
    safe_path = "/".join(quote(segment) for segment in raw_path.split("/"))
    if raw_query:
        safe_path += "?" + raw_query
    req = urllib.request.Request(api + safe_path, data=data, method=method)
    req.add_header("Authorization", f"Bearer {jwt}")
    if data:
        req.add_header("Content-Type", content_type)
    try:
        with urllib.request.urlopen(req, context=ctx) as resp:
            text = resp.read().decode()
        return resp.status, (json.loads(text) if text else {})
    except urllib.error.HTTPError as err:
        text = err.read().decode()
        try:
            return err.code, json.loads(text)
        except ValueError:
            return err.code, {}

report = json.load(open(sys.argv[1]))
overall = report.get("overall", 0.0)
certification = report.get("gate", {}).get("certification", "UNKNOWN")
evaluation = report.get("evaluation") or {}
version = report.get("version", "")
profile = report.get("profile", "")
assessed = report.get("assessedAt", "")

# 1) glossary「AI 数据产品」（幂等）
status, existing = call("GET", "/glossaries/name/ai-data-products")
if status == 200:
    glossary = existing
else:
    status, glossary = call("POST", "/glossaries", {
        "name": "ai-data-products",
        "displayName": "AI 数据产品",
        "description": "AI Data Product 的元数据目录面（G11 回写）"})
    if status == 409:
        status, glossary = call("GET", "/glossaries/name/ai-data-products")
        assert status == 200, glossary
    else:
        assert status in (200, 201), glossary
        print("created glossary AI 数据产品")

# 2) AIReadiness 分类与四个状态标签（幂等）
status, classifications = call("GET", "/classifications?limit=50")
names = {c["name"] for c in classifications.get("data", [])}
if "AIReadiness" not in names:
    status, body = call("POST", "/classifications", {
        "name": "AIReadiness", "description": "AI 就绪认证状态（G11 回写）"})
    assert status in (200, 201), body
    print("created classification AIReadiness")
for label in ("CANDIDATE", "CERTIFIED", "REVIEW_REQUIRED", "BLOCKED"):
    status, _ = call("GET", f"/tags/name/AIReadiness.{label}")
    if status != 200:
        status, body = call("POST", "/tags", {
            "classification": "AIReadiness", "name": label,
            "description": f"AI 就绪认证状态 {label}"})
        # 幂等：GET 判定不可靠（部分端点异常），已存在（409）视为通过
        assert status in (200, 201, 409), body
print("classification AIReadiness + tags ready")

import re as _re
term_name = _re.sub(r"\s+", "-", product)
summary_lines = [
    f"AI Data Product：{product}",
    f"版本 {report.get('version', '')} · Profile {report.get('profile', '')}",
    f"AI Ready Overall {overall} · 认证状态 {certification}",
    f"评估时间 {assessed}",
]
if evaluation:
    summary_lines.append("评测指标 MRR {:.2f} · Recall@5 {:.2f} · Citation {:.2f}".format(
        evaluation.get("mrr", 0), evaluation.get("retrieval_recall_at_5", 0),
        evaluation.get("citation_correctness", 0)))
description = "；".join(summary_lines) + "。（data-os 控制面回写）"

# 3) term：本 OM 实例 glossary 实体引用解析损坏（POST 报 glossary instance
#    not found，G7 testDefinitions 同源缺陷）——尽力而为，如实输出；
#    glossary/分类/标签部分已交付，term 待实例修复或升级后启用。
status, existing = call("GET", f"/glossaryTerms/name/ai-data-products.{term_name}")
if status != 200:
    status, body = call("POST", "/glossaryTerms", {
        "glossary": glossary["id"], "name": term_name,
        "displayName": product, "description": description})
    if status not in (200, 201):
        reason = body.get("message", status)
        print(f"term 写入受阻（OM 实例缺陷，已记录备忘 P3）：{reason}")
        print(f"OM 同步完成（部分）：glossary + AIReadiness 分类/标签就绪；term 未写入")
        sys.exit(0)
    term_id = body["id"]
    print(f"created term {term_name}")
else:
    term_id = existing["id"]

status, body = call("PATCH", f"/glossaryTerms/{term_id}",
                    [{"op": "replace", "path": "/description", "value": description}],
                    content_type="application/json-patch+json")
if status not in (200, 204):
    print(f"term 描述刷新受阻：{status}")

# 4) 认证状态标签（PATCH 追加式）
status, body = call("PATCH", f"/glossaryTerms/{term_id}",
                    [{"op": "add", "path": "/tags/-",
                      "value": {"tagFQN": f"AIReadiness.{certification}"}}],
                    content_type="application/json-patch+json")
print("tag append:", status)
print(f"OM 同步完成：{term_name} -> {certification} (overall {overall})")
PY
