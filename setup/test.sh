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

echo "# install"
exits "install rejects an unknown option" 2 setup/install --bogus
has "install prints its usage" "usage: install"
exits "install fails against an unreachable daemon" 2 env DOCKER_HOST=$unreachable setup/install
has "install names the unreachable daemon" "cannot reach the Docker daemon"
exits "install --dry-run fails against an unreachable daemon" 2 env DOCKER_HOST=$unreachable setup/install --dry-run
if [ "$docker_ok" = 1 ]; then
  exits "install --dry-run --boot refuses an empty CANCCU_WEB_ALLOW" 2 env CANCCU_ENV_FILE="$(envfile 'CANCCU_WEB_ALLOW=\n')" setup/install --dry-run --boot
  has "install --boot names CANCCU_WEB_ALLOW" "CANCCU_WEB_ALLOW is empty"
  exits "install --dry-run --boot with an allow list" 0 env CANCCU_ENV_FILE="$(envfile 'CANCCU_WEB_ALLOW=192.0.2.1\n')" setup/install --dry-run --boot
  fw=$(grep -nE 'canccu-firewall' <<<"$out" | head -1 | cut -d: -f1)
  up=$(grep -nE 'compose .*up' <<<"$out" | head -1 | cut -d: -f1)
  if [ -n "$fw" ] && [ -n "$up" ] && [ "$fw" -lt "$up" ]; then pass "install --boot puts the firewall in place before the stack starts"
  else bad "install --boot puts the firewall in place before the stack starts" "$out"; fi
  has "install --boot enables docker, canccu-firewall and canccu-stack at boot" "enable docker canccu-firewall canccu-stack"
  has "install --boot ends with check-boot" "check-boot"
  has "install --boot enables the auto-deploy timer" "enable --now canccu-deploy.timer"
  n=$(grep -cE 'compose .*up' <<<"$out")
  if [ "$n" = 1 ]; then pass "install --boot starts the stack once"; else bad "install --boot starts the stack once ($n times)" "$out"; fi
  exits "install --boot validates deploy/.env, not the environment" 2 env CANCCU_WEB_ALLOW=192.0.2.1 CANCCU_ENV_FILE=/nonexistent setup/install --dry-run --boot
  has "install --boot ignores CANCCU_WEB_ALLOW from the environment" "CANCCU_WEB_ALLOW is empty"
  exits "install --dry-run --boot, existing .env" 0 env CANCCU_ENV_FILE="$(envfile 'POSTGRES_PASSWORD=x\nCANCCU_WEB_ALLOW=192.0.2.1\n')" setup/install --dry-run --boot
  has "install --boot reloads canccu-firewall (or starts it)" "reload canccu-firewall"
  hasnt "install --boot never restarts canccu-firewall (that restarts Docker)" "restart canccu-firewall"
  hasnt "install keeps a .env with its own password" "POSTGRES_PASSWORD"
  if docker volume inspect canccuplatform_postgres-data >/dev/null 2>&1; then
    exits "install --boot refuses the example password on an initialised database" 2 env CANCCU_ENV_FILE="$(envfile 'POSTGRES_PASSWORD=change-me\nCANCCU_WEB_ALLOW=192.0.2.1\n')" setup/install --dry-run --boot
    has "install names the example password" "example POSTGRES_PASSWORD"
  else
    exits "install --dry-run --boot, .env with the example password" 0 env CANCCU_ENV_FILE="$(envfile 'POSTGRES_PASSWORD=change-me\nCANCCU_WEB_ALLOW=192.0.2.1\n')" setup/install --dry-run --boot
    has "install replaces the example password while no database exists" "would replace the example POSTGRES_PASSWORD"
  fi
  tmp=$(mktemp -d); cp -r setup deploy "$tmp/"; chmod o+w "$tmp/setup"
  exits "install --boot refuses a setup/ others can write to" 2 env CANCCU_ENV_FILE="$(envfile 'POSTGRES_PASSWORD=x\nCANCCU_WEB_ALLOW=192.0.2.1\n')" "$tmp/setup/install" --dry-run --boot
  has "install names the writable path" "writable by others"
  rm -rf "$tmp"
