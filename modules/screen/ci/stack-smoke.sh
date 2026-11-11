#!/usr/bin/env bash
# Screen's checks against the running stack; CI runs it through scripts/stack-smoke (docs/ci.md#compose).
set -euo pipefail
read -ra compose <<< "$CANCCU_SMOKE_COMPOSE_ARGS"
base=$CANCCU_SMOKE_BASE_URL
t=$(mktemp -d); trap 'rm -rf "$t"' EXIT

echo "-- screen renders a PDF through its read-only render-socket mount (test/render-smoke.mjs)"
docker compose "${compose[@]}" exec -T screen node --input-type=module < modules/screen/test/render-smoke.mjs

echo "-- the kiosk page comes through Caddy with the event page CSP and names its bundle"
curl -fsS -D "$t/h.txt" -o "$t/page.html" "$base/screen/"
grep -qi "^content-security-policy: default-src 'none'; script-src 'self';" "$t/h.txt"
js=$(grep -o 'src="/screen/b/[^"]*/player\.js"' "$t/page.html" | cut -d'"' -f2)
echo "$js"
for file in "$js" "${js%.js}.css"; do
  curl -fsS -o /dev/null -w '%{http_code} %{content_type}\n' "$base$file" | tee "$t/r.txt"
  grep -qE '^200 text/(javascript|css); charset=utf-8$' "$t/r.txt"
done
echo "-- /screen without the slash goes to the page"
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' "$base/screen" | tee "$t/r.txt"
grep -qxF "308 $base/screen/" "$t/r.txt"
