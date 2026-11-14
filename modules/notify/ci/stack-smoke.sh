#!/usr/bin/env bash
# Notify's checks against the running stack; CI runs it through scripts/stack-smoke (docs/ci.md#compose).
set -euo pipefail
base=$CANCCU_SMOKE_BASE_URL
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT

echo "-- notify health through Caddy is ok"
curl -fsS "$base/api/notify/health" | tee "$t/r.json"; echo
jq -e '.status == "ok" and .module == "notify" and .checks.postgres.status == "ok"' "$t/r.json"
echo "-- notify offers only the schedule topic on a fresh stack, which the agenda registers at start"
for _ in $(seq 30); do
  curl -fsS "$base/api/notify/topics" > "$t/r.json"
  jq -e '.topics | map(.key) == ["schedule"]' "$t/r.json" >/dev/null && break
  sleep 2
done
cat "$t/r.json"; echo
jq -e '.topics | map(.key) == ["schedule"]' "$t/r.json"
echo "-- notify answers the VAPID public key of ci/stack-env.sh's private key"
curl -fsS "$base/api/notify/push-key" | tee "$t/r.json"; echo
jq -e '.vapid_public_key | test("^B[A-Za-z0-9_-]{86}$")' "$t/r.json"
