#!/usr/bin/env sh
set -eu

usage() {
  cat >&2 <<'EOF'
Usage: package-offline.sh --image IMAGE [--output DIRECTORY] [--production]

The image must already be built for linux/amd64. A production package requires
DATAOS_RELEASE_SIGNING_KEY to point at a private Cosign key in the controlled
release environment. The key is never copied into the package.
EOF
  exit 64
}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
seatunnel_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
repo_root=$(CDPATH= cd -- "$seatunnel_dir/../.." && pwd)
manifest="$seatunnel_dir/manifest.env"
. "$manifest"

image_ref=${DATAOS_SEATUNNEL_IMAGE:-}
output_dir=${DATAOS_OFFLINE_OUTPUT:-$repo_root/dist/data-os-seatunnel-${SEATUNNEL_VERSION}-linux-amd64}
production=false

while [ "$#" -gt 0 ]; do
  case "$1" in
    --image)
      [ "$#" -ge 2 ] || usage
      image_ref=$2
      shift 2
      ;;
    --output)
      [ "$#" -ge 2 ] || usage
      output_dir=$2
      shift 2
      ;;
    --production)
      production=true
      shift
      ;;
    -h|--help)
      usage
      ;;
    *)
      echo "unknown option: $1" >&2
      usage
      ;;
  esac
done

[ -n "$image_ref" ] || {
  echo "--image is required" >&2
  usage
}

command -v docker >/dev/null 2>&1 || { echo 'docker is required' >&2; exit 69; }
docker image inspect "$image_ref" >/dev/null 2>&1 || {
  echo "image is not available locally: $image_ref" >&2
  exit 69
}

image_arch=$(docker image inspect --format '{{.Architecture}}' "$image_ref")
[ "$image_arch" = amd64 ] || {
  echo "image architecture must be amd64, got $image_arch" >&2
  exit 65
}

[ ! -e "$output_dir" ] || {
  echo "refusing to overwrite existing offline bundle: $output_dir" >&2
  exit 73
}

output_parent=$(dirname -- "$output_dir")
mkdir -p "$output_parent"
staging=$(mktemp -d "$output_parent/.data-os-seatunnel-package.XXXXXX")
cleanup() {
  rm -rf "$staging"
}
trap cleanup EXIT HUP INT TERM

mkdir -p "$staging/images" "$staging/deploy" "$staging/metadata" \
  "$staging/licenses" "$staging/sbom" "$staging/scripts"

docker save --output "$staging/images/seatunnel-image.tar" "$image_ref"
gzip -n "$staging/images/seatunnel-image.tar"

if [ "$production" = true ] && [ "${DATAOS_ALLOW_MISSING_SBOM:-false}" = true ]; then
  echo 'DATAOS_ALLOW_MISSING_SBOM is forbidden for a production package' >&2
  exit 78
fi

if [ "${DATAOS_ALLOW_MISSING_SBOM:-false}" = true ]; then
  # The explicit test override avoids invoking a potentially unavailable or
  # slow local SBOM plugin. It is never accepted by --production.
  rm -f "$staging/sbom/data-os-seatunnel.cdx.json"
  printf '%s\n' 'SBOM unavailable in this unsigned test package; CI/release must regenerate it.' \
    > "$staging/sbom/UNSIGNED-SBOM-NOTE.txt"
elif docker sbom --format cyclonedx-json "$image_ref" > "$staging/sbom/data-os-seatunnel.cdx.json" 2>/dev/null; then
  :
else
  echo 'docker sbom is required to create the release package' >&2
  exit 69
fi

docker run --rm --entrypoint cat "$image_ref" /opt/seatunnel/LICENSE \
  > "$staging/licenses/SEATUNNEL-LICENSE"
docker run --rm --entrypoint cat "$image_ref" /opt/seatunnel/NOTICE \
  > "$staging/licenses/SEATUNNEL-NOTICE"
if docker run --rm --entrypoint sh "$image_ref" -c \
  'test -z "$(find /opt/seatunnel -type f \( -iname "*shell*" -o -iname "*connector-shell*" \) -print -quit)" && ! grep -Eiq "(^|[^[:alnum:]])shell([^[:alnum:]]|$)" /opt/seatunnel/connectors/plugin-mapping.properties'; then
  :
else
  echo 'Shell plugin detected in image; refusing to package it' >&2
  exit 65
