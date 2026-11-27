#!/usr/bin/env bash
# The screenshot checks of CI's demo-stack run (docs/ci.md#tiers), on this machine before a push
# (#817): a PR's red shots otherwise show only after a 20–40 minute CI run.
# Usage: shots-local.sh [--dry-run] [MODULE...]
#        shots-local.sh [--dry-run] [--keep] --shots NAME|GLOB...
#        shots-local.sh [--dry-run] [--keep] --changed
#        shots-local.sh --down
# The full run, for the named modules or without names those changed against CANCCU_SHOTS_BASE
# (default origin/main; committed, staged, unstaged and untracked): each of CI's shards that holds
# the modules' groups (scripts/shots-local.mjs) gets a fresh demo stack, as in CI, since one
# shard's shots change what another's show. On it run the platform smoke, which imports the demo
# event the shots show, and scripts/demo-screenshots in the merge queue's check mode: every check
# of modules/screen/test/stack, the screens at 1920×1080 and 1080×1920 only. Prints the failing
# checks, then one line per module; exits 1 when a check failed. The PNGs and each shard's whole
# log are in shots-local/<shard>/.
# The per-shot run (#825) fits a worker's 10-minute command: only the shots named (CI's names,
# globs with * and ?; scripts/shots-local-pick.mjs), or with --changed those the branch's changed
# files are named for, on one stack. The screens take only those shots; another group's shot runs
# its whole group. --keep leaves the stack up for the next call, which reuses it (images rebuilt
# from Docker's cache, changed parts restarted); a call without --keep, or --down, takes it down.
# Prints CI's FAIL lines and how long the run took; exits 1 when a named shot failed or was never
# taken. The log and PNGs are in shots-local/shots/.
# The stack is a Compose project of its own (CANCCU_SHOTS_PROJECT, default canccu-shots-<user>-<worktree hash>;
# never COMPOSE_PROJECT_NAME, which names the host's own stack) beside any other, and the script
# refuses a project that has containers it did not keep (shots-local/kept), so its `down -v`
# removes only what it started: Caddy on a free loopback port, no fixed IPv6 subnet, a
# deploy-status volume of its own.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 2

usage() {
  echo "usage: shots-local.sh [--dry-run] [MODULE...] | [--dry-run] [--keep] --shots NAME|GLOB... | [--dry-run] [--keep] --changed | --down" >&2
  exit 2
}
dry=0 keep=0 mode=modules
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1 ;;
    --keep) keep=1 ;;
    --shots) mode=shots; shift; break ;;
    --changed) mode=changed ;;
    --down) mode=down ;;
    -*) usage ;;
    *) break ;;
  esac
  shift
done
for a in "$@"; do case "$a" in -*) usage ;; esac; done
case "$mode" in
  modules) [ "$keep" = 0 ] || usage ;;
  shots) [ $# -gt 0 ] || usage ;;
  changed) [ $# = 0 ] || usage ;;
  down) if [ $# != 0 ] || [ "$dry$keep" != 00 ]; then usage; fi ;;
esac
command -v node >/dev/null || { echo "error: node not found" >&2; exit 2; }

OUT=shots-local
# Per worktree: workers share one user in sibling worktrees, and two runs on one project would
# re-tag each other's images and `down -v` each other's stack.
here=$(pwd -P | sha1sum | cut -c1-8)
PROJECT=${CANCCU_SHOTS_PROJECT:-canccu-shots-$(id -un | tr -c 'a-z0-9\n' - | tr 'A-Z' 'a-z')-$here}
case "$PROJECT" in
  canccuplatform | "${COMPOSE_PROJECT_NAME:-}")
    echo "error: $PROJECT is the host's own stack; set CANCCU_SHOTS_PROJECT to another name" >&2; exit 2 ;;
  *[!a-z0-9_-]* | [!a-z0-9]*) echo "error: bad project name $PROJECT" >&2; exit 2 ;;
