#!/usr/bin/env bash
# Keycloak 服务间认证种子（G2G 批次 7；B 组收口增 MPI 投影链）：realm client
# scopes（quality:*）+ 服务 client 六个的幂等补件。已存在的 client 只补缺失件
# （scopes/mappers/service account/读侧角色），不重建、不换 secret——.env 是
# secret 唯一属主。新建 client 的 secret 缺省时生成并仅在创建时回显一次
# （沿用 portal seed 惯例）。
#
# 用法（在能访问 Keycloak Admin 的机器上）：
#   KEYCLOAK_ADMIN_URL=http://keycloak:8080/auth \
#   KEYCLOAK_ADMIN_USER=... KEYCLOAK_ADMIN_PASSWORD=... SEED_REALM=data-platform \
#   ./keycloak-service-seed.sh
# 可选 env：QUALITY_CLIENT_ID/QUALITY_CLIENT_SECRET、AI_READY_CLIENT_ID、
#   ASSISTANT_CLIENT_ID、DATA_API_CLIENT_ID、OM_INGEST_CLIENT_ID、
#   MPI_CLIENT_ID/MPI_CLIENT_SECRET/MPI_READ_ROLE、
#   SEED_TENANT_ID、SEED_INSTITUTION_ID。
set -euo pipefail

KEYCLOAK_ADMIN_URL="${KEYCLOAK_ADMIN_URL:?需要 KEYCLOAK_ADMIN_URL（如 http://keycloak:8080/auth）}"
SEED_REALM="${SEED_REALM:?需要 SEED_REALM}"
KEYCLOAK_ADMIN_USER="${KEYCLOAK_ADMIN_USER:?需要 KEYCLOAK_ADMIN_USER}"
KEYCLOAK_ADMIN_PASSWORD="${KEYCLOAK_ADMIN_PASSWORD:?需要 KEYCLOAK_ADMIN_PASSWORD}"

export KEYCLOAK_ADMIN_URL SEED_REALM KEYCLOAK_ADMIN_USER KEYCLOAK_ADMIN_PASSWORD

python3 - <<'PYEOF'
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

TENANT = os.environ.get("SEED_TENANT_ID", "default")
INSTITUTION = os.environ.get("SEED_INSTITUTION_ID", "demo-hospital")

QUALITY_CLIENT = os.environ.get("QUALITY_CLIENT_ID", "dataos-control-plane-quality")
AI_READY_CLIENT = os.environ.get("AI_READY_CLIENT_ID", "dataos-ai-ready")
ASSISTANT_CLIENT = os.environ.get("ASSISTANT_CLIENT_ID", "dataos-assistant-bff")
DATA_API_CLIENT = os.environ.get("DATA_API_CLIENT_ID", "dataos-data-api")
OM_INGEST_CLIENT = os.environ.get("OM_INGEST_CLIENT_ID", "dataos-om-ingest")
MPI_CLIENT = os.environ.get("MPI_CLIENT_ID", "dataos-control-plane-mpi")
# MPI ENFORCED 读侧（GET /api/v1/mpi/**）最小角色；只读投影不给写侧。
MPI_READ_ROLE = os.environ.get("MPI_READ_ROLE", "viewer")

QUALITY_SCOPES = ["quality:submit", "quality:read", "quality:admin"]


def call(method, url, payload=None, token=None):
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


def find_client(client_id):
    _, body = api("GET", f"/clients?clientId={urllib.parse.quote(client_id)}")
    return body[0] if body else None


def ensure_client_scope(name):
    status, _ = call("POST", f"{API}/client-scopes", {"name": name, "protocol": "openid-connect"}, token)
    if status == 201:
        print(f"client scope 已建: {name}")
    elif status == 409:
        print(f"client scope 在位: {name}")
    else:
        print(f"client scope {name} 失败: HTTP {status}", file=sys.stderr)
        sys.exit(1)


def scope_uuid(name):
    # Admin REST 无按名查询端点（{id} 是 UUID）：列表匹配。
    _, body = api("GET", "/client-scopes")
    for item in body:
        if item["name"] == name:
            return item["id"]
    raise SystemExit(f"client scope 未找到: {name}")


