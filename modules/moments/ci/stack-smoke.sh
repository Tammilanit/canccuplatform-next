#!/usr/bin/env bash
# Moments' checks against the running stack; CI runs it through scripts/stack-smoke (docs/ci.md#compose).
set -euo pipefail
base=$CANCCU_SMOKE_BASE_URL
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT

echo "-- moments health through Caddy is ok"
curl -fsS "$base/api/moments/health" | tee "$t/r.json"; echo
jq -e '.status == "ok" and .module == "moments" and .checks.postgres.status == "ok"' "$t/r.json"
echo "-- the API without a session is 401 not_signed_in"
code=$(curl -sS -o "$t/r.json" -w '%{http_code}' "$base/api/moments/moments"); echo "$code"
[ "$code" = 401 ] && jq -e '.error.code == "not_signed_in"' "$t/r.json"
echo "-- /moments without the slash goes to the pages"
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "$base/moments" | tee "$t/r.txt"
grep -qxF "308 $base/moments/" "$t/r.txt"
echo "-- the pages' prefix is no second way into the API or the internal paths"
for p in /moments/api/moments/moments /moments/internal/moments/moments /moments/health; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$base$p"); echo "$p $code"
  [ "$code" = 404 ]
done
echo "-- a signed-out page sends the browser to sign in, and back to that page"
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "$base/moments/history" | tee "$t/r.txt"
grep -qxF "303 $base/admin/sign-in?next=%2Fmoments%2Fhistory" "$t/r.txt"
