#!/usr/bin/env bash

set -euo pipefail

TEST_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
# shellcheck source=../scripts/platformctl
source "$TEST_DIR/../scripts/platformctl"

assert_state() {
    local expected=$1
    local payload=$2
    local actual
    actual=$(operational_facts_state "$payload")
    if [ "$actual" != "$expected" ]; then
        printf 'expected %s, got %s\n' "$expected" "$actual" >&2
        exit 1
    fi
}

assert_state READY '{"operational":{"state":"READY","ready":3,"degraded":0,"unknown":0,"total":3}}'
assert_state DEGRADED '{"operational":{"ready":1,"state":"DEGRADED","degraded":1,"unknown":1,"total":3}}'
assert_state UNKNOWN '{"operational":{"state":"UNKNOWN","ready":0,"degraded":0,"unknown":3,"total":3}}'
assert_state INVALID '{"mode":"LIVE"}'

printf 'platformctl operational facts contract: PASS\n'
