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
echo "-- /agenda without the slash goes to the run-of-show pages"
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "$base/agenda" | tee "$t/r.txt"
grep -qxF "308 $base/agenda/" "$t/r.txt"
echo "-- the pages' prefix is no second way into the API"
code=$(curl -sS -o /dev/null -w '%{http_code}' "$base/agenda/api/agenda/kinds"); echo "$code"
[ "$code" = 404 ]
echo "-- a signed-out page sends the browser to sign in, and back to that page"
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "$base/agenda/templates" | tee "$t/r.txt"
grep -qxF "303 $base/admin/sign-in?next=%2Fagenda%2Ftemplates" "$t/r.txt"
