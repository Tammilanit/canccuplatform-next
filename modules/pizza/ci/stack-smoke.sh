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