esac
# No deploy/.env: CI has none, and the host's secrets and ports must not reach this stack.
COMPOSE="docker compose --env-file /dev/null -p $PROJECT -f deploy/compose.yml -f deploy/compose.ci.yml -f $OUT/compose.local.yml"
read -ra C <<< "$COMPOSE"
KEPT=$OUT/kept

containers() { docker ps -aq --filter "label=com.docker.compose.project=$PROJECT"; }
kept() { [ -f "$KEPT" ] && [ "$(cat "$KEPT")" = "$PROJECT" ]; }
# Held for the whole run (fd 9 closes at exit): the container check cannot see a run that is
# still building its images.
lock() {
  command -v docker >/dev/null || { echo "error: docker not found" >&2; exit 2; }
  command -v flock >/dev/null || { echo "error: flock not found" >&2; exit 2; }
  exec 9> "${TMPDIR:-/tmp}/$PROJECT.lock"
  flock -n 9 || { echo "error: $PROJECT is in use by another run" >&2; exit 2; }
}
# Beside another stack of this host: the shared one holds port 80 and the fixed IPv6 subnet, and
# deploy-status's fixed name would make `down -v` remove the host's own volume. The platform
# smoke reaches Caddy on the loopback; the shots run in Caddy's network namespace.
write_compose() {
  cat > "$OUT/compose.local.yml" <<EOC
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
EOC
}
# Fresh secrets, as in CI (.github/actions/demo-stack-up): never a fixed key. Kept in the stack's
# own file, so a call that reuses the stack starts its parts with the key its data was made with.
fresh_env() {
  local key
  key=$(openssl rand -base64 32) || return 1
  echo "CANCCU_SECRETS_KEY=1:$key"
  scripts/stack-smoke env
}
load_env() {
  local line
  while IFS= read -r line; do [ -n "$line" ] && export "${line?}"; done < "$OUT/stack.env"
  export CANCCU_DEMO_COMPOSE="$COMPOSE"
}

if [ "$mode" = down ]; then
  lock
  if kept; then
    [ -f "$OUT/compose.local.yml" ] || write_compose
    [ -f "$OUT/stack.env" ] && load_env
    "${C[@]}" down -v --remove-orphans || exit 1
    rm -f "$KEPT" "$OUT/stack.env"
    echo "shots-local: took down $PROJECT"
  elif [ -n "$(containers)" ]; then
    echo "error: $PROJECT has containers shots-local did not keep; it leaves them alone" >&2; exit 2
  else
    echo "shots-local: no stack kept for $PROJECT"
  fi
  exit 0
fi