else
  skip "install --dry-run --boot" "no reachable Docker daemon"
fi

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
  want='["0.0.0.0|443|443","0.0.0.0|80|80","::|443|443","::|80|80"]'
  if [ "$ports" = "$want" ]; then pass "caddy publishes 80 and 443 explicitly on 0.0.0.0 and ::"
  else bad "caddy publishes 80 and 443 explicitly on 0.0.0.0 and ::" "got $ports, want $want"; fi
  if docker compose -f deploy/compose.yml config --format json 2>/dev/null \
    | jq -e '.networks.default.enable_ipv6 == true and ([.networks.default.ipam.config[]?.subnet | select(test("^fd[0-9a-f]{2}:.*/64$"))] | length == 1)' >/dev/null
  then pass "the default network has IPv6 (a ULA /64), so Docker NATs IPv6 through ip6tables"
  else bad "the default network has IPv6 (a ULA /64), so Docker NATs IPv6 through ip6tables"; fi
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

echo "# deploy (auto-deploy of main; docker, git, curl and the firewall are stubs)"
exits "deploy rejects an unknown option" 2 setup/deploy --bogus
has "deploy prints its usage" "usage: deploy"
exits "deploy --dry-run fails against an unreachable daemon" 2 env DOCKER_HOST=$unreachable PATH=/usr/bin:/bin setup/deploy --dry-run
# stubs: one directory of fake tools whose state lives in files under $st (see the case blocks)
stubs=$scratch/stubs; mkdir -p "$stubs/bin"
cat > "$stubs/bin/docker" <<'STUB'
#!/bin/sh
S=$STUB; echo "docker $*" >> "$S/log"
mod() { m=${1##*/}; m=${m%:*}; m=${m#canccuplatform-}; echo "$m"; }
case "$1" in
  info) exit 0 ;;
  pull) [ ! -e "$S/pull_fail" ] ;;
  tag) [ -e "$S/tag_fail_$(mod "$3")" ] && exit 1
       case "$2" in sha256:*) id=$2 ;; *) id=$(cat "$S/remote_$(mod "$2")") ;; esac
       printf '%s\n' "$id" > "$S/live_$(mod "$3")" ;;
  image)
    case "$2" in
      rm) exit 0 ;;
      inspect) case "$5" in
        canccuplatform-*) [ -e "$S/live_$(mod "$5")" ] && cat "$S/live_$(mod "$5")" ;;
        *) case "$4" in *revision*) cat "$S/rev" ;; *) cat "$S/remote_$(mod "$5")" ;; esac ;;
      esac ;;
    esac ;;
  compose) for a; do last=$a; done
    case "$*" in *" up "*) if [ -e "$S/up_kill" ]; then rm "$S/up_kill"; kill -TERM "$PPID"; fi; exit "$(cat "$S/up_rc")" ;; *" ps "*) echo "c_$last" ;; esac ;;
  inspect) cat "$S/live_${4#c_}" ;;
esac
STUB
cat > "$stubs/bin/git" <<'STUB'
#!/bin/sh
S=$STUB; echo "git $*" >> "$S/log"
case "$1 $2" in
  "remote get-url") echo "https://github.com/Example-Org/Example-Repo.git" ;;
  "symbolic-ref --short") cat "$S/branch" ;;
  "status --porcelain") cat "$S/dirty" 2>/dev/null ;;
  "fetch -q") [ ! -e "$S/fetch_fail" ] ;;
  "rev-parse --verify") case "$4" in FETCH_HEAD*) cat "$S/target" ;; *) cat "$S/head" ;; esac ;;
  "diff --quiet") [ ! -e "$S/caddy_changed" ] ;;
  "merge-base --is-ancestor") [ ! -e "$S/diverged" ] ;;
  "ls-tree --name-only") printf 'modules/admin\nmodules/hello\nmodules/nodocker\n' ;;
  "cat-file -e") case "$3" in *nodocker*) exit 1 ;; esac ;;
  "merge -q") echo "$4" > "$S/head" ;;
  "reset -q") echo "$4" > "$S/head" ;;
  *) echo "git stub: unexpected: $*" >&2; exit 9 ;;
