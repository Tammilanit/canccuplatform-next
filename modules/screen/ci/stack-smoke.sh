#!/usr/bin/env bash
# Screen's checks against the running stack; CI runs it through scripts/stack-smoke (docs/ci.md#compose).
set -euo pipefail
read -ra compose <<< "$CANCCU_SMOKE_COMPOSE_ARGS"

echo "-- screen renders a PDF through its read-only render-socket mount (test/render-smoke.mjs)"
docker compose "${compose[@]}" exec -T screen node --input-type=module < modules/screen/test/render-smoke.mjs
