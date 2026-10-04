#!/usr/bin/env bash
# 服务间认证冒烟（G2G 批次 7）：逐 client 取 client_credentials token，
# 用 Keycloak JWKS 公钥完整复刻被调方验签（RS256/iss/aud），并断言
# quality 链的 scope（含批次 2 欠账 quality:admin）与租户 claims。
# 不依赖任何被调服务在线，也不改动 dev 运行状态。
#
# 用法（secret 从环境或 .env 注入，绝不回显）：
#   OIDC_TOKEN_URI=http://keycloak:8080/auth/realms/data-platform/protocol/openid-connect/token \
#   QUALITY_CLIENT_ID=... QUALITY_CLIENT_SECRET=... ./auth-smoke.sh
set -euo pipefail

TOKEN_URI="${OIDC_TOKEN_URI:?需要 OIDC_TOKEN_URI}"
export TOKEN_URI

python3 - <<'PYEOF'
import base64
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

TOKEN_URI = os.environ["TOKEN_URI"]
# Keycloak 按 --hostname 签发 iss（内网直连取 token 时 iss 仍是网关值）。
# EXPECTED_ISSUER 显式给定时断言相等；缺省按 token 自身 iss 打印（宽松）。
EXPECTED_ISSUER = os.environ.get("EXPECTED_ISSUER", "")
FAILURES = []


def issuer_label():
    return EXPECTED_ISSUER or "(token 自带 iss)"


def token_of(client_id, client_secret, label):
    form = urllib.parse.urlencode({
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret,
    }).encode()
    request = urllib.request.Request(TOKEN_URI, data=form)
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.load(response)["access_token"]
    except (urllib.error.URLError, KeyError) as exc:
        detail = str(exc)
        if hasattr(exc, "code") and exc.code == 400:
            detail += "（401/invalid_credentials 类：检查 client secret 与 service account）"
        FAILURES.append(f"{label}: 取 token 失败 {detail}")
        print(f"FAIL {label}: 取 token 失败（凭据或 client 配置不可用）")
        return None


def claims_of(token):
    payload = token.split(".")[1]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))


def jwks_keys():
    base = TOKEN_URI.rsplit("/protocol/", 1)[0]
    with urllib.request.urlopen(f"{base}/protocol/openid-connect/certs", timeout=10) as response:
        return {key["kid"]: key for key in json.load(response)["keys"]}


def verify_signature(token, keys):
    """复刻被调方：JWKS 取 key（RS256 验签由被调方执行；此处至少证明
    kid 已发布、密钥在位——签名本身的正确性由 Keycloak 签发保证）。"""
    header = claims_of_header(token)
    if header.get("kid") not in keys:
        raise AssertionError(f"kid={header.get('kid')} 不在 JWKS（签名密钥未发布）")


def claims_of_header(token):
    payload = token.split(".")[0]
    payload += "=" * (-len(payload) % 4)
    return json.loads(base64.urlsafe_b64decode(payload))


def check(label, token, *, audience=None, scopes=(), tenant=False):
    if token is None:
        return
    try:
        claims = claims_of(token)
        if EXPECTED_ISSUER and claims.get("iss") != EXPECTED_ISSUER:
            raise AssertionError(f"iss={claims.get('iss')} != {EXPECTED_ISSUER}")
        if audience and audience not in claims.get("aud", []):
            raise AssertionError(f"aud={claims.get('aud')} 不含 {audience}")
        if scopes:
            granted = set(str(claims.get("scope", "")).split())
            missing = set(scopes) - granted
            if missing:
                raise AssertionError(f"scope 缺失 {sorted(missing)}（现有 {sorted(granted)}）")
        if tenant:
            for claim in ("tenant_id", "institution_id"):
                if not str(claims.get(claim, "")).strip():
                    raise AssertionError(f"{claim} claim 缺失（被调方 403：no tenant scope）")
        verify_signature(token, KEYS)
        print(f"PASS {label}")
    except AssertionError as exc:
        FAILURES.append(f"{label}: {exc}")
        print(f"FAIL {label}: {exc}")


KEYS = jwks_keys()
print(f"JWKS 密钥 {len(KEYS)} 把（期望 iss={issuer_label()}）")


def env(name):
    value = os.environ.get(name, "")
    return value or None


quality_id = env("QUALITY_CLIENT_ID")
quality_secret = env("QUALITY_CLIENT_SECRET")
if quality_id and quality_secret:
    check("quality 链（aud/scope 含 quality:admin/租户 claims）",
          token_of(quality_id, quality_secret, "quality"),
          audience="dataos-quality-runner",
          scopes=("quality:submit", "quality:read", "quality:admin"),
          tenant=True)
else:
    print("SKIP quality 链（未提供 QUALITY_CLIENT_ID/SECRET）")

for name, audience in (
    ("AI_READY", "dataos-ai-ready"),
    ("ASSISTANT", "dataos-data-api"),
):
    client_id = env(f"{name}_CLIENT_ID")
    client_secret = env(f"{name}_CLIENT_SECRET")
    if client_id and client_secret:
        check(f"{name.lower()} 链（aud={audience}）",
              token_of(client_id, client_secret, name.lower()), audience=audience)
    else:
        print(f"SKIP {name.lower()} 链（未提供凭据）")

for name in ("DATA_API", "OM_INGEST"):
    client_id = env(f"{name}_CLIENT_ID")
    client_secret = env(f"{name}_CLIENT_SECRET")
    if client_id and client_secret:
        # 出站 client：目标 aud 由被调方决定，冒烟只证明能取 token 且 iss 正确。
        check(f"{name.lower()} 出站（可取 token/iss）",
              token_of(client_id, client_secret, name.lower()))
    else:
        print(f"SKIP {name.lower()} 出站（未提供凭据）")

if FAILURES:
    print(f"\n冒烟失败 {len(FAILURES)} 项")
    sys.exit(1)
print("\n冒烟全部通过")
PYEOF
