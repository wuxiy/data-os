#!/usr/bin/env sh
set -eu

usage() {
  cat >&2 <<'EOF'
Usage: verify-offline-bundle.sh [--bundle DIRECTORY] [--allow-unsigned] [--public-key FILE]
EOF
  exit 64
}

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
bundle_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
allow_unsigned=false
public_key=${DATAOS_RELEASE_PUBLIC_KEY:-}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --bundle)
      [ "$#" -ge 2 ] || usage
      bundle_dir=$2
      shift 2
      ;;
    --allow-unsigned)
      allow_unsigned=true
      shift
      ;;
    --public-key)
      [ "$#" -ge 2 ] || usage
      public_key=$2
      shift 2
      ;;
    -h|--help)
      usage
      ;;
    *) echo "unknown option: $1" >&2; usage ;;
  esac
done

[ -f "$bundle_dir/SHA256SUMS" ] || { echo 'SHA256SUMS is missing' >&2; exit 65; }
[ -f "$bundle_dir/release-manifest.json" ] || { echo 'release-manifest.json is missing' >&2; exit 65; }

# Do not allow a crafted bundle to escape through a symlinked directory
# component (checking only the final file would miss that case).
if find "$bundle_dir" -type l -print -quit | grep -q .; then
  echo 'offline bundle must not contain symlinks' >&2
  exit 65
fi

for required_file in licenses/SEATUNNEL-LICENSE licenses/SEATUNNEL-NOTICE licenses/THIRD-PARTY.md; do
  [ -f "$bundle_dir/$required_file" ] && [ ! -L "$bundle_dir/$required_file" ] || {
    echo "required release file is missing or symlinked: $required_file" >&2
    exit 65
  }
done

hash_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

(
  cd "$bundle_dir"
  while IFS='  ' read -r expected file; do
    [ -n "$expected" ] || continue
    [ -n "$file" ] || { echo 'invalid SHA256SUMS row' >&2; exit 65; }
    case "$file" in
      /*|.|..|../*|*/../*)
        echo "SHA256SUMS path must stay inside the bundle: $file" >&2
        exit 65
        ;;
    esac
    [ ! -L "$file" ] || { echo "SHA256SUMS refuses symlink: $file" >&2; exit 65; }
    [ -f "$file" ] || { echo "bundle file is missing: $file" >&2; exit 65; }
    actual=$(hash_file "$file")
    [ "$actual" = "$expected" ] || {
      echo "SHA-256 mismatch: $file" >&2
      exit 65
    }
  done < SHA256SUMS
)

if [ -f "$bundle_dir/SHA256SUMS.sig" ]; then
  [ -n "$public_key" ] || {
    echo 'SHA256SUMS.sig exists; provide --public-key or DATAOS_RELEASE_PUBLIC_KEY' >&2
    exit 78
  }
  command -v cosign >/dev/null 2>&1 || { echo 'cosign is required to verify the release signature' >&2; exit 69; }
  cosign verify-blob --offline --key "$public_key" \
    --signature "$bundle_dir/SHA256SUMS.sig" "$bundle_dir/SHA256SUMS"
elif [ "$allow_unsigned" != true ] && [ "${DATAOS_ALLOW_UNSIGNED:-false}" != true ]; then
  echo 'unsigned bundle refused; pass --allow-unsigned only for isolated validation' >&2
  exit 78
fi

if [ -f "$bundle_dir/sbom/data-os-seatunnel.cdx.json" ]; then
  :
elif [ "$allow_unsigned" = true ] || [ "${DATAOS_ALLOW_UNSIGNED:-false}" = true ]; then
  [ -f "$bundle_dir/sbom/UNSIGNED-SBOM-NOTE.txt" ] || {
    echo 'unsigned test bundle must explain why SBOM is unavailable' >&2
    exit 65
  }
else
  echo 'production bundle must contain a CycloneDX SBOM' >&2
  exit 65
fi

architecture=$(sed -n 's/.*"architecture"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$bundle_dir/release-manifest.json")
[ "$architecture" = linux/amd64 ] || {
  echo "bundle architecture must be linux/amd64, got ${architecture:-missing}" >&2
  exit 65
}

grep -Eq '"shellPluginIncluded"[[:space:]]*:[[:space:]]*false([[:space:]]*,|[[:space:]]*$)' \
  "$bundle_dir/release-manifest.json" || {
  echo 'Shell plugin is forbidden in a SeaTunnel offline bundle' >&2
  exit 65
}

image_archive=$(sed -n 's/.*"imageArchive"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$bundle_dir/release-manifest.json")
case "$image_archive" in
  ''|/*|.|..|../*|*/../*)
    echo 'image archive path must stay inside the bundle' >&2
    exit 65
    ;;
esac
[ ! -L "$bundle_dir/$image_archive" ] && [ -f "$bundle_dir/$image_archive" ] || {
  echo 'image archive declared by release-manifest.json is missing' >&2
  exit 65
}

printf '%s\n' "Verified offline bundle: $bundle_dir"
