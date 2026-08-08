#!/usr/bin/env sh
set -eu

usage() {
  echo 'Usage: rollback.sh --compose-root DIRECTORY --env-file FILE' >&2
  exit 64
}

compose_root=
env_file=
while [ "$#" -gt 0 ]; do
  case "$1" in
    --compose-root)
      [ "$#" -ge 2 ] || usage
      compose_root=$2
      shift 2
      ;;
    --env-file)
      [ "$#" -ge 2 ] || usage
      env_file=$2
      shift 2
      ;;
    -h|--help) usage ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

[ -n "$compose_root" ] && [ -n "$env_file" ] || usage
[ "${DATAOS_ROLLBACK_CONFIRM:-}" = YES ] || {
  echo 'refusing rollback: set DATAOS_ROLLBACK_CONFIRM=YES after change approval' >&2
  exit 77
}
state_dir="$compose_root/.data-os-seatunnel"
active_backup=$(sed -n '1p' "$state_dir/active-backup" 2>/dev/null || true)
[ -n "$active_backup" ] || { echo 'no SeaTunnel activation backup found' >&2; exit 66; }
backup_dir="$state_dir/backups/$active_backup"
[ -d "$backup_dir" ] || { echo "backup not found: $backup_dir" >&2; exit 66; }
previous_image=$(sed -n '1p' "$backup_dir/previous-image")
[ "$previous_image" != none ] && [ -n "$previous_image" ] || {
  echo 'previous image reference is unavailable; restore it from the release record' >&2
  exit 65
}
command -v docker >/dev/null 2>&1 || { echo 'docker is required' >&2; exit 69; }
docker image inspect "$previous_image" >/dev/null 2>&1 || {
  echo "previous image is not loaded locally: $previous_image" >&2
  exit 69
}

if [ -f "$backup_dir/seatunnel.yaml" ]; then
  cp "$backup_dir/seatunnel.yaml" "$compose_root/seatunnel/seatunnel.yaml"
fi
if [ -f "$backup_dir/seatunnel-compose.yml" ]; then
  cp "$backup_dir/seatunnel-compose.yml" "$compose_root/seatunnel/seatunnel-compose.yml"
fi
if [ -f "$backup_dir/env-file" ]; then
  cp "$backup_dir/env-file" "$env_file"
fi
SEATUNNEL_IMAGE="$previous_image" docker compose --env-file "$env_file" \
  -f "$compose_root/docker-compose.yml" -f "$compose_root/seatunnel/seatunnel-compose.yml" \
  config --quiet
SEATUNNEL_IMAGE="$previous_image" docker compose --env-file "$env_file" \
  -f "$compose_root/docker-compose.yml" -f "$compose_root/seatunnel/seatunnel-compose.yml" \
  up -d seatunnel-master control-plane
printf '%s\n' "Rolled back SeaTunnel image: $previous_image"
