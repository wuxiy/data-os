#!/usr/bin/env bash
# 受控智能问数服务身份种子（幂等，G26）：confidential client dataos-assistant-bff
# （serviceAccountsEnabled、标准流/直授全关）+ audience mapper（included client
# audience = dataos-data-api，即 data-api 资源侧 DATA_API_RESOURCE_AUDIENCE）。
# 控制面 assistant 模块以 client_credentials 取 token 调 data-api
# /internal/v1/verified-queries/**；只有 client secret 是秘密（回显一次，存
# 部署机 .env 的 DATAOS_ASSISTANT_OIDC_CLIENT_SECRET，0600 权限域）。
#
# 走 admin REST（kcadm 在 dev 实测认证不可靠，不用——同 keycloak-portal-seed.sh）。
#
# 用法（部署机上）：
#   KEYCLOAK_ADMIN_URL=http://localhost:8180/auth \
#   KEYCLOAK_ADMIN_PASSWORD=... SEED_REALM=data-platform \
#   bash keycloak-assistant-seed.sh
#
# 变量：
#   KEYCLOAK_ADMIN_URL      管理基址（dev 复用 Keycloak 为 legacy 前缀：
#                           http://localhost:8180/auth）
#   KEYCLOAK_ADMIN_USER     默认 admin
#   KEYCLOAK_ADMIN_PASSWORD 或 KEYCLOAK_ADMIN_PASSWORD_FILE（0600 文件）
#   SEED_REALM              默认 data-os（dev 传 data-platform）
#   ASSISTANT_CLIENT_ID     默认 dataos-assistant-bff
#   ASSISTANT_AUDIENCE      默认 dataos-data-api（= DATA_API_RESOURCE_AUDIENCE）
#   ASSISTANT_CLIENT_SECRET 缺省自动生成（仅创建时回显一次；已存在不覆盖，
#                           --rotate-secret 显式轮换）
#
# 幂等口径：client 由本脚本属主化（已存在时只补齐 service account 与 audience
# mapper，不重置 secret）。
set -euo pipefail

KEYCLOAK_ADMIN_URL="${KEYCLOAK_ADMIN_URL:-http://localhost:8080}"
KEYCLOAK_ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-}"
KEYCLOAK_ADMIN_PASSWORD_FILE="${KEYCLOAK_ADMIN_PASSWORD_FILE:-/root/.keycloak-admin-password}"
if [ -z "$KEYCLOAK_ADMIN_PASSWORD" ] && [ -r "$KEYCLOAK_ADMIN_PASSWORD_FILE" ]; then
  KEYCLOAK_ADMIN_PASSWORD=$(cat "$KEYCLOAK_ADMIN_PASSWORD_FILE")
fi
[ -n "$KEYCLOAK_ADMIN_PASSWORD" ] || { echo '缺少 Keycloak 管理口令（KEYCLOAK_ADMIN_PASSWORD 或 0600 文件）' >&2; exit 1; }

ROTATE_SECRET=0
for arg in "$@"; do
  case "$arg" in
    --rotate-secret) ROTATE_SECRET=1 ;;
    *) echo "未知参数: $arg" >&2; exit 1 ;;
  esac
done

export KEYCLOAK_ADMIN_URL KEYCLOAK_ADMIN_USER KEYCLOAK_ADMIN_PASSWORD ROTATE_SECRET
export SEED_REALM="${SEED_REALM:-data-os}"
export ASSISTANT_CLIENT_ID="${ASSISTANT_CLIENT_ID:-dataos-assistant-bff}"
export ASSISTANT_AUDIENCE="${ASSISTANT_AUDIENCE:-dataos-data-api}"
export ASSISTANT_CLIENT_SECRET="${ASSISTANT_CLIENT_SECRET:-}"

python3 - <<'PY'
import json
import os
import secrets
import sys
import urllib.parse
import urllib.request

ADMIN = os.environ["KEYCLOAK_ADMIN_URL"].rstrip("/")
REALM = os.environ["SEED_REALM"]
CLIENT_ID = os.environ["ASSISTANT_CLIENT_ID"]
AUDIENCE = os.environ["ASSISTANT_AUDIENCE"]
API = f"{ADMIN}/admin/realms/{urllib.parse.quote(REALM)}"


def call(method, url, payload=None, token=None, ok=(200, 201, 204)):
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request) as response:
        if response.status not in ok:
            raise SystemExit(f"{method} {url} -> {response.status}")
        body = response.read()
        return json.loads(body) if body else None


def admin_token():
    payload = urllib.parse.urlencode({
        "grant_type": "password",
        "client_id": "admin-cli",
        "username": os.environ["KEYCLOAK_ADMIN_USER"],
        "password": os.environ["KEYCLOAK_ADMIN_PASSWORD"],
    }).encode()
    request = urllib.request.Request(f"{ADMIN}/realms/master/protocol/openid-connect/token",
                                     data=payload,
                                     headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(request) as response:
        return json.loads(response.read())["access_token"]


token = admin_token()
existing = call("GET", f"{API}/clients?clientId={urllib.parse.quote(CLIENT_ID)}", token=token)
if existing:
    client = existing[0]
    client_uuid = client["id"]
    print(f"client 已存在: {CLIENT_ID} ({client_uuid})")
else:
    client_uuid = None

mapper = {
    "name": f"aud-{AUDIENCE}",
    "protocol": "openid-connect",
    "protocolMapper": "oidc-audience-mapper",
    "config": {
        "included.client.audience": AUDIENCE,
        "access.token.claim": "true",
        "id.token.claim": "false",
    },
}

if client_uuid is None:
    client_uuid = secrets.token_hex(16)  # 仅日志占位；真实 uuid 由 KC 分配
    created = call("POST", f"{API}/clients", {
        "clientId": CLIENT_ID,
        "enabled": True,
        "publicClient": False,
        "bearerOnly": False,
        "standardFlowEnabled": False,
        "directAccessGrantsEnabled": False,
        "serviceAccountsEnabled": True,
        "protocol": "openid-connect",
        "attributes": {"post.logout.redirect.uris": "+"},
    }, token=token)
    # POST /clients 无响应体：按 clientId 反查 uuid
    client_uuid = call("GET", f"{API}/clients?clientId={urllib.parse.quote(CLIENT_ID)}",
                       token=token)[0]["id"]
    print(f"client 已创建: {CLIENT_ID} ({client_uuid})")

# audience mapper 属主化（重名覆盖配置）
mappers = call("GET", f"{API}/clients/{client_uuid}/protocol-mappers/models", token=token)
known = next((item for item in mappers if item["name"] == mapper["name"]), None)
if known:
    call("PUT", f"{API}/clients/{client_uuid}/protocol-mappers/models/{known['id']}",
         {**mapper, "id": known["id"]}, token=token)
    print(f"audience mapper 已更新: {AUDIENCE}")
else:
    call("POST", f"{API}/clients/{client_uuid}/protocol-mappers/models", mapper, token=token)
    print(f"audience mapper 已创建: {AUDIENCE}")

# secret：创建时回显一次；已存在只在 --rotate-secret 时轮换
rotate = os.environ.get("ROTATE_SECRET") == "1"
if existing and not rotate:
    print("secret 已存在（未回显；轮换用 --rotate-secret）")
else:
    secret = os.environ.get("ASSISTANT_CLIENT_SECRET") or secrets.token_urlsafe(32)
    call("PUT", f"{API}/clients/{client_uuid}", {"secret": secret}, token=token)
    print(f"SECRET={secret}")
PY
