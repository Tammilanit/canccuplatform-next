#!/usr/bin/env bash
# The screenshot checks of CI's demo-stack run (docs/ci.md#tiers) for the changed modules, on this
# machine before a push (#817): a PR's red shots otherwise show only after a 20–40 minute CI run.
# Usage: shots-local.sh [--dry-run] [MODULE...]
#   without names, the modules changed against CANCCU_SHOTS_BASE (default origin/main): committed,
#   staged, unstaged and untracked
# Each of CI's shards that holds the modules' groups (scripts/shots-local.mjs) gets a fresh demo
# stack, as in CI: one shard's shots change what another's show. On it run the platform smoke,
# which imports the demo event the shots show, and scripts/demo-screenshots in the merge queue's
# check mode: every check of modules/screen/test/stack, the screens at 1920×1080 and 1080×1920 only.
# Prints the failing checks, then one line per module; exits 1 when a check failed. The PNGs and
# each shard's whole log are in shots-local/<shard>/.
# The stack is a Compose project of its own (COMPOSE_PROJECT_NAME, default canccu-shots) beside
# any other: Caddy on a free loopback port, no fixed IPv6 subnet, a deploy-status volume of its
# own. Images build with Docker's layer cache. It is taken down at the end.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

usage() { echo "usage: shots-local.sh [--dry-run] [MODULE...]" >&2; exit 2; }
dry=0
if [ "${1:-}" = "--dry-run" ]; then dry=1; shift; fi
for a in "$@"; do case "$a" in -*) usage ;; esac; done
command -v node >/dev/null || { echo "error: node not found" >&2; exit 2; }
planned=$(node scripts/shots-local.mjs "$@") || exit 2

mods=()
shards=()
while read -r kind name groups who; do
  case "$kind" in
    module) mods+=("$name $groups") ;;
    shard) shards+=("$name $groups $who") ;;
  esac
done <<< "$planned"
if [ ${#mods[@]} = 0 ]; then
  echo "shots-local: no module changed against ${CANCCU_SHOTS_BASE:-origin/main}; name one, e.g. scripts/shots-local.sh screen"
  exit 0
fi

OUT=shots-local
PROJECT=${COMPOSE_PROJECT_NAME:-canccu-shots}
COMPOSE="docker compose -p $PROJECT -f deploy/compose.yml -f deploy/compose.ci.yml -f $OUT/compose.local.yml"
failed=" "

# One line per module, after its shards: a module fails when a shard taking its groups failed.
report() {
  local m groups shard status=0
  for line in "${mods[@]}"; do
    read -r m groups <<< "$line"
    if [ "$groups" = - ]; then echo "ok   $m: no views"; continue; fi
    shard=
    for s in "${shards[@]}"; do
      read -r name _ who <<< "$s"
      if [[ "$failed" == *" $name "* && ",$who," == *",$m,"* ]]; then shard=$name; break; fi
    done
    if [ -n "$shard" ]; then
      echo "FAIL $m (${groups//,/, }): see $OUT/$shard/log.txt"; status=1
    else
      echo "ok   $m (${groups//,/, })"
    fi
  done
  return "$status"
}

if [ "$dry" = 1 ]; then
  if [ ${#shards[@]} != 0 ]; then
    echo "the stack: $COMPOSE (Caddy on a free loopback port, no IPv6 subnet)"
    for s in "${shards[@]}"; do
      read -r name groups who <<< "$s"
      echo "shard $name (${groups//,/, }; ${who//,/, }):"
      echo "  down -v, up -d --wait"
      echo "  scripts/demo-stack-test --only \"\" http://127.0.0.1:<port>"
      echo "  scripts/demo-screenshots --groups $groups --check http://127.0.0.1 $OUT/$name"
    done
  fi
  for line in "${mods[@]}"; do
    read -r m groups <<< "$line"
    if [ "$groups" = - ]; then echo "ok   $m: no views"; else echo "$m: ${groups//,/, }"; fi
  done
  exit 0
fi
[ ${#shards[@]} = 0 ] && { report; exit 0; }

command -v docker >/dev/null || { echo "error: docker not found" >&2; exit 2; }
rm -rf "$OUT" && mkdir -p "$OUT" || exit 2
# Beside another stack of this host: the shared one holds port 80 and the fixed IPv6 subnet, and
# deploy-status's fixed name would make `down -v` remove the host's own volume. The platform
# smoke reaches Caddy on the loopback; the shots run in Caddy's network namespace.
cat > "$OUT/compose.local.yml" <<EOF
services:
  caddy:
    ports: !override
      - { target: 80, host_ip: 127.0.0.1, protocol: tcp }
networks:
  default:
    enable_ipv6: false
    ipam:
      config: !reset []
volumes:
  deploy-status:
    name: ${PROJECT}_deploy-status
EOF
read -ra C <<< "$COMPOSE"
export CANCCU_DEMO_COMPOSE="$COMPOSE"
# Fresh secrets, as in CI (.github/actions/demo-stack-up): never a fixed key.
CANCCU_SECRETS_KEY="1:$(openssl rand -base64 32)" || exit 2
export CANCCU_SECRETS_KEY
env_lines=$(scripts/stack-smoke env) || exit 2
while IFS= read -r line; do [ -n "$line" ] && export "${line?}"; done <<< "$env_lines"
trap '"${C[@]}" down -v --remove-orphans >/dev/null 2>&1' EXIT

if ! "${C[@]}" build > "$OUT/build.log" 2>&1; then
  echo "FAIL the module images did not build: see $OUT/build.log"
  exit 1
fi
for s in "${shards[@]}"; do
  read -r name groups _ <<< "$s"
  dir=$OUT/$name
  log=$dir/log.txt
  mkdir -p "$dir"
  ok=1
  if ! { "${C[@]}" down -v --remove-orphans && "${C[@]}" up -d --wait; } > "$log" 2>&1; then
    echo "FAIL $name: the stack did not start"
    ok=0
  else
    port=$("${C[@]}" port caddy 80 2>> "$log")
    # CI's shard job stops at a failed smoke, before its shots.
    if ! scripts/demo-stack-test --only "" "http://$port" >> "$log" 2>&1; then
      ok=0
    elif ! scripts/demo-screenshots --groups "$groups" --check http://127.0.0.1 "$dir" >> "$log" 2>&1; then
      ok=0
    fi
    grep -E '^(FAIL|error:) ' "$log"
  fi
  [ "$ok" = 1 ] || failed+="$name "
done
report