esac
STUB
cat > "$stubs/bin/curl" <<'STUB'
#!/bin/sh
S=$STUB; echo "curl $*" >> "$S/log"
case "$*" in
  */issues*) data=; for a; do case "$a" in @*) data=$(cat "${a#@}") ;; esac; done
    cat > "$S/token.in"; printf '%s\n' "$data" >> "$S/issues" ;;
  *) [ ! -e "$S/bad_$(cat "$S/live_hello")" ] || exit 22; echo '{"status":"ok"}' ;;
esac
STUB
# shellcheck disable=SC2016  # $* and $STUB belong to the stub script
printf '#!/bin/sh\necho "firewall $*" >> "$STUB/log"; exit "$(cat "$STUB/fw_rc")"\n' > "$stubs/firewall"
chmod +x "$stubs/bin/"* "$stubs/firewall"
old=1111111111111111111111111111111111111111; new=2222222222222222222222222222222222222222
# fresh [ENV]: reset the stub state: the checkout is at $old, the registry has images built from $new
fresh() {
  st=$(mktemp -d "$scratch/st.XXXXXX"); mkdir "$st/state"
  echo main > "$st/branch"; echo "$old" > "$st/head"; echo "$new" > "$st/target"; echo "$new" > "$st/rev"
  echo 0 > "$st/up_rc"; echo 0 > "$st/fw_rc"; : > "$st/log"
  for m in hello admin; do echo "sha256:old$m" > "$st/live_$m"; echo "sha256:new$m" > "$st/remote_$m"; done
  denv=$(envfile "CANCCU_VERSION=dev\nCANCCU_DEPLOY_GITHUB_TOKEN=test-token\n${1:-}")
}
dep() { exits "$1" "$2" env STUB="$st" PATH="$stubs/bin:$PATH" CANCCU_ENV_FILE="$denv" CANCCU_DEPLOY_STATE="$st/state" CANCCU_DEPLOY_FIREWALL="$stubs/firewall" CANCCU_DEPLOY_WAIT=1 setup/deploy; }
logged() { if grep -Eq -- "$2" "$st/log"; then pass "$1"; else bad "$1 (not called: $2)" "$(cat "$st/log")"; fi; }
notlogged() { if grep -Eq -- "$2" "$st/log"; then bad "$1 (called: $2)" "$(cat "$st/log")"; else pass "$1"; fi; }
issues() { if [ "$( { wc -l < "$st/issues"; } 2>/dev/null || echo 0)" = "$2" ]; then pass "$1"; else bad "$1 (want $2 issues)" "$(cat "$st/issues" 2>/dev/null)"; fi; }

fresh 'CANCCU_VERSION=v0.1.0\n'; dep "deploy does nothing unless the platform version is dev" 0
has "deploy says auto-deploy is off" "not dev"
notlogged "deploy pulls nothing when the platform version is not dev" "docker pull"

fresh; echo "$new" > "$st/head"; echo "sha256:newhello" > "$st/live_hello"; echo "sha256:newadmin" > "$st/live_admin"
dep "deploy with nothing new" 0
has "deploy says it is up to date" "up to date"
notlogged "deploy starts nothing when up to date" "compose .* up "

fresh; echo 3333333333333333333333333333333333333333 > "$st/rev"; dep "deploy waits for the images of the new commit" 0
has "deploy says which images it waits for" "waiting for the images of 2222222"
notlogged "deploy changes nothing while it waits" "merge -q|docker tag|compose .* up "

