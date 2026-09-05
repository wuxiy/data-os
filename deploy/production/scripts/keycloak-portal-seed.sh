#!/usr/bin/env bash
# 生产 ENFORCED 门户用户链种子（幂等）：7 个 realm 角色 + 门户公共客户端
# （Authorization Code + PKCE S256 强制、directAccessGrants 关闭、
# audience=data-os、tenant_id/institution_id user-attribute→token claim mapper），
# 可选 --with-demo-user 建验收用户。H2 未竟面收口（2026-09-05，归生产流程）。
#
# 角色清单与控制面 OidcSecurityConfiguration 的 hasAnyRole 矩阵一致；
# claim 名与 TenantScope（tenant_id/institution_id 顶层 claim）一致。
# 走 admin REST API（kcadm 在 dev 实测认证不可靠，不用）。
#
# 载荷性坑（2026-09-05 dev 实测，Keycloak 26.0.8）：
# 1. KC 24+ 默认声明式用户档案——未在 realm userProfile 声明的属性名会被
#    静默丢弃（连 admin PUT 也是）。脚本会幂等把 tenant_id/institution_id
#    声明为 admin-only 可选属性（旧版无该端点则跳过，未受管属性可直接存）。
# 2. users 端点 PUT 是整实体替换——部分字段 PUT 会抹掉其余字段（姓名/email
#    丢失会触发 VERIFY_PROFILE 拦截首登）。脚本对已存在用户一律 GET-merge-PUT。
# 3. 演示用户必须带 firstName/lastName/email（emailVerified），否则
#    VERIFY_PROFILE 必需动作拦住首次登录。
#
# 用法（部署机上，Keycloak 管理口可达）：
#   KEYCLOAK_ADMIN_URL=http://localhost:8080 \
#   PORTAL_REDIRECT_URIS="https://data-os.example.invalid/" \
#   bash keycloak-portal-seed.sh
#   # 追加验收用户（口令自动生成，只回显一次）：
#   bash keycloak-portal-seed.sh --with-demo-user
#
# 变量：
#   KEYCLOAK_ADMIN_URL      管理基址（默认 http://localhost:8080；
#                           dev 复用 Keycloak 为 legacy 前缀：http://localhost:8180/auth）
#   KEYCLOAK_ADMIN_USER     默认 admin
#   KEYCLOAK_ADMIN_PASSWORD 或 KEYCLOAK_ADMIN_PASSWORD_FILE（0600 文件，二选一）
#   SEED_REALM              默认 data-os（dev 验收传 data-platform）
#   PORTAL_CLIENT_ID        默认 data-os-portal
#   PORTAL_REDIRECT_URIS    空格分隔，必填；webOrigins 取各 URI 的 origin
#   DATAOS_AUDIENCE         默认 data-os（= 控制面 DATAOS_OIDC_AUDIENCE）
#   DEMO_USERNAME           默认 portal-demo
#   DEMO_PASSWORD           缺省自动生成（仅创建时使用并回显一次）
#   DEMO_ROLE               默认 viewer（种子角色之一）
#   DEMO_EMAIL              默认 portal-demo@data-os.local
#   DEMO_TENANT_ID          默认 default；生产命名租户另见 provision-named-tenant.sh
#   DEMO_INSTITUTION_ID     默认 demo-hospital
#
# 幂等口径：client 由本脚本属主化（已存在时重写 redirectUris/webOrigins/PKCE
# 属性与三只 mapper）；演示用户已存在时只补属性与角色映射，口令不覆盖
# （--reset-demo-password 显式重置）。
set -euo pipefail

KEYCLOAK_ADMIN_URL="${KEYCLOAK_ADMIN_URL:-http://localhost:8080}"
KEYCLOAK_ADMIN_USER="${KEYCLOAK_ADMIN_USER:-admin}"
KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:-}"
KEYCLOAK_ADMIN_PASSWORD_FILE="${KEYCLOAK_ADMIN_PASSWORD_FILE:-/root/.keycloak-admin-password}"
if [ -z "$KEYCLOAK_ADMIN_PASSWORD" ] && [ -r "$KEYCLOAK_ADMIN_PASSWORD_FILE" ]; then
  KEYCLOAK_ADMIN_PASSWORD=$(cat "$KEYCLOAK_ADMIN_PASSWORD_FILE")
