# shellcheck shell=bash
# Helpers shared by setup/install and setup/deploy, which source it from the repo root (and
# setup/test.sh, which tests them). Both run as root, so this file is under the same write check as
# they are (install --boot).

# envval FILE KEY: the last KEY=value in FILE, without one pair of surrounding quotes; nothing
# when FILE is not readable
envval() { [ -r "$1" ] || return 0; sed -n "s/^$2=//p" "$1" | tail -n1 | sed -e 's/^"\(.*\)"$/\1/' -e "s/^'\(.*\)'$/\1/"; }

# github_slug URL: the <owner>/<repo> of a GitHub remote (https, ssh or scp-like); fails otherwise
github_slug() {
  local slug
  slug=$(sed -E 's#^(https://|ssh://)?([^@/]+@)?github\.com[:/]##; s#\.git$##; s#/$##' <<<"$1")
  [[ $slug =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] && echo "$slug"
}

# newvapidkey: a fresh P-256 private key, base64url, the form notify's VAPID key takes. The DER
# (SEC1: 30 len 02 01 01 04 20) holds the 32-byte scalar after 7 header bytes. Every command in the
# pipes reads its whole input: under pipefail a `head -c` that stops early kills its writer with
# SIGPIPE, which uutils coreutils (Ubuntu 26.04) hit in about 1 run in 20 under load (#428).
newvapidkey() {
  local der hex esc='' i
  der=$(openssl ecparam -name prime256v1 -genkey -noout -outform DER | od -An -v -tx1 | tr -d ' \n') || return 1
  [[ $der =~ ^30[0-9a-f]{2}0201010420([0-9a-f]{64}) ]] || return 1
  hex=${BASH_REMATCH[1]}
  for ((i = 0; i < 64; i += 2)); do esc+="\\x${hex:i:2}"; done
  printf '%b' "$esc" | base64 | tr '+/' '-_' | tr -d '=\n'
}
