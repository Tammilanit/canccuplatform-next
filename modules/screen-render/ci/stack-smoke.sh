#!/usr/bin/env bash
# The renderer's isolation and its socket, against the running stack; CI runs it through
# scripts/stack-smoke (docs/ci.md#compose). The renderer parses untrusted decks, so the
# render-socket volume is its only way in or out (modules/screen-render/README.md).
set -euo pipefail
read -ra compose <<< "$CANCCU_SMOKE_COMPOSE_ARGS"
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT
docker compose "${compose[@]}" config --format json > "$t/config.json"

echo "-- screen-render has no network, a read-only root, no capabilities, no environment and only the socket volume"
jq -e '.services["screen-render"] | .network_mode == "none" and .read_only == true
  and .cap_drop == ["ALL"] and ([.volumes[].source] == ["render-socket"])
  and (.environment // {} | length == 0)' "$t/config.json"
echo "-- only screen and screen-render mount render-socket, screen read-only"
jq -e '[.services | to_entries[] | select(.value.volumes // [] | map(.source) | index("render-socket")) | .key]
  == ["screen", "screen-render"]' "$t/config.json"
jq -e '[.services.screen.volumes[] | select(.source == "render-socket")][0].read_only == true' "$t/config.json"
echo "-- screen-render cannot reach the network"
if docker compose "${compose[@]}" exec -T screen-render \
    python -c "import socket; socket.create_connection(('1.1.1.1', 53), 2)"; then
  echo "screen-render reached the network"; exit 1
fi
echo "-- a deck renders through the socket volume (tests/smoke.py)"
volume="$(jq -r .name "$t/config.json")_render-socket"
docker build -q --target test -f modules/screen-render/Dockerfile -t canccu-screen-render-test .
docker run --rm --network none -v "$volume:/run/canccu-render" canccu-screen-render-test python tests/smoke.py
