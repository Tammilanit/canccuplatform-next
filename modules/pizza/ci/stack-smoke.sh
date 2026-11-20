#!/usr/bin/env bash
# Pizza's checks against the running stack; CI runs it through scripts/stack-smoke (docs/ci.md#compose).
set -euo pipefail
# One check per line: under set -e a failing first command of an && list does not stop the script.
base=$CANCCU_SMOKE_BASE_URL
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT

echo "-- pizza health through Caddy is ok"
curl -fsS "$base/api/pizza/health" | tee "$t/r.json"; echo
jq -e '.status == "ok" and .module == "pizza" and .checks.postgres.status == "ok"' "$t/r.json"
echo "-- a guest reads the demo event's orders and pizzerias (the info pages are public)"
curl -fsS "$base/api/pizza/orders" | tee "$t/r.json"; echo
jq -e '.orders | type == "array"' "$t/r.json"
curl -fsS "$base/api/pizza/pizzerias" | tee "$t/r.json"; echo
jq -e '.pizzerias | type == "array"' "$t/r.json"
echo "-- opening an order needs sign-in"
code=$(curl -sS -o "$t/r.json" -w '%{http_code}' -X POST -H 'content-type: application/json' \
  -H 'idempotency-key: smoke-open-0001' -d '{}' "$base/api/pizza/orders"); echo "$code"
[ "$code" = 401 ]
jq -e '.error.code == "not_signed_in"' "$t/r.json"
echo "-- the record and the export need pizza.record.read"
for p in /api/pizza/record /api/pizza/export.csv; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$base$p"); echo "$p $code"
  [ "$code" = 401 ]
done
echo "-- the internal paths of the module are not routed"
code=$(curl -sS -o /dev/null -w '%{http_code}' "$base/internal/pizza/orders"); echo "$code"
[ "$code" = 404 ]
echo "-- /pizza without the slash goes to the pages"
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "$base/pizza" | tee "$t/r.txt"
grep -qxF "308 $base/pizza/" "$t/r.txt"
echo "-- the pages' prefix is no second way into the API or the internal paths"
for p in /pizza/api/pizza/orders /pizza/internal/pizza/orders /pizza/health; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$base$p"); echo "$p $code"
  [ "$code" = 404 ]
done
echo "-- a signed-out page sends the browser to sign in, and back to that page"
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "$base/pizza/crew" | tee "$t/r.txt"
grep -qxF "303 $base/admin/sign-in?next=%2Fpizza%2Fcrew" "$t/r.txt"
echo "-- the pages' stylesheets are served"
code=$(curl -sS -o /dev/null -w '%{http_code}' "$base/pizza/static/pizza.css"); echo "$code"
[ "$code" = 200 ]
echo "-- the scheduler reports its lag in health"
curl -fsS "$base/api/pizza/health" | tee "$t/r.json"; echo
jq -e '.checks.scheduler.status | IN("ok", "degraded")' "$t/r.json"
