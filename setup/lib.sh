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

# A fresh P-256 key from openssl; its DER form holds the 32-byte private scalar after 7 header bytes.
newvapidkey() {
  openssl ecparam -name prime256v1 -genkey -noout -outform DER | tail -c +8 | head -c 32 \
    | base64 | tr '+/' '-_' | tr -d '=\n'
}