fi
[ -n "$KEYCLOAK_ADMIN_PASSWORD" ] || { echo '缺少 Keycloak 管理口令（KEYCLOAK_ADMIN_PASSWORD 或 0600 文件）' >&2; exit 1; }

WITH_DEMO_USER=0
RESET_DEMO_PASSWORD=0
for arg in "$@"; do
  case "$arg" in
    --with-demo-user) WITH_DEMO_USER=1 ;;
    --reset-demo-password) RESET_DEMO_PASSWORD=1 ;;
    *) echo "未知参数: $arg" >&2; exit 1 ;;
  esac
done

export KEYCLOAK_ADMIN_URL KEYCLOAK_ADMIN_USER KEYCLOAK_ADMIN_PASSWORD
export SEED_REALM="${SEED_REALM:-data-os}" PORTAL_CLIENT_ID="${PORTAL_CLIENT_ID:-data-os-portal}"
export PORTAL_REDIRECT_URIS="${PORTAL_REDIRECT_URIS:-}" DATAOS_AUDIENCE="${DATAOS_AUDIENCE:-data-os}"
export WITH_DEMO_USER RESET_DEMO_PASSWORD
export DEMO_USERNAME="${DEMO_USERNAME:-portal-demo}" DEMO_PASSWORD="${DEMO_PASSWORD:-}" \
       DEMO_ROLE="${DEMO_ROLE:-viewer}" DEMO_EMAIL="${DEMO_EMAIL:-portal-demo@data-os.local}" \
       DEMO_TENANT_ID="${DEMO_TENANT_ID:-default}" \
       DEMO_INSTITUTION_ID="${DEMO_INSTITUTION_ID:-demo-hospital}"

python3 - <<'PY'
import json
import os
import secrets
import sys
import urllib.error
import urllib.parse
import urllib.request

ADMIN = os.environ["KEYCLOAK_ADMIN_URL"].rstrip("/")
REALM = os.environ["SEED_REALM"]
API = f"{ADMIN}/admin/realms/{urllib.parse.quote(REALM)}"

# 与 OidcSecurityConfiguration hasAnyRole 矩阵一致的角色全集
ROLES = ["platform-admin", "tenant-admin", "platform-operator",
         "data-engineer", "data-governance", "data-analyst", "viewer"]