if [ "$mode" != modules ]; then
  if [ "$mode" = shots ]; then planned=$(node scripts/shots-local-pick.mjs shots "$@") || exit 2
  else planned=$(node scripts/shots-local-pick.mjs changed) || exit 2; fi
  names=() groups=() notes=()
  while read -r kind rest; do
    case "$kind" in
      shot) names+=("${rest% *}"); [[ " ${groups[*]} " == *" ${rest##* } "* ]] || groups+=("${rest##* }") ;;
      note) notes+=("$rest") ;;
    esac
  done <<< "$planned"
  noted() {
    [ ${#notes[@]} = 0 ] && return
    for n in "${notes[@]}"; do echo "not picked: $n"; done
    echo "CI's run checks these; scripts/shots-local.sh MODULE runs their shards here"
  }
  if [ ${#names[@]} = 0 ]; then
    noted
    if [ ${#notes[@]} = 0 ]; then echo "shots-local: no changed file has views"; exit 0; fi
    echo "shots-local: --changed found no screen shot to run" >&2; exit 2
  fi
  list=$(IFS=,; echo "${names[*]}")
  glist=$(IFS=,; echo "${groups[*]}" | tr , '\n' | sort | paste -sd,)
  shoot=(scripts/demo-screenshots --groups "$glist" --shots "$list" --check http://127.0.0.1 "$OUT/shots")
  if command -v docker >/dev/null && [ -n "$(containers)" ]; then
    kept || { echo "error: $PROJECT already has containers shots-local did not keep; stop them or set CANCCU_SHOTS_PROJECT" >&2; exit 2; }
    warm=1
  else
    warm=0
  fi
  if [ "$dry" = 1 ]; then
    if [ "$warm" = 1 ]; then echo "the stack: $PROJECT, kept by an earlier --keep: reused (build from cache, up -d --wait)"
    else echo "the stack: $PROJECT, fresh: built, started, the platform smoke"; fi
    echo "${shoot[*]}"
    for line in "${names[@]}"; do
      g=$(grep -m1 "^shot $line " <<< "$planned"); g=${g##* }
      if [ "$g" = screens ]; then echo "  $line"; else echo "  $line ($g: its whole group runs)"; fi
    done
    [ "$keep" = 1 ] && echo "then left up (--keep); scripts/shots-local.sh --down removes it"
    noted
    exit 0
  fi
  lock
  start=$SECONDS
  if [ "$warm" = 0 ]; then
    rm -rf "$OUT" && mkdir -p "$OUT" || exit 2
    write_compose
    (umask 077 && fresh_env > "$OUT/stack.env") || exit 2
  fi
  rm -rf "$OUT/shots" && mkdir -p "$OUT/shots" || exit 2
  log=$OUT/shots/log.txt
  load_env
  # Down at the end unless this call keeps it; a kept stack stays up whatever this call does.
  if [ "$keep" = 0 ] || [ "$warm" = 0 ]; then
    trap '"${C[@]}" down -v --remove-orphans >/dev/null 2>&1; rm -f "$KEPT" "$OUT/stack.env"' EXIT
  fi
  if ! "${C[@]}" build > "$OUT/shots/build.log" 2>&1; then
    echo "FAIL the module images did not build: see $OUT/shots/build.log"; exit 1
  fi
  if [ "$warm" = 1 ]; then
    "${C[@]}" up -d --wait > "$log" 2>&1 || { echo "FAIL the kept stack did not start: see $log"; exit 1; }
  else
    if ! { "${C[@]}" down -v --remove-orphans && "${C[@]}" up -d --wait; } > "$log" 2>&1; then
      echo "FAIL the stack did not start: see $log"; exit 1
    fi
    port=$("${C[@]}" port caddy 80 2>> "$log")
    if ! scripts/demo-stack-test --only "" "http://$port" >> "$log" 2>&1; then
      grep -E '^(FAIL|error:) ' "$log"; echo "FAIL the platform smoke: see $log"; exit 1
    fi
  fi
  if [ "$keep" = 1 ]; then echo "$PROJECT" > "$KEPT"; trap - EXIT; fi
  status=0
  "${shoot[@]}" >> "$log" 2>&1 || status=1
  grep -E '^(FAIL|error:) ' "$log"
  missed=$(node scripts/shots-local-pick.mjs unreached "${names[@]}" < "$log")
  for n in $missed; do echo "FAIL $n: not taken (the run never reached it; see $log)"; status=1; done
  took=$((SECONDS - start))
  echo "shots-local: ${#names[@]} shots, $([ "$warm" = 1 ] && echo "the kept stack" || echo "a cold stack: built, started, smoke") in $((took / 60))m $((took % 60))s: $([ "$status" = 0 ] && echo ok || echo FAIL)"
  [ "$keep" = 1 ] && echo "the stack $PROJECT stays up (--keep); scripts/shots-local.sh --down removes it"
  noted
  exit "$status"
fi

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

lock
if [ -n "$(containers)" ]; then
  echo "error: project $PROJECT already has containers; stop them or set CANCCU_SHOTS_PROJECT" >&2
  kept && echo "  (a stack --keep left: scripts/shots-local.sh --down removes it)" >&2
  exit 2
fi
rm -rf "$OUT" && mkdir -p "$OUT" || exit 2
write_compose
(umask 077 && fresh_env > "$OUT/stack.env") || exit 2
load_env
trap '"${C[@]}" down -v --remove-orphans >/dev/null 2>&1; rm -f "$OUT/stack.env"' EXIT

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