fresh; dep "deploy of a new merge" 0
logged "deploy pulls the dev images from the repo's registry" "docker pull -q ghcr.io/example-org/example-repo/hello:dev"
logged "deploy pulls only modules with a Dockerfile" "docker pull -q ghcr.io/example-org/example-repo/admin:dev"
notlogged "deploy skips modules without a Dockerfile" "nodocker:dev"
logged "deploy checks the firewall first" "^firewall check"
logged "deploy fast-forwards the checkout to main" "merge -q --ff-only $new"
logged "deploy restarts the stack without building, removing services main dropped" "compose -f deploy/compose.yml up -d --wait --no-build --remove-orphans"
notlogged "deploy leaves caddy alone when the Caddyfile did not change" "force-recreate"
if [ "$(cat "$st/head")" = "$new" ] && [ "$(cat "$st/live_hello")" = sha256:newhello ]; then pass "deploy runs the new commit and images"; else bad "deploy runs the new commit and images" "$(cat "$st/log")"; fi
has "deploy reports health ok" "health ok"
logged "deploy checks health through Caddy" "curl .*127.0.0.1/api/hello/health"
logged "deploy checks the health of every module" "curl .*127.0.0.1/api/admin/health"
if [ ! -e "$st/state/pending" ]; then pass "a finished deploy leaves no pending deploy"; else bad "a finished deploy leaves no pending deploy"; fi
issues "deploy opens no issue on success" 0
logged "deploy removes the replaced images" "image rm sha256:oldhello"

fresh; echo sha256:newhello > "$st/remote_hello"; touch "$st/bad_sha256:newhello"; dep "deploy that fails its health check" 1
if [ "$(cat "$st/head")" = "$old" ] && [ "$(cat "$st/live_hello")" = sha256:oldhello ] && [ "$(cat "$st/live_admin")" = sha256:oldadmin ]
then pass "a failed deploy goes back to the previous commit and images"; else bad "a failed deploy goes back to the previous commit and images" "$(cat "$st/log")"; fi
has "a failed deploy says it rolled back" "rolled back"
issues "a failed deploy opens one issue" 1
if grep -q '2222222' "$st/issues" && grep -q '"labels":\["module:deploy"\]' "$st/issues"; then pass "the issue names the commit and has the module:deploy label"; else bad "the issue names the commit and has the module:deploy label" "$(cat "$st/issues")"; fi
if grep -q '## Goal.*## Acceptance criteria.*## Files likely involved.*## Out of scope' "$st/issues"; then pass "the issue has the standard body"; else bad "the issue has the standard body" "$(cat "$st/issues")"; fi
logged "the issue goes to the repo's GitHub API" "curl .*api.github.com/repos/Example-Org/Example-Repo/issues"
if grep -q test-token "$st/token.in" && ! grep -q test-token "$st/log"; then pass "the token goes to curl on stdin, not on its command line"; else bad "the token goes to curl on stdin, not on its command line" "$(cat "$st/log")"; fi
notlogged "a failed deploy keeps the previous images" "image rm"
: > "$st/log"; dep "deploy after a failed deploy of the same images (still failing)" 1
has "deploy holds a commit that failed before" "holding"
notlogged "deploy does not retry the failed images" "compose .* up "
issues "deploy opens no second issue" 1
if [ ! -e "$st/state/pending" ]; then pass "a rolled-back deploy leaves no pending deploy"; else bad "a rolled-back deploy leaves no pending deploy"; fi
echo sha256:newhello2 > "$st/remote_hello"; : > "$st/log"; dep "deploy retries once the images change" 0
logged "deploy retries once the images change (stack restarted)" "compose .* up "

