#!/usr/bin/env bash
# MPI 存储一次性 provision（幂等）：PG 独占账号 + schema，Doris 独占账号 + 三重授权。
# 口令一律来自环境/.env，不进 Git、不回显。
#
# 用法（在部署机上、compose .env 所在目录）：
#   bash provision-mpi-storage.sh
# 需要的变量（.env）：
#   DATAOS_MPI_DB_PASSWORD   PG dataos_mpi 账号口令
#   DORIS_MPI_PASSWORD       Doris dataos_mpi 账号口令
#   DORIS_ROOT_PASSWORD      Doris 管理口令（仅本脚本使用）
# 可选覆盖：PG_ADMIN_CONTAINER（默认 keycloak-db 容器名）、DORIS_FE_HOST/PORT
set -euo pipefail

ENV_FILE="${ENV_FILE:-$(dirname "$0")/../../.env}"
# shellcheck disable=SC1090
[ -f "$ENV_FILE" ] && . "$ENV_FILE"

: "${DATAOS_MPI_DB_PASSWORD:?请在 .env 提供 DATAOS_MPI_DB_PASSWORD}"
: "${DORIS_MPI_PASSWORD:?请在 .env 提供 DORIS_MPI_PASSWORD}"
: "${DORIS_ROOT_PASSWORD:?请在 .env 提供 DORIS_ROOT_PASSWORD}"
PG_ADMIN_CONTAINER="${PG_ADMIN_CONTAINER:-medical-platform-keycloak-db-1}"
DORIS_FE_HOST="${DORIS_FE_HOST:-172.16.66.8}"
DORIS_FE_PORT="${DORIS_FE_PORT:-9030}"
# dev 机已预拉 mysql:8.0 客户端镜像（Docker Hub 不可达，不依赖现场拉取）。
MYSQL=(docker run --rm -i mysql:8.0 mysql -h "$DORIS_FE_HOST" -P "$DORIS_FE_PORT")

echo '== PG: 独占账号 + schema（owner 即独占账号，Flyway 由该账号执行）=='
# psql 变量不进 dollar-quote 块，用 \gexec 条件执行；%L 防口令内引号注入。
docker exec -i "$PG_ADMIN_CONTAINER" psql -U keycloak -d keycloak -v pw="$DATAOS_MPI_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE dataos_mpi LOGIN PASSWORD %L', :'pw')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dataos_mpi') \gexec
SELECT format('ALTER ROLE dataos_mpi LOGIN PASSWORD %L', :'pw')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dataos_mpi') \gexec
CREATE SCHEMA IF NOT EXISTS data_os_mpi AUTHORIZATION dataos_mpi;
SQL

echo '== Doris: 库表 DDL + 独占账号三重授权（库级 + compute group + storage vault）=='
"${MYSQL[@]}" -u root -p"$DORIS_ROOT_PASSWORD" < "$(dirname "$0")/init-mpi-doris.sql"
"${MYSQL[@]}" -u root -p"$DORIS_ROOT_PASSWORD" -e "
CREATE USER IF NOT EXISTS 'dataos_mpi'@'%' IDENTIFIED BY '${DORIS_MPI_PASSWORD}';
ALTER USER 'dataos_mpi'@'%' IDENTIFIED BY '${DORIS_MPI_PASSWORD}';
GRANT ALL ON dataos_mpi.* TO 'dataos_mpi'@'%';
GRANT USAGE_PRIV ON COMPUTE GROUP default_compute_group TO 'dataos_mpi'@'%';
GRANT USAGE_PRIV ON STORAGE VAULT 's3_vault' TO 'dataos_mpi'@'%';
"
echo '== 验证 =='
docker exec -i "$PG_ADMIN_CONTAINER" psql -U keycloak -d keycloak -Atc \
  "SELECT 'pg_schema_owner=' || pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='data_os_mpi';"
"${MYSQL[@]}" -u dataos_mpi -p"$DORIS_MPI_PASSWORD" -e "SHOW TABLES FROM dataos_mpi;"
echo 'provision 完成。'
