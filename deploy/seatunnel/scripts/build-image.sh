#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
seatunnel_dir=$(CDPATH= cd -- "$script_dir/.." && pwd)
manifest="$seatunnel_dir/manifest.env"

# This file is repository-controlled release metadata, not an operator .env.
# Operator secrets and vendor JARs are supplied through explicit paths.
. "$manifest"

driver_profile=${SEATUNNEL_DRIVER_PROFILE:-postgresql}
image_tag=${SEATUNNEL_IMAGE_TAG:-medical-platform/data-os-seatunnel:${SEATUNNEL_VERSION}-dataos.2}
driver_dir=${SEATUNNEL_DRIVER_DIR:-$seatunnel_dir/vendor-drivers}
connector_dir=${SEATUNNEL_CONNECTOR_DIR:-$seatunnel_dir/connector-cache}
offline_build=${SEATUNNEL_OFFLINE_BUILD:-false}

sha256_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

require_hash() {
  file=$1
  expected=$2
  actual=$(sha256_file "$file")
  [ "$actual" = "$expected" ] || {
    echo "SHA-256 mismatch: $file (expected $expected, got $actual)" >&2
    exit 65
  }
}

selected_profile() {
  profile=$1
  case "$driver_profile" in
    none) return 1 ;;
    postgresql) [ "$profile" = postgresql ] ;;
    standard) [ "$profile" = standard ] ;;
    oracle-enabled) [ "$profile" = oracle-enabled ] ;;
    *) echo "unsupported SEATUNNEL_DRIVER_PROFILE: $driver_profile" >&2; exit 64 ;;
  esac
}

context=$(mktemp -d "${TMPDIR:-/tmp}/dataos-seatunnel-build.XXXXXX")
trap 'rm -rf "$context"' EXIT HUP INT TERM
mkdir -p "$context/connector-cache" "$context/vendor-drivers"
cp "$seatunnel_dir/Dockerfile" "$seatunnel_dir/plugin_config" "$seatunnel_dir/seatunnel.yaml" "$context/"

for artifact in \
  "apache-seatunnel-${SEATUNNEL_VERSION}-bin.tar.gz" \
  "connector-jdbc-${CONNECTOR_JDBC_VERSION}.jar" \
  "connector-doris-${CONNECTOR_DORIS_VERSION}.jar" \
  "connector-file-s3-${CONNECTOR_FILE_S3_VERSION}.jar"; do
  if [ -s "$connector_dir/$artifact" ]; then
    cp "$connector_dir/$artifact" "$context/connector-cache/$artifact"
  elif [ "$offline_build" = true ]; then
    echo "offline build missing connector cache file: $artifact" >&2
    exit 64
  fi
done

if [ -s "$context/connector-cache/apache-seatunnel-${SEATUNNEL_VERSION}-bin.tar.gz" ]; then
  if command -v sha512sum >/dev/null 2>&1; then
    actual_dist=$(sha512sum "$context/connector-cache/apache-seatunnel-${SEATUNNEL_VERSION}-bin.tar.gz" | awk '{print $1}')
  else
    actual_dist=$(shasum -a 512 "$context/connector-cache/apache-seatunnel-${SEATUNNEL_VERSION}-bin.tar.gz" | awk '{print $1}')
  fi
  [ "$actual_dist" = "$SEATUNNEL_DIST_SHA512" ] || {
    echo "SeaTunnel distribution SHA-512 mismatch" >&2
    exit 65
  }
fi

while IFS='|' read -r profile driver_id driver_version filename expected_hash url redistribution; do
  case "$profile" in
    ""|\#*) continue ;;
  esac
  if selected_profile "$profile"; then
    driver_file="$driver_dir/$filename"
    [ -s "$driver_file" ] || {
      echo "missing controlled JDBC driver for $driver_id: $driver_file" >&2
      echo "provide SEATUNNEL_DRIVER_DIR or select SEATUNNEL_DRIVER_PROFILE=none" >&2
      exit 64
    }
    require_hash "$driver_file" "$expected_hash"
    cp "$driver_file" "$context/vendor-drivers/$filename"
  fi
done < "$seatunnel_dir/driver-manifest.tsv"

docker buildx build \
  --platform linux/amd64 \
  --file "$context/Dockerfile" \
  --build-arg "SEATUNNEL_VERSION=$SEATUNNEL_VERSION" \
  --build-arg "SEATUNNEL_DIST_SHA512=$SEATUNNEL_DIST_SHA512" \
  --build-arg "SEATUNNEL_DIST_URL=$SEATUNNEL_DIST_URL" \
  --build-arg "CONNECTOR_MAVEN_BASE=$CONNECTOR_MAVEN_BASE" \
  --build-arg "CONNECTOR_JDBC_VERSION=$CONNECTOR_JDBC_VERSION" \
  --build-arg "CONNECTOR_JDBC_SHA256=$CONNECTOR_JDBC_SHA256" \
  --build-arg "CONNECTOR_DORIS_VERSION=$CONNECTOR_DORIS_VERSION" \
  --build-arg "CONNECTOR_DORIS_SHA256=$CONNECTOR_DORIS_SHA256" \
  --build-arg "CONNECTOR_FILE_S3_VERSION=$CONNECTOR_FILE_S3_VERSION" \
  --build-arg "CONNECTOR_FILE_S3_SHA256=$CONNECTOR_FILE_S3_SHA256" \
  --build-arg "OFFLINE_BUILD=$offline_build" \
  --tag "$image_tag" \
  --load \
  "$context"

architecture=$(docker image inspect --format '{{.Architecture}}' "$image_tag")
[ "$architecture" = amd64 ] || {
  echo "built image architecture is $architecture, expected amd64" >&2
  exit 65
}

printf '%s\n' "Built $image_tag ($architecture) with driver profile $driver_profile"
