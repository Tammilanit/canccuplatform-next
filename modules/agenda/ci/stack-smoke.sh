#!/usr/bin/env bash
# Agenda's checks against the running stack; CI runs it through scripts/stack-smoke (docs/ci.md#compose).
set -euo pipefail
base=$CANCCU_SMOKE_BASE_URL
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT

echo "-- agenda health through Caddy is ok"
curl -fsS "$base/api/agenda/health" | tee "$t/r.json"; echo
jq -e '.status == "ok" and .module == "agenda" and .checks.postgres.status == "ok"' "$t/r.json"
echo "-- agenda answers its kinds, with the platform default 'other'"
curl -fsS "$base/api/agenda/kinds" | tee "$t/r.json"; echo
jq -e '.kinds_version == 0 and (.kinds | map(.key) | index("other") != null)' "$t/r.json"
