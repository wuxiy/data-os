#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
bundle_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
allow_unsigned=false
public_key=

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bundle)
      [ "$#" -ge 2 ] || exit 64
      bundle_dir=$2
      shift 2
      ;;
    --allow-unsigned)
      allow_unsigned=true
      shift
      ;;
    --public-key)
      [ "$#" -ge 2 ] || exit 64
      public_key=$2
      shift 2
      ;;
    -h|--help)
      echo 'Usage: load-offline-bundle.sh [--bundle DIRECTORY] [--allow-unsigned] [--public-key FILE]'
      exit 0
      ;;
    *)
      echo "unknown option: $1" >&2
      exit 64
      ;;
  esac
done

if [ "$allow_unsigned" = true ]; then
  if [ -n "$public_key" ]; then
    "$bundle_dir/scripts/verify-offline-bundle.sh" --bundle "$bundle_dir" \
      --allow-unsigned --public-key "$public_key"
  else
    "$bundle_dir/scripts/verify-offline-bundle.sh" --bundle "$bundle_dir" --allow-unsigned
  fi
elif [ -n "$public_key" ]; then
  "$bundle_dir/scripts/verify-offline-bundle.sh" --bundle "$bundle_dir" \
    --public-key "$public_key"
else
  "$bundle_dir/scripts/verify-offline-bundle.sh" --bundle "$bundle_dir"
fi

command -v docker >/dev/null 2>&1 || { echo 'docker is required' >&2; exit 69; }
image_archive=$(sed -n 's/.*"imageArchive"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$bundle_dir/release-manifest.json")
image_ref=$(sed -n 's/.*"imageRef"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$bundle_dir/release-manifest.json")
[ -n "$image_archive" ] && [ -n "$image_ref" ] || { echo 'invalid release manifest' >&2; exit 65; }
gzip -dc "$bundle_dir/$image_archive" | docker load
docker image inspect --format '{{.Architecture}}' "$image_ref" | grep -qx amd64 || {
  echo "loaded image is not linux/amd64: $image_ref" >&2
  exit 65
}
manifest_image_id=$(sed -n 's/.*"imageId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$bundle_dir/release-manifest.json")
loaded_image_id=$(docker image inspect --format '{{.Id}}' "$image_ref")
[ -n "$manifest_image_id" ] && [ "$loaded_image_id" = "$manifest_image_id" ] || {
  echo "loaded image does not match release manifest: $image_ref" >&2
  exit 65
}
docker run --rm --entrypoint sh "$image_ref" -c '
  test -n "$(find /opt/seatunnel/connectors -maxdepth 1 -type f -name "connector-jdbc-*.jar" -print -quit)" &&
  test -n "$(find /opt/seatunnel/connectors -maxdepth 1 -type f -name "connector-doris-*.jar" -print -quit)" &&
  ! find /opt/seatunnel -type f \( -iname "*shell*" -o -iname "*connector-shell*" \) -print -quit | grep -q . &&
  ! grep -Eiq "(^|[^[:alnum:]])shell([^[:alnum:]]|$)" /opt/seatunnel/connectors/plugin-mapping.properties
'
printf '%s\n' "Loaded SeaTunnel image: $image_ref"