fi
cp "$seatunnel_dir/licenses/THIRD-PARTY.md" "$staging/licenses/"
cp "$seatunnel_dir/seatunnel.yaml" "$staging/deploy/seatunnel.yaml"
cp "$seatunnel_dir/manifest.env" "$staging/metadata/manifest.env"
cp "$seatunnel_dir/driver-manifest.tsv" "$staging/metadata/driver-manifest.tsv"
cp "$seatunnel_dir/plugin_config" "$staging/metadata/plugin_config"
cp "$repo_root/deploy/production/seatunnel-compose.yml" "$staging/deploy/"
cp "$repo_root/deploy/production/seatunnel-external-compose.yml" "$staging/deploy/"
cp "$seatunnel_dir/scripts/verify-offline-bundle.sh" "$staging/scripts/"
cp "$seatunnel_dir/scripts/load-offline-bundle.sh" "$staging/scripts/"
cp "$seatunnel_dir/scripts/activate.sh" "$staging/scripts/"
cp "$seatunnel_dir/scripts/rollback.sh" "$staging/scripts/"
cp "$seatunnel_dir/scripts/smoke-jdbc-doris.sh" "$staging/scripts/"
chmod 0755 "$staging/scripts/"*.sh

image_id=$(docker image inspect --format '{{.Id}}' "$image_ref")
image_digest=$(docker image inspect --format '{{if .RepoDigests}}{{index .RepoDigests 0}}{{end}}' "$image_ref" || true)
git_commit=$(git -C "$repo_root" rev-parse HEAD 2>/dev/null || printf '%s' unknown)
driver_profile=${SEATUNNEL_DRIVER_PROFILE:-postgresql}

json_escape() {
  printf '%s' "$1" | sed 's/[\\]/\\\\/g; s/"/\\"/g'
}

escaped_image=$(json_escape "$image_ref")
escaped_id=$(json_escape "$image_id")
escaped_digest=$(json_escape "$image_digest")
escaped_commit=$(json_escape "$git_commit")
escaped_profile=$(json_escape "$driver_profile")
cat > "$staging/release-manifest.json" <<EOF
{
  "schemaVersion": 1,
  "product": "data-os-seatunnel-executor",
  "seatunnelVersion": "$(json_escape "$SEATUNNEL_VERSION")",
  "architecture": "linux/amd64",
  "imageRef": "$escaped_image",
  "imageId": "$escaped_id",
  "imageDigest": "$escaped_digest",
  "imageArchive": "images/seatunnel-image.tar.gz",
  "driverProfile": "$escaped_profile",
  "gitCommit": "$escaped_commit",
  "shellPluginIncluded": false,
  "releaseType": "$(if $production; then printf production; else printf unsigned-test; fi)",
  "signature": "SHA256SUMS.sig"
}
EOF

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

(
  cd "$staging"
  find . -type f ! -name SHA256SUMS ! -name SHA256SUMS.sig -print \
    | sed 's#^./##' | sort \
    | while IFS= read -r file; do
        printf '%s  %s\n' "$(hash_file "$file")" "$file"
      done
) > "$staging/SHA256SUMS"

signing_key=${DATAOS_RELEASE_SIGNING_KEY:-}
if [ "$production" = true ]; then
  [ -n "$signing_key" ] || {
    echo '--production requires DATAOS_RELEASE_SIGNING_KEY' >&2
    exit 78
  }
  [ -r "$signing_key" ] || { echo "signing key is not readable: $signing_key" >&2; exit 78; }
  command -v cosign >/dev/null 2>&1 || { echo 'cosign is required for a production package' >&2; exit 69; }
  cosign sign-blob --offline --tlog-upload=false --key "$signing_key" \
    --output-signature "$staging/SHA256SUMS.sig" "$staging/SHA256SUMS"
else
  printf '%s\n' 'Unsigned test artifact. Production deployment requires SHA256SUMS.sig.' \
    > "$staging/UNSIGNED-TEST-ARTIFACT"
  if [ -n "$signing_key" ]; then
    [ -r "$signing_key" ] || { echo "signing key is not readable: $signing_key" >&2; exit 78; }
    command -v cosign >/dev/null 2>&1 || { echo 'cosign is required when DATAOS_RELEASE_SIGNING_KEY is set' >&2; exit 69; }
    cosign sign-blob --offline --tlog-upload=false --key "$signing_key" \
      --output-signature "$staging/SHA256SUMS.sig" "$staging/SHA256SUMS"
  fi
fi

mv "$staging" "$output_dir"
trap - EXIT HUP INT TERM
printf '%s\n' "Created offline bundle: $output_dir"