def ensure_default_client_scope(client_uuid, scope_name):
    _, existing = api("GET", f"/clients/{client_uuid}/default-client-scopes")
    if any(item["name"] == scope_name for item in existing):
        print(f"  默认 scope 在位: {scope_name}")
        return
    api("PUT", f"/clients/{client_uuid}/default-client-scopes/{scope_uuid(scope_name)}")
    print(f"  默认 scope 已挂: {scope_name}")


def ensure_audience_mapper(client_uuid, client_id, audience):
    _, mappers = api("GET", f"/clients/{client_uuid}/protocol-mappers/models")
    name = f"audience-{audience}"
    if any(item.get("name") == name for item in mappers):
        print(f"  audience mapper 在位: {audience}")
        return
    api("POST", f"/clients/{client_uuid}/protocol-mappers/models", {
        "name": name,
        "protocol": "openid-connect",
        "protocolMapper": "oidc-audience-mapper",
        "config": {"included.client.audience": audience,
                   "access.token.claim": "true", "id.token.claim": "false"},
    })
    print(f"  audience mapper 已加: {audience}")


def ensure_claim_mapper(client_uuid, claim, value):
    name = f"hardcode-{claim}"
    _, mappers = api("GET", f"/clients/{client_uuid}/protocol-mappers/models")
    if any(item.get("name") == name for item in mappers):
        print(f"  claim mapper 在位: {claim}")
        return
    api("POST", f"/clients/{client_uuid}/protocol-mappers/models", {
        "name": name,
        "protocol": "openid-connect",
        "protocolMapper": "oidc-hardcoded-claim-mapper",
        "config": {
            "claim.name": claim,
            "claim.value": value,
            "jsonType.label": "String",
            "id.token.claim": "false",
            "access.token.claim": "true",
            "userinfo.token.claim": "false",
        },
    })
    print(f"  claim mapper 已加: {claim}={value}")


def ensure_service_account(client_uuid):
    _, client = api("GET", f"/clients/{client_uuid}")
    if not client.get("serviceAccountsEnabled"):
        api("PUT", f"/clients/{client_uuid}", {**client, "serviceAccountsEnabled": True})
        print("  service account 已启用")
    else:
        print("  service account 在位")


def ensure_realm_role(name):
    status, _ = call("POST", f"{API}/roles", {"name": name}, token)
    if status == 201:
        print(f"realm 角色已建: {name}")
    elif status == 409:
        print(f"realm 角色在位: {name}")
    else:
        print(f"realm 角色 {name} 失败: HTTP {status}", file=sys.stderr)
        sys.exit(1)


def ensure_service_account_role(client_uuid, role):
    _, user = api("GET", f"/clients/{client_uuid}/service-account-user")
    _, existing = api("GET", f"/users/{user['id']}/role-mappings/realm")
    if any(item.get("name") == role for item in existing):
        print(f"  服务账号角色在位: {role}")
        return
    _, roles = api("GET", "/roles")
    role_id = next((item["id"] for item in roles if item.get("name") == role), None)
    if role_id is None:
        raise SystemExit(f"realm 角色未找到: {role}")
    api("POST", f"/users/{user['id']}/role-mappings/realm", [{"id": role_id, "name": role}])
    print(f"  服务账号角色已挂: {role}")


def create_client(client_id, secret=None, public=False):
    payload = {
        "clientId": client_id,
        "enabled": True,
        "protocol": "openid-connect",
        "publicClient": public,
        "serviceAccountsEnabled": not public,
        "standardFlowEnabled": False,
        "directAccessGrantsEnabled": False,
    }
    if secret:
        payload["secret"] = secret
    api("POST", "/clients", payload)
    print(f"服务 client 已建: {client_id}")


print("== 1/4 realm client scopes ==")
for scope in QUALITY_SCOPES:
    ensure_client_scope(scope)