fresh; touch "$st/caddy_changed"; dep "deploy of a Caddyfile change" 0
logged "deploy recreates caddy when the Caddyfile changed (a bind mount is not reloaded)" "up -d --wait --no-build --force-recreate caddy"
fresh; touch "$st/caddy_changed" "$st/bad_sha256:newhello"; dep "a failed deploy of a Caddyfile change" 1
if [ "$(grep -c 'force-recreate caddy' "$st/log")" = 2 ]; then pass "the rollback recreates caddy with the previous Caddyfile"; else bad "the rollback recreates caddy with the previous Caddyfile" "$(cat "$st/log")"; fi
logged "the rollback removes services the failed commit added" "up -d --wait --no-build --remove-orphans"

fresh; touch "$st/tag_fail_admin"; dep "deploy whose image tag fails" 1
if [ "$(cat "$st/head")" = "$old" ] && [ "$(cat "$st/live_hello")" = sha256:oldhello ]; then pass "a failed tag rolls back"; else bad "a failed tag rolls back" "$(cat "$st/log")"; fi
issues "a failed tag opens an issue" 1

fresh; touch "$st/up_kill" "$st/bad_sha256:newhello"; dep "a deploy killed during compose up" 143
if [ -s "$st/state/pending" ]; then pass "an interrupted deploy leaves a pending deploy"; else bad "an interrupted deploy leaves a pending deploy"; fi
: > "$st/log"; dep "the next run after an interrupted, unhealthy deploy" 1
has "the next run resumes the interrupted deploy" "interrupted"
if [ "$(cat "$st/head")" = "$old" ] && [ "$(cat "$st/live_hello")" = sha256:oldhello ]; then pass "an interrupted, unhealthy deploy is rolled back"; else bad "an interrupted, unhealthy deploy is rolled back" "$(cat "$st/log")"; fi
issues "an interrupted, unhealthy deploy opens an issue" 1
fresh; touch "$st/up_kill"; dep "a healthy deploy killed during compose up" 143
: > "$st/log"; dep "the next run after an interrupted, healthy deploy" 0
has "the interrupted deploy is checked and kept" "deployed 2222222, health ok"
if [ ! -e "$st/state/pending" ] && [ "$(cat "$st/head")" = "$new" ]; then pass "a resumed healthy deploy keeps the new commit"; else bad "a resumed healthy deploy keeps the new commit"; fi
issues "a resumed healthy deploy opens no issue" 0

fresh; echo 1 > "$st/up_rc"; dep "deploy whose containers do not become healthy" 1
issues "an unhealthy stack opens an issue" 1

fresh 'CANCCU_DEPLOY_GITHUB_TOKEN=\n'; touch "$st/bad_sha256:newhello"; dep "a failed deploy without a token" 1
has "deploy says it cannot open an issue without a token" "CANCCU_DEPLOY_GITHUB_TOKEN"
if [ "$(cat "$st/head")" = "$old" ]; then pass "a failed deploy without a token still rolls back"; else bad "a failed deploy without a token still rolls back"; fi

fresh; echo " M modules/hello/src/x.ts" > "$st/dirty"; dep "deploy refuses a checkout with local changes" 2
has "deploy says nobody edits code on the VM" "local changes"
notlogged "deploy changes nothing in an edited checkout" "merge -q|docker tag|compose .* up "
fresh; echo feature > "$st/branch"; dep "deploy refuses a checkout not on main" 2
fresh; touch "$st/diverged"; dep "deploy refuses a checkout that diverged from main" 2
fresh; echo 1 > "$st/fw_rc"; dep "deploy refuses when the firewall is not in place" 2
notlogged "deploy changes nothing without the firewall" "merge -q|docker tag|compose .* up "
fresh; touch "$st/pull_fail"; dep "deploy fails clearly when the registry is unreachable" 2
notlogged "deploy changes nothing when a pull fails" "merge -q|docker tag|compose .* up "

echo "# shellcheck"
if command -v shellcheck >/dev/null; then
  exits "shellcheck" 0 shellcheck setup/install setup/firewall setup/check-boot setup/deploy setup/test.sh
else
  skip "shellcheck" "not installed"
fi

[ "$fail" = 0 ] && echo "all setup checks passed" || echo "setup checks FAILED"
exit $fail
