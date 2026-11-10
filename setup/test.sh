#!/usr/bin/env bash
# Self-test for the setup scripts. Needs no root and never changes the host: every script runs
# with --dry-run or against an unreachable Docker daemon. Tests that need the docker CLI or a
# reachable daemon are skipped (with a message) when those are missing.
# Usage: setup/test.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2
fail=0
pass() { echo "ok   $1"; }
bad() { echo "FAIL $1"; [ -n "${2:-}" ] && printf '%s\n' "$2" | sed 's/^/     | /'; fail=1; }
skip() { echo "skip $1 ($2)"; }

# run CMD...: sets $out (stdout+stderr) and $rc
run() { out=$("$@" 2>&1); rc=$?; }
# exits NAME RC CMD...: CMD exits with RC
exits() { local n=$1 want=$2; shift 2; run "$@"; if [ "$rc" = "$want" ]; then pass "$n"; else bad "$n (exit $rc, want $want)" "$out"; fi; }
# has NAME ERE: the last output matches ERE; hasnt: it does not
has() { if grep -Eq -- "$2" <<<"$out"; then pass "$1"; else bad "$1 (no match for: $2)" "$out"; fi; }
hasnt() { if grep -Eq -- "$2" <<<"$out"; then bad "$1 (unexpected match: $2)" "$out"; else pass "$1"; fi; }
# family V: the last output's dry-run lines for one family (4 = iptables, 6 = ip6tables)
family() { if [ "$1" = 4 ]; then grep -E '^would iptables' <<<"$out"; else grep -E '^would ip6tables' <<<"$out"; fi; }
# fam NAME V ERE / famnot NAME V ERE: a line of that family matches / no line does
fam() { if family "$2" | grep -Eq -- "$3"; then pass "$1"; else bad "$1 (no IPv$2 match for: $3)" "$out"; fi; }
famnot() { if family "$2" | grep -Eq -- "$3"; then bad "$1 (unexpected IPv$2 match: $3)" "$out"; else pass "$1"; fi; }

unreachable=tcp://127.0.0.1:1
# envfile CONTENT: a throwaway env file (a real file: scripts may read it more than once)
scratch=$(mktemp -d); trap 'rm -rf "$scratch"' EXIT
envfile() { local f; f=$(mktemp "$scratch/env.XXXXXX"); printf '%b' "$1" > "$f"; echo "$f"; }
docker_ok=0; command -v docker >/dev/null && docker info >/dev/null 2>&1 && docker_ok=1
# logged NAME ERE / notlogged NAME ERE: the stubs logged a call matching ERE / logged none; the
# stub state directory is $stub (set by ifresh and fresh in the sourced sections)
logged() { if grep -Eq -- "$2" "$stub/log"; then pass "$1"; else bad "$1 (not called: $2)" "$(cat "$stub/log")"; fi; }
notlogged() { if grep -Eq -- "$2" "$stub/log"; then bad "$1 (called: $2)" "$(cat "$stub/log")"; else pass "$1"; fi; }

# shellcheck source=setup/test-install.sh
. setup/test-install.sh

echo "# firewall"
exits "firewall rejects an unknown command" 2 setup/firewall bogus
has "firewall prints its usage" "usage: firewall"
exits "firewall apply refuses an empty allow list" 2 env CANCCU_WEB_ALLOW= setup/firewall apply --dry-run
has "firewall names CANCCU_WEB_ALLOW" "CANCCU_WEB_ALLOW is empty"
exits "firewall apply refuses 'any' mixed with addresses" 2 env CANCCU_WEB_ALLOW="any 192.0.2.1" setup/firewall apply --dry-run
has "firewall explains 'any' stands alone" "'any' must be the only entry"
exits "firewall apply refuses a hostname" 2 env CANCCU_WEB_ALLOW=example.org setup/firewall apply --dry-run
has "firewall names the bad entry" "not an IPv4 or IPv6 address: example.org"
for e in 300.1.1.1 10.0.0.0/40 1.2.3 2001:db8::/200 : "::" 2001:::1; do
  exits "firewall apply refuses $e" 2 env CANCCU_WEB_ALLOW="$e" setup/firewall apply --dry-run
done
exits "firewall apply accepts /0s and a full IPv6 address" 0 env CANCCU_WEB_ALLOW="0.0.0.0/0 ::/0 2001:db8:0:0:0:0:0:1/128" setup/firewall apply --dry-run