print("== 2/4 控制面→质量执行器 client（quality 链，全新装配）==")
quality_secret = os.environ.get("QUALITY_CLIENT_SECRET")
existing = find_client(QUALITY_CLIENT)
if existing is None:
    generated = quality_secret or secrets.token_urlsafe(32)
    create_client(QUALITY_CLIENT, secret=generated)
    if not quality_secret:
        print(f"  ⚠ secret 已生成（仅此一次回显，请写入 .env 的 DATAOS_QUALITY_OIDC_CLIENT_SECRET）:")
        print(f"  {generated}")
    existing = find_client(QUALITY_CLIENT)
else:
    print(f"client 在位（不换 secret）: {QUALITY_CLIENT}")
ensure_service_account(existing["id"])
for scope in QUALITY_SCOPES:
    ensure_default_client_scope(existing["id"], scope)
ensure_audience_mapper(existing["id"], QUALITY_CLIENT, "dataos-quality-runner")
ensure_claim_mapper(existing["id"], "tenant_id", TENANT)
ensure_claim_mapper(existing["id"], "institution_id", INSTITUTION)

print("== 3/4 其余服务 client（在位只补件，缺位按模板建）==")
# 调用方→被调方 audience（代码证据：ai-ready 校验 aud=dataos-ai-ready；
# 问数 BFF 校验 aud=dataos-data-api）。
for client_id, audience in (
    (AI_READY_CLIENT, "dataos-ai-ready"),
    (ASSISTANT_CLIENT, "dataos-data-api"),
):
    client = find_client(client_id)
    if client is None:
        create_client(client_id)
        print(f"  ⚠ 新建 {client_id}：请在 Keycloak 为其设置 secret 并同步 .env")
        client = find_client(client_id)
    else:
        print(f"client 在位（不换 secret）: {client_id}")
    ensure_service_account(client["id"])
    ensure_audience_mapper(client["id"], client_id, audience)

# 出站调用 client（data-api 指标投影、ai-ready OM 摄取）：只确保存在与
# service account，OM/Superset 侧 audience 由被调方配置决定，不臆造。
for client_id in (DATA_API_CLIENT, OM_INGEST_CLIENT):
    client = find_client(client_id)
    if client is None:
        create_client(client_id)
        print(f"  ⚠ 新建 {client_id}：请在 Keycloak 为其设置 secret 并同步 .env")
        client = find_client(client_id)
    else:
        print(f"client 在位（不换 secret）: {client_id}")
    ensure_service_account(client["id"])

# B3 彩排实抓：data-api 的 registry 回链（控制面 /internal/data-api/**，
# audience=data-os 全局校验）——全新 realm 无 H2 时代手工遗产，必须由种子
# 装配 aud mapper，否则生产上线 registry 401 → data-api 503。
data_api = find_client(DATA_API_CLIENT)
ensure_audience_mapper(data_api["id"], DATA_API_CLIENT, "data-os")

print("== 4/4 控制面→MPI 投影 client（aud=data-os-mpi + 读侧角色 + 租户 claims）==")
# MPI ENFORCED 的 GET /api/v1/mpi/** 允许 viewer——只读指标投影的最小角色；
# 角色幂等自建，未跑 portal seed 的 realm 也能装配。TenantScope 要求 token
# 带 tenant_id/institution_id（缺任一 403），与 quality client 同款硬编码。
ensure_realm_role(MPI_READ_ROLE)
mpi_secret = os.environ.get("MPI_CLIENT_SECRET")
client = find_client(MPI_CLIENT)
if client is None:
    generated = mpi_secret or secrets.token_urlsafe(32)
    create_client(MPI_CLIENT, secret=generated)
    if not mpi_secret:
        print("  ⚠ secret 已生成（仅此一次回显，请写入 .env 的 DATAOS_OPERATIONS_MPI_OIDC_CLIENT_SECRET）:")
        print(f"  {generated}")
    client = find_client(MPI_CLIENT)
else:
    print(f"client 在位（不换 secret）: {MPI_CLIENT}")
ensure_service_account(client["id"])
ensure_audience_mapper(client["id"], MPI_CLIENT, "data-os-mpi")
ensure_claim_mapper(client["id"], "tenant_id", TENANT)
ensure_claim_mapper(client["id"], "institution_id", INSTITUTION)
ensure_service_account_role(client["id"], MPI_READ_ROLE)

print("服务间种子完成。")
PYEOF
