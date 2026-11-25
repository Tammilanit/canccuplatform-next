#!/usr/bin/env bash
# Tests the edge (deploy/Caddyfile) on its own, #786: deploy/Caddyfile in a throwaway Caddy, with
# a stub answering for every module that echoes what Caddy forwards. Checks every route on both
# listeners: port 80 forwards the peer's own address and never a client's X-Forwarded-For, the
# https front (8480, behind Tailscale serve) forwards the address its proxy names and https, and
# plain http on CANCCU_PUBLIC_URL's host redirects to https. The CI `compose (deploy)` job runs it.
# Needs the docker CLI and a daemon; changes nothing but its own network and containers.
# Usage: deploy/test-edge.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

IMAGE=$(sed -n 's/^ *image: \(caddy:[^ ]*\)$/\1/p' deploy/compose.yml | head -n 1)
[ -n "$IMAGE" ] || { echo "no caddy image in deploy/compose.yml" >&2; exit 2; }
PUBLIC_HOST=edge.example.ts.net
CLIENT=100.64.0.7
fail=0
pass() { echo "ok   $1"; }
bad() { echo "FAIL $1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/     | /'; fail=1; }

run_id=canccu-edge-$$
labels=(--label canccu.test=edge)
# A runner's own label, so its cleanup finds what an interrupted run left behind.
[ -n "${CANCCU_RUN:-}" ] && labels+=(--label "canccu.run=$CANCCU_RUN")
# shellcheck disable=SC2317  # runs from the trap
cleanup() {
  docker rm -f "$run_id-stub" "$run_id-https" "$run_id-http" >/dev/null 2>&1
  docker network rm "$run_id" >/dev/null 2>&1
}
trap cleanup EXIT

# Every upstream the Caddyfile names answers from the stub, under its service name.
aliases=()
while read -r name; do
  aliases+=(--network-alias "$name")
done < <(grep -oE '[a-z][a-z-]*:8080' deploy/Caddyfile | cut -d: -f1 | sort -u)
docker network create "${labels[@]}" "$run_id" >/dev/null || exit 2
docker run -d --name "$run_id-stub" "${labels[@]}" --network "$run_id" "${aliases[@]}" \
  --tmpfs /data --tmpfs /config --entrypoint /bin/sh "$IMAGE" -c '
    printf "{\n\tauto_https off\n\tadmin off\n}\n:8080 {\n\trespond \"%s\"\n}\n" \
      "xff=[{header.X-Forwarded-For}] xfp=[{header.X-Forwarded-Proto}]" > /tmp/Caddyfile &&
    exec caddy run --adapter caddyfile --config /tmp/Caddyfile' >/dev/null || exit 2
# One edge whose public URL is https, one whose is plain http (no redirect there).
for kind in https http; do
  docker run -d --name "$run_id-$kind" "${labels[@]}" --network "$run_id" \
    -e "CANCCU_PUBLIC_URL=$kind://$PUBLIC_HOST" -v "$PWD/deploy/Caddyfile:/etc/caddy/Caddyfile:ro" \
    --tmpfs /data --tmpfs /config "$IMAGE" >/dev/null || exit 2
done

# ask EDGE PORT HOST PATH [HEADER...]: the edge's answer, status and headers, from inside the edge
# itself, so the peer is its loopback: trusted on the front (as Tailscale serve's hop through
# Docker is), a plain client on port 80.
ask() {
  local edge=$1 port=$2 host=$3 path=$4; shift 4
  local args=(-S -q -O - -T 5 --header "Host: $host")
  for h in "$@"; do args+=(--header "$h"); done
  docker exec "$run_id-$edge" wget "${args[@]}" "http://127.0.0.1:$port$path" 2>&1
}

ready=0
for _ in $(seq 1 50); do
  if ask https 80 x /api/hello/health | grep -q 'xff=' && ask http 8480 x /api/hello/health | grep -q 'xff='; then
    ready=1; break
  fi
  sleep 0.2
done
if [ "$ready" != 1 ]; then
  bad "the edge starts with deploy/Caddyfile" "$(docker logs "$run_id-https" 2>&1 | tail -n 20)"
  exit 1
fi

# One path for every route that proxies (the page prefixes' bare forms redirect, tested in
# scripts/demo-stack-test).
paths=(
  /api/hello/health /api/admin/health /api/admin/session /api/tenants/health /api/tenants/current
  /api/screen/health /api/screen/x /screen/ /screen/x /api/theming/health /api/theming/x /theming/x
  /api/agenda/health /api/agenda/x /agenda/ /api/notify/health /api/notify/x /notify/admin/topics
  /api/pizza/health /api/pizza/x /pizza/ /api/moments/health /api/moments/x /moments/on-air
  /admin/screen/devices /admin/ /
)

# Every route forwards exactly one address; a route outside the snippet would forward the chain.
n=$(grep -cE '^\s*reverse_proxy ' deploy/Caddyfile)
if [ "$n" = 1 ]; then pass "every route proxies through the one snippet that sets X-Forwarded-For"
else bad "every route proxies through the one snippet that sets X-Forwarded-For" "reverse_proxy appears $n times"; fi

for p in "${paths[@]}"; do
  out=$(ask https 80 lan.example "$p" "X-Forwarded-For: $CLIENT" "X-Forwarded-Proto: https")
  if grep -qF 'xff=[127.0.0.1] xfp=[http]' <<<"$out"; then pass "port 80 forwards the peer, not a client's X-Forwarded-For: $p"
  else bad "port 80 forwards the peer, not a client's X-Forwarded-For: $p" "$out"; fi

  out=$(ask https 8480 "$PUBLIC_HOST" "$p" "X-Forwarded-For: $CLIENT" "X-Forwarded-Proto: https")
  if grep -qF "xff=[$CLIENT] xfp=[https]" <<<"$out"; then pass "the front forwards its proxy's client and https: $p"
  else bad "the front forwards its proxy's client and https: $p" "$out"; fi
done

# Strict: the front takes the last address its proxy did not add itself, never a client's first.
out=$(ask https 8480 "$PUBLIC_HOST" /api/hello/health "X-Forwarded-For: 198.51.100.9, $CLIENT")
if grep -qF "xff=[$CLIENT]" <<<"$out"; then pass "the front takes the rightmost untrusted address"
else bad "the front takes the rightmost untrusted address" "$out"; fi

out=$(ask https 8480 "$PUBLIC_HOST" /api/hello/health "X-Forwarded-For: fd7a:115c:a1e0::7")
if grep -qF "xff=[fd7a:115c:a1e0::7]" <<<"$out"; then pass "the front forwards a tailnet IPv6 client unchanged"
else bad "the front forwards a tailnet IPv6 client unchanged" "$out"; fi

# Internal peers (screen's cover reads) must not meet the https redirect: they use the front.
if awk '/^  screen:/{s=1;next} /^  [a-z-]+:/{s=0} s' "$(dirname "$0")/compose.yml" | grep -qF 'CANCCU_EDGE_URL: http://caddy:8480'
then pass "screen reads through the front, not the redirecting port 80"
else bad "screen reads through the front, not the redirecting port 80" "CANCCU_EDGE_URL missing on screen in compose.yml"; fi

out=$(ask https 80 "$PUBLIC_HOST" "/admin/sign-in?next=%2Fpizza%2F")
if grep -qE 'HTTP/1\.1 308' <<<"$out" && grep -qiF "Location: https://$PUBLIC_HOST/admin/sign-in?next=%2Fpizza%2F" <<<"$out"
then pass "plain http on the public URL's host redirects to https, path and query kept"
else bad "plain http on the public URL's host redirects to https, path and query kept" "$out"; fi

out=$(ask https 80 lan.example /api/hello/health)
if grep -qF 'xff=' <<<"$out" && ! grep -qE 'HTTP/1\.1 30' <<<"$out"; then pass "plain http on any other host is served"
else bad "plain http on any other host is served" "$out"; fi

out=$(ask https 8480 "$PUBLIC_HOST" /api/hello/health)
if grep -qF 'xff=' <<<"$out" && ! grep -qE 'HTTP/1\.1 30' <<<"$out"; then pass "the front serves the public URL's host"
else bad "the front serves the public URL's host" "$out"; fi

out=$(ask http 80 "$PUBLIC_HOST" /api/hello/health)
if grep -qF 'xff=' <<<"$out" && ! grep -qE 'HTTP/1\.1 30' <<<"$out"; then pass "an http public URL redirects nothing"
else bad "an http public URL redirects nothing" "$out"; fi

[ "$fail" = 0 ] && echo "all edge checks passed"
exit "$fail"
