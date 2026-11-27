#!/usr/bin/env bash
# The bot's checks against the running stack; CI runs it through scripts/stack-smoke (docs/ci.md#compose).
# That stack has no shared bot (no CANCCU_BOT_* and no fake Discord), so Discord shows as degraded
# while the module itself serves; the demo stack checks a connected client (scripts/demo-stack-test).
set -euo pipefail
base=$CANCCU_SMOKE_BASE_URL
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT

echo "-- bot health through Caddy answers, with Postgres and Valkey ok and the shared client checked"
curl -fsS "$base/api/bot/health" | tee "$t/r.json"; echo
jq -e '.module == "bot" and .checks.postgres.status == "ok" and .checks.valkey.status == "ok"
  and (.checks.discord_shared.status | IN("ok", "degraded"))
  and (.checks.discord_own.detail | test("^[0-9]+ of [0-9]+ own clients failing$"))' "$t/r.json"
echo "-- Discord alone never takes the module down"
jq -e '.status != "down"' "$t/r.json"
echo "-- the connection needs a session"
code=$(curl -sS -o "$t/r.json" -w '%{http_code}' "$base/api/bot/connection"); echo "$code"
[ "$code" = 401 ] && jq -e '.error.code == "not_signed_in"' "$t/r.json"
echo "-- writing the connection and binding need a session"
for call in "PUT /api/bot/connection" "POST /api/bot/guild/bind" "DELETE /api/bot/guild"; do
  method=${call%% *} path=${call#* }
  code=$(curl -sS -o "$t/r.json" -w '%{http_code}' -X "$method" \
    -H 'content-type: application/json' -d '{}' "$base$path"); echo "$call $code"
  [ "$code" = 401 ] && jq -e '.error.code == "not_signed_in"' "$t/r.json"
done