def call(method, url, payload=None, token=None, ok=(200, 201, 204)):
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(url, data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            body = response.read().decode()
            return response.status, json.loads(body) if body.strip() else None
    except urllib.error.HTTPError as exc:
        return exc.code, exc.read().decode(errors="replace")


# ---- admin token ----
form = urllib.parse.urlencode({
    "grant_type": "password", "client_id": "admin-cli",
    "username": os.environ["KEYCLOAK_ADMIN_USER"],
    "password": os.environ["KEYCLOAK_ADMIN_PASSWORD"],
}).encode()
request = urllib.request.Request(f"{ADMIN}/realms/master/protocol/openid-connect/token", data=form)
try:
    with urllib.request.urlopen(request, timeout=15) as response:
        token = json.load(response)["access_token"]
except (urllib.error.URLError, KeyError) as exc:
    print(f"admin 登录失败: {exc}", file=sys.stderr)
    sys.exit(1)


def api(method, path, payload=None, ok=(200, 201, 204)):
    status, body = call(method, f"{API}{path}", payload, token)
    if status not in ok:
        print(f"调用失败 {method} {path}: HTTP {status}\n{body}", file=sys.stderr)
        sys.exit(1)
    return status, body


# ---- 1/5 realm 角色 ----
for role in ROLES:
    status, body = call("POST", f"{API}/roles", {"name": role}, token)
    if status == 201:
        print(f"角色已建: {role}")
    elif status == 409:
        print(f"角色在位: {role}")
    else:
        print(f"角色 {role} 失败: HTTP {status}\n{body}", file=sys.stderr)
        sys.exit(1)

# ---- 2/5 声明式用户档案（KC 24+：未声明属性名会被静默丢弃）----
# tenant_id/institution_id 声明为 admin-only 可选属性；旧版 Keycloak 无
# /users/profile 端点（404）时跳过——旧版未受管属性可直接存储。
profile_attributes = [
    {"name": "tenant_id", "displayName": "租户 ID",
     "permissions": {"view": ["admin"], "edit": ["admin"]}, "multivalued": False},
    {"name": "institution_id", "displayName": "机构 ID",
     "permissions": {"view": ["admin"], "edit": ["admin"]}, "multivalued": False},
]
status, body = call("GET", f"{API}/users/profile", None, token)
if status == 200 and body is not None:
    names = {item["name"] for item in body.get("attributes", [])}
    declared = [attribute for attribute in profile_attributes if attribute["name"] not in names]
    for attribute in declared:
        body.setdefault("attributes", []).append(attribute)
    if declared:
        status2, body2 = call("PUT", f"{API}/users/profile", body, token, ok=(200, 201, 204))
        if status2 not in (200, 201, 204):
            print(f"userProfile 更新失败: HTTP {status2}\n{body2}", file=sys.stderr)
            sys.exit(1)
        print(f"userProfile 已声明: {', '.join(a['name'] for a in declared)}")
    else:
        print("userProfile 在位（tenant_id/institution_id 已声明）")
elif status == 404:
    print("旧版 Keycloak（无 userProfile 端点）：未受管属性可直接存储，跳过声明")
else:
    print(f"userProfile 读取失败: HTTP {status}\n{body}", file=sys.stderr)
    sys.exit(1)

# ---- 3/5 门户公共客户端（属主化：存在则重写本脚本管理的字段） ----
redirect_uris = os.environ.get("PORTAL_REDIRECT_URIS", "").split()
if not redirect_uris:
    print("缺少 PORTAL_REDIRECT_URIS（门户完整 redirect URI，空格分隔）", file=sys.stderr)
    sys.exit(1)
web_origins = sorted({urllib.parse.urlsplit(uri).scheme + "://" + urllib.parse.urlsplit(uri).netloc
                      for uri in redirect_uris})
audience = os.environ["DATAOS_AUDIENCE"]
client_id = os.environ["PORTAL_CLIENT_ID"]

managed = {
    "publicClient": True,
    "standardFlowEnabled": True,
    "implicitFlowEnabled": False,
    "directAccessGrantsEnabled": False,
    "serviceAccountsEnabled": False,
    "redirectUris": redirect_uris,
    "webOrigins": web_origins,
    "attributes": {"pkce.code.challenge.method": "S256"},
}

_, body = api("GET", f"/clients?clientId={urllib.parse.quote(client_id)}")
existing = (body or [None])[0]
if existing is None:
    api("POST", "/clients", {
        "clientId": client_id,
        "name": "data-os Portal",
        "description": "门户公共客户端：Authorization Code + PKCE S256（keycloak-portal-seed.sh 属主）",
        "enabled": True,
        "protocol": "openid-connect",
        **managed,
    })
    _, body = api("GET", f"/clients?clientId={urllib.parse.quote(client_id)}")
    existing = body[0]
    print(f"客户端已建: {client_id}")
else:
    merged = {**existing, **managed}
    attributes = {**(existing.get("attributes") or {}), **managed["attributes"]}
    merged["attributes"] = attributes
    api("PUT", f"/clients/{existing['id']}", merged)
    print(f"客户端在位（已按属主清单重写）: {client_id}")
client_uuid = existing["id"]

# ---- 4/5 客户端 mapper（audience + 租户双 claim）----
mappers = [
    {
        "name": f"audience-{audience}",
        "protocol": "openid-connect",
        "protocolMapper": "oidc-audience-mapper",
        "config": {"included.client.audience": audience,
                   "access.token.claim": "true", "id.token.claim": "false"},
    },
    {
        "name": "tenant-id",
        "protocol": "openid-connect",
        "protocolMapper": "oidc-usermodel-attribute-mapper",
        "config": {"user.attribute": "tenant_id", "claim.name": "tenant_id",
                   "jsonType.label": "String", "always.include.in.access.token": "true",
                   "access.token.claim": "true", "id.token.claim": "true",
                   "userinfo.token.claim": "true"},
    },
    {
        "name": "institution-id",
        "protocol": "openid-connect",
        "protocolMapper": "oidc-usermodel-attribute-mapper",
        "config": {"user.attribute": "institution_id", "claim.name": "institution_id",
                   "jsonType.label": "String", "always.include.in.access.token": "true",
                   "access.token.claim": "true", "id.token.claim": "true",
                   "userinfo.token.claim": "true"},
    },
]
_, body = api("GET", f"/clients/{client_uuid}/protocol-mappers/models")
known = {item["name"]: item["id"] for item in (body or [])}
for mapper in mappers:
    if mapper["name"] in known:
        api("PUT", f"/clients/{client_uuid}/protocol-mappers/models/{known[mapper['name']]}",
            {**mapper, "id": known[mapper["name"]]})
        print(f"mapper 在位（已刷新）: {mapper['name']}")
    else:
        api("POST", f"/clients/{client_uuid}/protocol-mappers/models", mapper)
        print(f"mapper 已建: {mapper['name']}")

# ---- 5/5 验收用户（可选）----
if os.environ.get("WITH_DEMO_USER") == "1":
    username = os.environ["DEMO_USERNAME"]
    role = os.environ["DEMO_ROLE"]
    if role not in ROLES:
        print(f"DEMO_ROLE={role} 不在种子角色清单内", file=sys.stderr)
        sys.exit(1)
    attributes = {"tenant_id": [os.environ["DEMO_TENANT_ID"]],
                  "institution_id": [os.environ["DEMO_INSTITUTION_ID"]]}
    _, body = api("GET", f"/users?username={urllib.parse.quote(username)}&exact=true")
    users = body or []
    if not users:
        password = os.environ.get("DEMO_PASSWORD") or secrets.token_urlsafe(16)
        # 姓名/email 必带：缺省会触发 VERIFY_PROFILE 拦住首次登录（KC 26 实测）。
        api("POST", "/users", {
            "username": username, "enabled": True, "attributes": attributes,
            "firstName": "Portal", "lastName": "Demo",
            "email": os.environ["DEMO_EMAIL"], "emailVerified": True,
            "credentials": [{"type": "password", "value": password, "temporary": False}],
        })
        _, body = api("GET", f"/users?username={urllib.parse.quote(username)}&exact=true")
        print(f"演示用户已建: {username}（角色 {role}）口令: {password} —— 仅此一次回显")
    else:
        user = users[0]
        # users PUT 是整实体替换：必须 GET-merge-PUT，部分字段 PUT 会抹掉其余字段。
        merged = dict(user)
        merged["attributes"] = {**(user.get("attributes") or {}), **attributes}
        api("PUT", f"/users/{user['id']}", merged)
        print(f"演示用户在位（属性已补）: {username}")
        if os.environ.get("RESET_DEMO_PASSWORD") == "1":
            password = os.environ.get("DEMO_PASSWORD") or secrets.token_urlsafe(16)
            api("PUT", f"/users/{user['id']}/reset-password",
                {"type": "password", "value": password, "temporary": False})
            print(f"口令已重置: {password} —— 仅此一次回显")
    _, body = api("GET", f"/users?username={urllib.parse.quote(username)}&exact=true")
    user_uuid = body[0]["id"]
    _, body = api("GET", f"/users/{user_uuid}/role-mappings/realm")
    held = {item["name"] for item in (body or [])}
    _, body = api("GET", f"/roles/{role}")
    if role not in held:
        api("POST", f"/users/{user_uuid}/role-mappings/realm", [body])
    print(f"角色映射在位: {username} → {role}")

print("种子完成（幂等，可重复执行）")
PY
