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
# has NAME ERE: the last output matches ERE
has() { if grep -Eq -- "$2" <<<"$out"; then pass "$1"; else bad "$1 (no match for: $2)" "$out"; fi; }
# family V: the last output's dry-run lines for one family (4 = iptables, 6 = ip6tables)
family() { if [ "$1" = 4 ]; then grep -E '^would iptables' <<<"$out"; else grep -E '^would ip6tables' <<<"$out"; fi; }
# fam NAME V ERE / famnot NAME V ERE: a line of that family matches / no line does
fam() { if family "$2" | grep -Eq -- "$3"; then pass "$1"; else bad "$1 (no IPv$2 match for: $3)" "$out"; fi; }
famnot() { if family "$2" | grep -Eq -- "$3"; then bad "$1 (unexpected IPv$2 match: $3)" "$out"; else pass "$1"; fi; }

unreachable=tcp://127.0.0.1:1
docker_ok=0; command -v docker >/dev/null && docker info >/dev/null 2>&1 && docker_ok=1

echo "# install"
exits "install rejects an unknown option" 2 setup/install --bogus
has "install prints its usage" "usage: install"
exits "install fails against an unreachable daemon" 2 env DOCKER_HOST=$unreachable setup/install
has "install names the unreachable daemon" "cannot reach the Docker daemon"
exits "install --dry-run fails against an unreachable daemon" 2 env DOCKER_HOST=$unreachable setup/install --dry-run
if [ "$docker_ok" = 1 ]; then
  exits "install --dry-run --boot refuses an empty CP_WEB_ALLOW" 2 env CP_ENV_FILE=<(printf 'CP_WEB_ALLOW=\n') setup/install --dry-run --boot
  has "install --boot names CP_WEB_ALLOW" "CP_WEB_ALLOW is empty"
  exits "install --dry-run --boot with an allow list" 0 env CP_ENV_FILE=<(printf 'CP_WEB_ALLOW=192.0.2.1\n') setup/install --dry-run --boot
  fw=$(grep -nE 'cp-firewall' <<<"$out" | head -1 | cut -d: -f1)
  up=$(grep -nE 'compose .*up' <<<"$out" | head -1 | cut -d: -f1)
  if [ -n "$fw" ] && [ -n "$up" ] && [ "$fw" -lt "$up" ]; then pass "install --boot puts the firewall in place before the stack starts"
  else bad "install --boot puts the firewall in place before the stack starts" "$out"; fi
  has "install --boot enables docker, cp-firewall and cp-stack at boot" "enable docker cp-firewall cp-stack"
  has "install --boot ends with check-boot" "check-boot"
  n=$(grep -cE 'compose .*up' <<<"$out")
  if [ "$n" = 1 ]; then pass "install --boot starts the stack once"; else bad "install --boot starts the stack once ($n times)" "$out"; fi
  exits "install --boot validates deploy/.env, not the environment" 2 env CP_WEB_ALLOW=192.0.2.1 CP_ENV_FILE=/nonexistent setup/install --dry-run --boot
  has "install --boot ignores CP_WEB_ALLOW from the environment" "CP_WEB_ALLOW is empty"
else
  skip "install --dry-run --boot" "no reachable Docker daemon"
fi

echo "# firewall"
exits "firewall rejects an unknown command" 2 setup/firewall bogus
has "firewall prints its usage" "usage: firewall"
exits "firewall apply refuses an empty allow list" 2 env CP_WEB_ALLOW= setup/firewall apply --dry-run
has "firewall names CP_WEB_ALLOW" "CP_WEB_ALLOW is empty"
exits "firewall apply refuses 'any' mixed with addresses" 2 env CP_WEB_ALLOW="any 192.0.2.1" setup/firewall apply --dry-run
has "firewall explains 'any' stands alone" "'any' must be the only entry"
exits "firewall apply refuses a hostname" 2 env CP_WEB_ALLOW=example.org setup/firewall apply --dry-run
has "firewall names the bad entry" "not an IPv4 or IPv6 address: example.org"
for e in 300.1.1.1 10.0.0.0/40 1.2.3 2001:db8::/200 : "::" 2001:::1; do
  exits "firewall apply refuses $e" 2 env CP_WEB_ALLOW="$e" setup/firewall apply --dry-run
done
exits "firewall apply accepts a /0 and a full IPv6 address" 0 env CP_WEB_ALLOW="0.0.0.0/0 2001:db8:0:0:0:0:0:1/128" setup/firewall apply --dry-run

exits "firewall apply --dry-run, IPv4 and IPv6 sources" 0 env CP_WEB_ALLOW="192.0.2.1, 2001:db8::/32" setup/firewall apply --dry-run
for p in 80 443; do
  fam "IPv4 source allowed to port $p" 4 "-A CP-FIREWALL -s 192.0.2.1 -p tcp -m conntrack --ctstate DNAT --ctorigdstport $p -j RETURN"
  fam "IPv6 source allowed to port $p" 6 "-A CP-FIREWALL -s 2001:db8::/32 -p tcp -m conntrack --ctstate DNAT --ctorigdstport $p -j RETURN"
done
famnot "IPv6 source not in the IPv4 rules" 4 "2001:db8"
famnot "IPv4 source not in the IPv6 rules" 6 "192\.0\.2\.1"
for v in 4 6; do
  fam "IPv$v keeps established connections" $v "-A CP-FIREWALL -m conntrack --ctstate RELATED,ESTABLISHED -j RETURN"
  fam "IPv$v drops other published traffic" $v "-A CP-FIREWALL -m conntrack --ctstate DNAT -j DROP"
  fam "IPv$v hooks the chain into DOCKER-USER" $v "-I DOCKER-USER 1 -j CP-FIREWALL"
