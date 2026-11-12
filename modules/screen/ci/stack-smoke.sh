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
echo "-- the offline worker, the virtual screen and the kiosk check come through Caddy"
curl -fsS -o /dev/null -w '%{http_code} %{content_type}\n' "$base/screen/sw.js?v=x" | tee "$t/r.txt"
grep -qxF "200 text/javascript; charset=utf-8" "$t/r.txt"
curl -fsS "$base/screen/zones/main" | grep -qF 'data-page="zone" data-zone="main"'
curl -fsS "$base/screen/check" | grep -qF 'data-page="check"'
echo "-- a zone's state is for a signed-in person only (403 where admin is for the venue alone)"
curl -sS -o /dev/null -w '%{http_code}\n' "$base/api/screen/zones/main/state" | tee "$t/r.txt"
grep -qxE '40[13]' "$t/r.txt"