exits "firewall apply --dry-run, IPv4 and IPv6 sources" 0 env CANCCU_WEB_ALLOW="192.0.2.1, 2001:db8::/32" setup/firewall apply --dry-run
for p in 80 443; do
  fam "IPv4 source allowed to port $p" 4 "-A CANCCU-FIREWALL -s 192.0.2.1 -p tcp -m conntrack --ctstate DNAT --ctorigdstport $p -j RETURN"
  fam "IPv6 source allowed to port $p" 6 "-A CANCCU-FIREWALL -s 2001:db8::/32 -p tcp -m conntrack --ctstate DNAT --ctorigdstport $p -j RETURN"
done
famnot "IPv6 source not in the IPv4 rules" 4 "2001:db8"
famnot "IPv4 source not in the IPv6 rules" 6 "192\.0\.2\.1"
for v in 4 6; do
  fam "IPv$v keeps established connections" $v "-A CANCCU-FIREWALL -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN"
  fam "IPv$v drops other published traffic" $v "-A CANCCU-FIREWALL -m conntrack --ctstate DNAT -j DROP"
  fam "IPv$v hooks the chain into DOCKER-USER" $v "-I DOCKER-USER 1 -j CANCCU-FIREWALL"
done
others=$( { family 4; family 6; } | grep -oE 'ctorigdstport [0-9]+' | grep -vE ' (80|443)$')
if [ -z "$others" ]; then pass "only ports 80 and 443 are opened"; else bad "only ports 80 and 443 are opened" "$others"; fi

exits "firewall apply --dry-run, IPv4 only" 0 env CANCCU_WEB_ALLOW=192.0.2.1 setup/firewall apply --dry-run
famnot "IPv4-only list opens nothing on IPv6" 6 "ctorigdstport|-s "
fam "IPv4-only list still drops published IPv6 traffic" 6 "--ctstate DNAT -j DROP"

exits "firewall apply --dry-run, any" 0 env CANCCU_WEB_ALLOW=any setup/firewall apply --dry-run
for v in 4 6; do for p in 80 443; do
  fam "'any' opens port $p on IPv$v" $v "-A CANCCU-FIREWALL -p tcp -m conntrack --ctstate DNAT --ctorigdstport $p -j RETURN"
done; done
famnot "'any' adds no source match" 4 "-s "

exits "firewall reads CANCCU_WEB_ALLOW from an env file" 0 env -u CANCCU_WEB_ALLOW CANCCU_ENV_FILE="$(envfile 'CANCCU_WEB_ALLOW=198.51.100.7\n')" setup/firewall apply --dry-run
fam "the env file's source is allowed" 4 "-s 198.51.100.7 "

exits "firewall close --dry-run" 0 setup/firewall close --dry-run
for v in 4 6; do
  fam "close drops published traffic on IPv$v" $v "--ctstate DNAT -j DROP"
  famnot "close opens nothing on IPv$v" $v "--ctorigdstport"
done
exits "firewall remove --dry-run" 0 setup/firewall remove --dry-run
for v in 4 6; do fam "remove unhooks the chain on IPv$v" $v "-D DOCKER-USER -j CANCCU-FIREWALL"; done
if [ "$(id -u)" != 0 ]; then
  exits "firewall apply without root fails clearly" 2 env CANCCU_WEB_ALLOW=192.0.2.1 setup/firewall apply
  has "firewall says it needs root" "needs root"
  exits "firewall check without root fails clearly" 2 setup/firewall check
fi