done
others=$( { family 4; family 6; } | grep -oE 'ctorigdstport [0-9]+' | grep -vE ' (80|443)$')
if [ -z "$others" ]; then pass "only ports 80 and 443 are opened"; else bad "only ports 80 and 443 are opened" "$others"; fi

exits "firewall apply --dry-run, IPv4 only" 0 env CP_WEB_ALLOW=192.0.2.1 setup/firewall apply --dry-run
famnot "IPv4-only list opens nothing on IPv6" 6 "ctorigdstport|-s "
fam "IPv4-only list still drops published IPv6 traffic" 6 "--ctstate DNAT -j DROP"

exits "firewall apply --dry-run, any" 0 env CP_WEB_ALLOW=any setup/firewall apply --dry-run
for v in 4 6; do for p in 80 443; do
  fam "'any' opens port $p on IPv$v" $v "-A CP-FIREWALL -p tcp -m conntrack --ctstate DNAT --ctorigdstport $p -j RETURN"
done; done
famnot "'any' adds no source match" 4 "-s "

exits "firewall reads CP_WEB_ALLOW from an env file" 0 env -u CP_WEB_ALLOW CP_ENV_FILE=<(printf 'CP_WEB_ALLOW=198.51.100.7\n') setup/firewall apply --dry-run
fam "the env file's source is allowed" 4 "-s 198.51.100.7 "

exits "firewall close --dry-run" 0 setup/firewall close --dry-run
for v in 4 6; do
  fam "close drops published traffic on IPv$v" $v "--ctstate DNAT -j DROP"
  famnot "close opens nothing on IPv$v" $v "--ctorigdstport"
done
exits "firewall remove --dry-run" 0 setup/firewall remove --dry-run
for v in 4 6; do fam "remove unhooks the chain on IPv$v" $v "-D DOCKER-USER -j CP-FIREWALL"; done
if [ "$(id -u)" != 0 ]; then
  exits "firewall apply without root fails clearly" 2 env CP_WEB_ALLOW=192.0.2.1 setup/firewall apply
  has "firewall says it needs root" "needs root"
  exits "firewall check without root fails clearly" 2 setup/firewall check
fi

echo "# systemd units"
unit() { grep -E "^$2=" "setup/$1" | sed "s/^$2=//"; }
if unit cp-firewall.service Before | grep -qw docker.service; then pass "cp-firewall runs before docker"; else bad "cp-firewall runs before docker"; fi
if unit cp-firewall.service ExecStart | grep -q 'firewall close'; then pass "cp-firewall closes the web ports when apply fails"; else bad "cp-firewall closes the web ports when apply fails"; fi
if unit cp-stack.service Requires | grep -qw cp-firewall.service && unit cp-stack.service After | grep -qw cp-firewall.service
then pass "cp-stack needs and follows cp-firewall"; else bad "cp-stack needs and follows cp-firewall"; fi
if unit cp-firewall.service RequiredBy | grep -qw docker.service; then pass "docker requires cp-firewall (no start without the firewall)"; else bad "docker requires cp-firewall (no start without the firewall)"; fi
if unit cp-firewall.service ExecStart | grep -q 'close; exit 1'; then bad "a closed firewall lets docker start"; else pass "a closed firewall lets docker start"; fi
if command -v systemd-analyze >/dev/null && systemctl cat docker.service >/dev/null 2>&1; then
  tmp=$(mktemp -d)
  for u in cp-firewall.service cp-stack.service; do sed "s#@REPO@#$PWD#g" "setup/$u" > "$tmp/$u"; done
  run systemd-analyze verify "$tmp/cp-firewall.service" "$tmp/cp-stack.service"
  rm -rf "$tmp"
  if [ "$rc" = 0 ] && ! grep -q "$tmp" <<<"$out"; then pass "systemd-analyze verify accepts both units"; else bad "systemd-analyze verify accepts both units" "$out"; fi
else
  skip "systemd-analyze verify" "no systemd or no docker.service"
fi

echo "# compose"
if command -v docker >/dev/null && docker compose version >/dev/null 2>&1 && command -v jq >/dev/null; then
  ports=$(docker compose -f deploy/compose.yml config --format json 2>/dev/null \
    | jq -c '[.services.caddy.ports[] | "\(.host_ip)|\(.published)|\(.target)"] | sort')
  want='["0.0.0.0|443|443","0.0.0.0|80|80","::|443|443","::|80|80"]'
  if [ "$ports" = "$want" ]; then pass "caddy publishes 80 and 443 explicitly on 0.0.0.0 and ::"
  else bad "caddy publishes 80 and 443 explicitly on 0.0.0.0 and ::" "got $ports, want $want"; fi
else
  skip "compose ports" "no docker compose or jq"
fi

echo "# check-boot"
exits "check-boot --dry-run" 0 setup/check-boot --dry-run
has "check-boot checks cp-firewall" "cp-firewall"
has "check-boot checks IPv6" "IPv6"
has "check-boot checks that docker requires cp-firewall" "docker.service requires cp-firewall"
if grep -q 'jq' setup/check-boot; then bad "check-boot does not need jq"; else pass "check-boot does not need jq"; fi
exits "firewall check --dry-run" 0 setup/firewall check --dry-run
has "firewall check looks at the final DROP" "DROP"
has "firewall check looks at FORWARD -> DOCKER-USER" "FORWARD"

echo "# shellcheck"
if command -v shellcheck >/dev/null; then
  exits "shellcheck" 0 shellcheck setup/install setup/firewall setup/check-boot setup/test.sh
else
  skip "shellcheck" "not installed"
fi

[ "$fail" = 0 ] && echo "all setup checks passed" || echo "setup checks FAILED"
exit $fail
