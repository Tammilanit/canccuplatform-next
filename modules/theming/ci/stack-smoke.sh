#!/usr/bin/env bash
# Theming's checks against the running stack; CI runs it through scripts/stack-smoke (docs/ci.md#compose).
set -euo pipefail
base=$CANCCU_SMOKE_BASE_URL
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT

echo "-- theming health through Caddy is ok, with its files volume"
curl -fsS "$base/api/theming/health" | tee "$t/r.json"; echo
jq -e '.status == "ok" and .checks.files.status == "ok"' "$t/r.json"
echo "-- theming answers the platform defaults"
curl -fsS "$base/api/theming/current" | tee "$t/theme.json"; echo
jq -e '.revision == 0 and .theming_version == 1' "$t/theme.json"
echo "-- the token CSS holds the tokens and is served nosniff"
# To a file, not piped to `grep -q`: an early grep exit would fail curl under pipefail.
curl -fsS -D "$t/css.headers" -o "$t/tokens.css" "$base$(jq -r .tokens_css_url "$t/theme.json")"
grep -q -- '--canccu-color-primary' "$t/tokens.css"
grep -qi '^x-content-type-options: nosniff' "$t/css.headers"