echo "# systemd units"
unit() { grep -E "^$2=" "setup/$1" | sed "s/^$2=//"; }
if unit canccu-firewall.service Before | grep -qw docker.service; then pass "canccu-firewall runs before docker"; else bad "canccu-firewall runs before docker"; fi
if unit canccu-firewall.service ExecStart | grep -q 'firewall close'; then pass "canccu-firewall closes the web ports when apply fails"; else bad "canccu-firewall closes the web ports when apply fails"; fi
if unit canccu-stack.service Requires | grep -qw canccu-firewall.service && unit canccu-stack.service After | grep -qw canccu-firewall.service
then pass "canccu-stack needs and follows canccu-firewall"; else bad "canccu-stack needs and follows canccu-firewall"; fi
if unit canccu-firewall.service RequiredBy | grep -qw docker.service; then pass "docker requires canccu-firewall (no start without the firewall)"; else bad "docker requires canccu-firewall (no start without the firewall)"; fi
if [ "$(unit canccu-firewall.service ExecReload)" = "$(unit canccu-firewall.service ExecStart)" ]; then pass "canccu-firewall reloads with the same command"; else bad "canccu-firewall reloads with the same command"; fi
# run the unit's ExecStart against a stub setup/firewall: APPLY and CLOSE are the stub's exit codes
execstart() {
  local d; d=$(mktemp -d); mkdir "$d/setup"
  # shellcheck disable=SC2016  # $1 belongs to the stub script
  printf '#!/bin/sh\ncase "$1" in apply) exit %s ;; close) exit %s ;; esac\nexit 9\n' "$1" "$2" > "$d/setup/firewall"
  chmod +x "$d/setup/firewall"
  out=$(eval "$(unit canccu-firewall.service ExecStart | sed "s#@REPO@#$d#g")" 2>&1); rc=$?
  rm -rf "$d"
}
execstart 0 9; if [ "$rc" = 0 ]; then pass "canccu-firewall succeeds when apply works"; else bad "canccu-firewall succeeds when apply works (exit $rc)" "$out"; fi
execstart 2 0; if [ "$rc" = 0 ]; then pass "a closed firewall lets docker start"; else bad "a closed firewall lets docker start (exit $rc)" "$out"; fi
execstart 2 3; if [ "$rc" != 0 ]; then pass "canccu-firewall fails (Docker held back) when close fails too"; else bad "canccu-firewall fails (Docker held back) when close fails too"; fi
if grep -q '/usr/bin/docker' setup/canccu-stack.service || ! grep -q '@DOCKER@' setup/canccu-stack.service
then bad "canccu-stack gets the docker path from install (@DOCKER@)"; else pass "canccu-stack gets the docker path from install (@DOCKER@)"; fi
if grep -q 'restart canccu-firewall' setup/check-boot setup/README.md; then bad "docs and hints never restart canccu-firewall"; else pass "docs and hints never restart canccu-firewall"; fi
if grep -q 'failed, the web ports are closed' setup/install; then bad "install does not claim closed ports when canccu-firewall failed"; else pass "install does not claim closed ports when canccu-firewall failed"; fi
if unit canccu-deploy.timer OnUnitInactiveSec | grep -q . && unit canccu-deploy.timer WantedBy | grep -qw timers.target
then pass "canccu-deploy.timer runs the deploy again and again, from boot"; else bad "canccu-deploy.timer runs the deploy again and again, from boot"; fi
if [ "$(unit canccu-deploy.service ExecStart)" = "@REPO@/setup/deploy" ] && unit canccu-deploy.service After | grep -qw canccu-stack.service
then pass "canccu-deploy runs setup/deploy after the stack has started"; else bad "canccu-deploy runs setup/deploy after the stack has started"; fi
if [ "$(unit canccu-deploy.service StateDirectory)" = canccu-deploy ]; then pass "canccu-deploy keeps its state in /var/lib/canccu-deploy"; else bad "canccu-deploy keeps its state in /var/lib/canccu-deploy"; fi
if command -v systemd-analyze >/dev/null && systemctl cat docker.service >/dev/null 2>&1; then
  tmp=$(mktemp -d)
  for u in canccu-firewall.service canccu-stack.service canccu-deploy.service canccu-deploy.timer; do sed "s#@REPO@#$PWD#g; s#@DOCKER@#$(command -v docker || echo /usr/bin/docker)#g" "setup/$u" > "$tmp/$u"; done
  run systemd-analyze verify "$tmp/canccu-firewall.service" "$tmp/canccu-stack.service" "$tmp/canccu-deploy.service" "$tmp/canccu-deploy.timer"
  rm -rf "$tmp"
  if [ "$rc" = 0 ] && ! grep -q "$tmp" <<<"$out"; then pass "systemd-analyze verify accepts the units"; else bad "systemd-analyze verify accepts the units" "$out"; fi
else
  skip "systemd-analyze verify" "no systemd or no docker.service"
fi

echo "# compose"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1 && command -v jq >/dev/null; then
  ports=$(docker compose -f deploy/compose.yml config --format json 2>/dev/null \
    | jq -c '[.services.caddy.ports[] | "\(.host_ip)|\(.published)|\(.target)"] | sort')
  # Only 80: in http mode caddy serves nothing on 443, and a host service (Tailscale serve) may
  # hold 443, so publishing it makes every deploy and rollback fail (#255). TLS (#5) adds it back.
  want='["0.0.0.0|80|80","::|80|80"]'
  if [ "$ports" = "$want" ]; then pass "caddy publishes only 80, explicitly on 0.0.0.0 and ::"
  else bad "caddy publishes only 80, explicitly on 0.0.0.0 and ::" "got $ports, want $want"; fi
  if docker compose -f deploy/compose.yml config --format json 2>/dev/null \
    | jq -e '.networks.default.enable_ipv6 == true and ([.networks.default.ipam.config[]?.subnet | select(test("^fd[0-9a-f]{2}:.*/64$"))] | length == 1)' >/dev/null
  then pass "the default network has IPv6 (a ULA /64), so Docker NATs IPv6 through ip6tables"
  else bad "the default network has IPv6 (a ULA /64), so Docker NATs IPv6 through ip6tables"; fi
  # The files volume layout (setup/README.md, Files volume): files-init hands it to uid 65534
  # before any module mounts it, and every module that mounts it runs as that user.
  mounters='def mounters: .services | to_entries[]
    | select([.value.volumes[]? | select(.type == "volume" and .source == "files")] | length > 0);'
  # Prints each built service mounting files that does not run as nobody. Compose's `user:` wins
  # over the image's USER, and the Dockerfile is the one the config builds from, not a guess.
  not_nobody() {
    jq -r "$mounters"' mounters | select(.value.build) | .value.build as $b
      | [.key, (($b.dockerfile // "Dockerfile") as $d | if ($d | startswith("/")) then $d else "\($b.context)/\($d)" end),
         .value.user // ""] | join("\u001f")' <<<"$1" |
    while IFS=$'\x1f' read -r s dockerfile user; do
      if [ -z "$user" ]; then
        [ -r "$dockerfile" ] || { echo "$s has no readable Dockerfile at $dockerfile"; continue; }
        user=$(grep -E '^USER ' "$dockerfile" | tail -n1 | cut -d' ' -f2)
      fi
      case $user in nobody|65534|nobody:nobody|65534:65534) ;; *) echo "$s runs as ${user:-root}" ;; esac
    done
  }
  for f in deploy/compose.yml "deploy/compose.yml -f deploy/compose.ci.yml"; do
    # shellcheck disable=SC2086  # $f is two compose arguments on purpose
    config=$(docker compose -f $f config --format json 2>"$scratch/config.err")
    # An unreadable config would leave every check below with nothing to find, which reads as a pass.
    if ! jq -e '.services["files-init"]' <<<"$config" >/dev/null 2>&1; then
      bad "compose config with files-init ($f)" "$(cat "$scratch/config.err")"; continue
    fi
    late=$(jq -r "$mounters"' mounters | select(.key != "files-init")
      | select(.value.depends_on["files-init"].condition != "service_completed_successfully") | .key' <<<"$config")
    if [ -z "$late" ]; then pass "every service mounting files waits for files-init ($f)"
    else bad "every service mounting files waits for files-init ($f)" "$late"; fi
    # The Caddy image declares VOLUME /data /config: without a tmpfs there, each run of a one-shot
    # on it leaves two anonymous volumes behind.
    litter=$(jq -r '.services | to_entries[] | select(.value.image // "" | startswith("caddy:"))
      | select((.value.tmpfs // []) as $t | ($t | index("/data")) == null or ($t | index("/config")) == null) | .key' <<<"$config")
    if [ -z "$litter" ]; then pass "every service on the Caddy image keeps /data and /config in tmpfs ($f)"
    else bad "every service on the Caddy image keeps /data and /config in tmpfs ($f)" "$litter"; fi
    [ "$f" = deploy/compose.yml ] || continue
    if jq -e '.services["files-init"] | .network_mode == "none" and .read_only == true and .cap_drop == ["ALL"]
        and (.cap_add | sort) == ["CHOWN", "DAC_READ_SEARCH"] and (.command | join(" ") | test("65534:65534"))' <<<"$config" >/dev/null
    then pass "files-init has no network, a read-only root, only CHOWN and DAC_READ_SEARCH, and chowns to 65534"
    else bad "files-init has no network, a read-only root, only CHOWN and DAC_READ_SEARCH, and chowns to 65534" "$(jq '.services["files-init"]' <<<"$config")"; fi
    modules=$(jq -r "$mounters"' mounters | select(.value.build) | .key' <<<"$config")
    wrong=$(not_nobody "$config")
    if [ -n "$modules" ] && [ -z "$wrong" ]; then pass "every module mounting files runs as nobody (65534), the volume's owner"
    else bad "every module mounting files runs as nobody (65534), the volume's owner" "${wrong:-no module mounts files}"; fi
  done
  # The check above must be able to fail: a compose user: and a Dockerfile without USER.
  printf 'services:\n  hello:\n    user: "1000"\n' > "$scratch/user.yml"
  printf 'FROM scratch\n' > "$scratch/Dockerfile.root"
  printf 'services:\n  hello:\n    build:\n      dockerfile: %s\n' "$scratch/Dockerfile.root" > "$scratch/root.yml"
  for o in user:"hello runs as 1000" root:"hello runs as root"; do
    wrong=$(not_nobody "$(docker compose -f deploy/compose.yml -f "$scratch/${o%%:*}.yml" config --format json 2>&1)")
    if [ "$wrong" = "${o#*:}" ]; then pass "the nobody check catches: ${o#*:}"
    else bad "the nobody check catches: ${o#*:}" "got: $wrong"; fi
  done
else
  skip "compose ports and network" "no docker compose or jq"
fi

echo "# IPv6 bypass (docker-proxy forwarding IPv6 to an IPv4-only container)"
proxy() { printf '/usr/bin/docker-proxy -proto tcp -host-ip %s -host-port %s -container-ip %s -container-port 80 -use-listen-fd\n' "$@"; }
exits "bypass found: :: port 80 to an IPv4 container" 1 env CANCCU_PROXY_ARGS=<(proxy :: 80 172.18.0.5) setup/firewall bypass
has "bypass names the port" "port 80"
exits "bypass found: :: port 443 to an IPv4 container" 1 env CANCCU_PROXY_ARGS=<(proxy :: 443 172.18.0.5) setup/firewall bypass
exits "no bypass: :: port 80 to an IPv6 container" 0 env CANCCU_PROXY_ARGS=<(proxy :: 80 fd00:1::2) setup/firewall bypass
exits "no bypass: IPv4 binding" 0 env CANCCU_PROXY_ARGS=<(proxy 0.0.0.0 80 172.18.0.5) setup/firewall bypass
exits "no bypass: another port" 0 env CANCCU_PROXY_ARGS=<(proxy ::1 18092 172.18.0.5) setup/firewall bypass
exits "no bypass: no proxies" 0 env CANCCU_PROXY_ARGS=/dev/null setup/firewall bypass

echo "# check-boot"
exits "check-boot --dry-run" 0 setup/check-boot --dry-run
has "check-boot checks canccu-firewall" "canccu-firewall"
has "check-boot checks IPv6" "IPv6"
has "check-boot checks that docker requires canccu-firewall" "docker.service requires canccu-firewall"
has "check-boot checks the services are running and healthy" "running and healthy"
has "check-boot checks the auto-deploy timer" "canccu-deploy.timer enabled"
if grep -q 'jq' setup/check-boot; then bad "check-boot does not need jq"; else pass "check-boot does not need jq"; fi
exits "firewall check --dry-run" 0 setup/firewall check --dry-run
has "firewall check looks at the final DROP" "DROP"
has "firewall check looks at FORWARD -> DOCKER-USER" "FORWARD"

# shellcheck source=setup/test-deploy.sh
. setup/test-deploy.sh

echo "# shellcheck"
if command -v shellcheck >/dev/null; then
  # New ShellCheck versions add rules (SC2329 in 0.11). CI pins one; a local run uses whatever
  # is installed, so the log names the version that ran.
  v=$(shellcheck --version | sed -n 's/^version: //p')
  echo "     shellcheck ${v:-unknown}"
  exits "shellcheck" 0 shellcheck -x setup/install setup/firewall setup/check-boot setup/deploy setup/lib.sh setup/test.sh setup/test-install.sh setup/test-deploy.sh
else
  skip "shellcheck" "not installed"
fi

[ "$fail" = 0 ] && echo "all setup checks passed" || echo "setup checks FAILED"
exit $fail
