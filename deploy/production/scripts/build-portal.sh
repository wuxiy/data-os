#!/usr/bin/env bash
# 门户生产构建（校验 + 构建 + 原子同步到 deploy/production/portal-dist）。
# 把 H2 记录的「前端 VITE 构建参数」未竟面收进生产流程：OIDC 两键非空、
# 演示模式必须关闭，否则拒绝出包。
#
# 用法（仓库根或任意目录）：
#   bash deploy/production/scripts/build-portal.sh
# 变量：
#   PROTOTYPE_DIR  默认 <仓库根>/prototype（.env.production 所在地）
#   DEST_DIR       默认 <仓库根>/deploy/production/portal-dist
set -euo pipefail

SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
REPO_ROOT=$(cd "$SCRIPT_DIR/../../.." && pwd)
PROTOTYPE_DIR="${PROTOTYPE_DIR:-$REPO_ROOT/prototype}"
DEST_DIR="${DEST_DIR:-$REPO_ROOT/deploy/production/portal-dist}"
ENV_FILE="$PROTOTYPE_DIR/.env.production"

[ -f "$ENV_FILE" ] || {
  echo "缺少 $ENV_FILE：先 cp prototype/.env.production.example prototype/.env.production 并填写 OIDC issuer/client id/redirect" >&2
  exit 1
}

# Vite 构建按模式读取 .env.production；做三类守卫：
# OIDC 两键必填且不得是模板占位；演示模式必须关闭；redirect 必填且非占位。
get_value() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -1 | tr -d '"' | tr -d "'"; }
fail=0
check_oidc() {
  local key=$1 value
  value=$(get_value "$key")
  if [ -z "$value" ] || [ "${value#\$}" != "$value" ] || \
     [[ "$value" == *example.invalid* ]] || [[ "$value" == *localhost* ]]; then
    echo "守卫失败: $key 未配置或仍是模板占位（当前: '$value'）" >&2
    fail=1
  fi
}
check_oidc VITE_DATAOS_OIDC_ISSUER_URI
check_oidc VITE_DATAOS_OIDC_CLIENT_ID
check_oidc VITE_DATAOS_OIDC_REDIRECT_URI
if [ -n "$(get_value VITE_DATAOS_DEMO_MODE)" ]; then
  echo '守卫失败: VITE_DATAOS_DEMO_MODE 已设置——生产构建禁止携带演示数据' >&2
  fail=1
fi
[ "$fail" = 0 ] || exit 1
echo "守卫通过: OIDC 三键已配置，演示模式关闭"

npm ci --prefix "$PROTOTYPE_DIR"
npm run build --prefix "$PROTOTYPE_DIR"
[ -d "$PROTOTYPE_DIR/dist" ] || { echo "构建产物缺失: $PROTOTYPE_DIR/dist" >&2; exit 1; }

# 原子同步：先落到临时目录再整体换名，portal-dist 任意时刻都是完整产物。
rm -rf "${DEST_DIR}.new"
mkdir -p "$DEST_DIR.new"
cp -a "$PROTOTYPE_DIR/dist/." "$DEST_DIR.new/"
if [ -d "$DEST_DIR" ]; then
  rm -rf "${DEST_DIR}.old"
  mv "$DEST_DIR" "${DEST_DIR}.old"
fi
mv "$DEST_DIR.new" "$DEST_DIR"
rm -rf "${DEST_DIR}.old"
echo "已同步: $DEST_DIR（$(find "$DEST_DIR" -type f | wc -l | tr -d ' ') 个文件）"
