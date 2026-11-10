#!/usr/bin/env bash
# Admin's checks against the running stack; CI runs it through scripts/stack-smoke (docs/ci.md#compose).
set -euo pipefail
base=$CANCCU_SMOKE_BASE_URL
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT

echo "-- admin health through Caddy is ok"
curl -fsS "$base/api/admin/health" | tee "$t/r.json"; echo
jq -e '.status == "ok" and .module == "admin" and .checks.postgres.status == "ok"' "$t/r.json"
