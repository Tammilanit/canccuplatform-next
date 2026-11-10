#!/usr/bin/env bash
# Tenants' checks against the running stack; CI runs it through scripts/stack-smoke (docs/ci.md#compose).
set -euo pipefail
base=$CANCCU_SMOKE_BASE_URL
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT

echo "-- tenants health through Caddy is ok"
curl -fsS "$base/api/tenants/health" | tee "$t/r.json"; echo
jq -e '.status == "ok" and .module == "tenants" and .checks.postgres.status == "ok"' "$t/r.json"
# The base URL's host is an IP literal: IP mode serves the seeded demo tenant only there.
echo "-- the seeded demo tenant answers in IP mode through Caddy"
curl -fsS "$base/api/tenants/current" | tee "$t/r.json"; echo
jq -e '.id == "demo" and .status == "live"' "$t/r.json"
