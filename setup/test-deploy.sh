# shellcheck shell=bash
# The setup/deploy section of setup/test.sh, which sources it: it uses that file's helpers
# (exits, has, logged, envfile, ...) and adds to its $fail. Not meant to run on its own.
# shellcheck disable=SC2154  # $unreachable, $scratch and $out are set by setup/test.sh

echo "# deploy (auto-deploy of main; docker, git, curl and the firewall are stubs)"
exits "deploy rejects an unknown option" 2 setup/deploy --bogus
has "deploy prints its usage" "usage: deploy"
exits "deploy --dry-run fails against an unreachable daemon" 2 env DOCKER_HOST="$unreachable" PATH=/usr/bin:/bin setup/deploy --dry-run
# stubs: one directory of fake tools whose state lives in files under $st (see the case blocks)
stubs=$scratch/stubs; mkdir -p "$stubs/bin"
cat > "$stubs/bin/docker" <<'STUB'
#!/bin/sh
S=$STUB; echo "docker $*" >> "$S/log"
mod() { m=${1##*/}; m=${m%:*}; m=${m#canccuplatform-}; echo "$m"; }
case "$1" in
  info) exit 0 ;;
  pull) [ ! -e "$S/pull_fail" ] || { cat "$S/pull_fail" >&2; exit 1; }
        [ ! -e "$S/pull_fail_$(mod "$3")" ] || { cat "$S/pull_fail_$(mod "$3")" >&2; exit 1; } ;;
  volume) [ -e "$S/no_volume" ] && exit 1; echo "$S/vol" ;;
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
    case "$*" in *" exec -T caddy cat "*) if [ -e "$S/caddy_stale" ]; then echo stale; else cat deploy/Caddyfile; fi ;;
      *" logs "*) cat "$S/logs_$last" 2>/dev/null ;; *" up "*) if [ -e "$S/up_kill" ]; then rm "$S/up_kill"; kill -TERM "$PPID"; fi; exit "$(cat "$S/up_rc")" ;; *" ps "*) echo "c_$last" ;; esac ;;
  inspect) case "$3" in
      *NetworkMode*) if [ -e "$S/sockonly_${4#c_}" ]; then echo none; else echo canccuplatform_default; fi ;;
      *Health*) cat "$S/health_${4#c_}" 2>/dev/null || echo healthy ;;
      *) cat "$S/live_${4#c_}" ;;
    esac ;;
esac
STUB
cat > "$stubs/bin/git" <<'STUB'
#!/bin/sh
S=$STUB; echo "git $*" >> "$S/log"
case "$1 $2" in
  "remote get-url") cat "$S/origin" 2>/dev/null || echo "https://github.com/Example-Org/Example-Repo.git" ;;
  "symbolic-ref --short") cat "$S/branch" ;;
  "status --porcelain") cat "$S/dirty" 2>/dev/null ;;
  "fetch -q") [ ! -e "$S/fetch_fail" ] ;;
  "rev-parse --verify") case "$4" in FETCH_HEAD*) cat "$S/target" ;; *) cat "$S/head" ;; esac ;;
  "diff --quiet") [ ! -e "$S/caddy_changed" ] ;;
  "merge-base --is-ancestor") [ ! -e "$S/diverged" ] ;;
  "ls-tree --name-only") printf 'modules/admin\nmodules/hello\nmodules/nodocker\n'; [ ! -e "$S/extra" ] || echo modules/extra; [ ! -e "$S/sock" ] || echo modules/sock ;;
  "cat-file -e") case "$3" in *nodocker*) exit 1 ;; HEAD:*extra*) [ "$(cat "$S/head")" = "$(cat "$S/target")" ] ;; esac ;;
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
  *) [ ! -e "$S/bad_$(cat "$S/live_hello")" ] || exit 22
     for a; do case "$a" in */api/*/health) m=${a%/health}; m=${m##*/}; [ ! -e "$S/down_$m" ] || exit 22 ;; esac; done
     echo '{"status":"ok"}' ;;
esac
STUB
# shellcheck disable=SC2016  # $* and $STUB belong to the stub script
printf '#!/bin/sh\necho "firewall $*" >> "$STUB/log"; exit "$(cat "$STUB/fw_rc")"\n' > "$stubs/firewall"
chmod +x "$stubs/bin/"* "$stubs/firewall"
old=1111111111111111111111111111111111111111; new=2222222222222222222222222222222222222222
# fresh [ENV]: reset the stub state: the checkout is at $old, the registry has images built from $new
fresh() {
  st=$(mktemp -d "$scratch/st.XXXXXX"); mkdir "$st/state" "$st/vol"
  echo main > "$st/branch"; echo "$old" > "$st/head"; echo "$new" > "$st/target"; echo "$new" > "$st/rev"
  echo 0 > "$st/up_rc"; echo 0 > "$st/fw_rc"; : > "$st/log"
  for m in hello admin; do echo "sha256:old$m" > "$st/live_$m"; echo "sha256:new$m" > "$st/remote_$m"; done
  # shellcheck disable=SC2034  # read by logged and notlogged in setup/test.sh
  stub=$st; denv=$(envfile "CANCCU_VERSION=dev\nCANCCU_DEPLOY_GITHUB_TOKEN=test-token\n${1:-}")
}
dep() { exits "$1" "$2" env STUB="$st" DOCKER_CONFIG="$st/dockercfg" PATH="$stubs/bin:$PATH" CANCCU_ENV_FILE="$denv" CANCCU_DEPLOY_STATE="$st/state" CANCCU_DEPLOY_FIREWALL="$stubs/firewall" CANCCU_DEPLOY_WAIT=1 setup/deploy; }
# status NAME ERE...: the status file in the state directory and the copy in the stack's volume
# both match every ERE
status() {
  local n=$1 f e; shift
  for f in "$st/state/status.json" "$st/vol/status.json"; do
    for e; do grep -Eq -- "$e" "$f" 2>/dev/null || { bad "$n ($f: no match for $e)" "$(cat "$f" 2>/dev/null)"; return; }; done
  done
  pass "$n"
}
issues() { if [ "$( { wc -l < "$st/issues"; } 2>/dev/null || echo 0)" = "$2" ]; then pass "$1"; else bad "$1 (want $2 issues)" "$(cat "$st/issues" 2>/dev/null)"; fi; }

fresh 'CANCCU_VERSION=v0.1.0\n'; echo '{}' > "$st/state/status.json"; echo '{}' > "$st/vol/status.json"
dep "deploy does nothing unless the platform version is dev" 0
if [ ! -e "$st/state/status.json" ] && [ ! -e "$st/vol/status.json" ]; then pass "deploy removes the status file when auto-deploy is off"; else bad "deploy removes the status file when auto-deploy is off"; fi
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
status "a deploy writes its result to the status file the stack reads" '"result":"ok"' "\"commit\":\"$new\"" '"time":"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9:]{8}Z"' '"failures":0'
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
has "deploy says how to clear the hold" "sudo rm .*/failed"
notlogged "deploy does not retry the failed images" "compose .* up "
issues "deploy opens no second issue" 1
if [ ! -e "$st/state/pending" ]; then pass "a rolled-back deploy leaves no pending deploy"; else bad "a rolled-back deploy leaves no pending deploy"; fi
echo sha256:newhello2 > "$st/remote_hello"; : > "$st/log"; dep "deploy retries once the images change" 0
logged "deploy retries once the images change (stack restarted)" "compose .* up "

fresh; touch "$st/caddy_changed"; dep "deploy of a Caddyfile change" 0
logged "deploy recreates caddy when the Caddyfile changed (a bind mount is not reloaded)" "up -d --wait --no-build --force-recreate caddy"
fresh; touch "$st/caddy_stale"; dep "deploy while caddy runs an older Caddyfile than the checkout" 0
logged "deploy recreates caddy whenever its running Caddyfile differs" "force-recreate caddy"
if [ "$(grep -n 'force-recreate caddy' "$st/log" | head -1 | cut -d: -f1)" -lt "$(grep -n 'curl .*/health' "$st/log" | head -1 | cut -d: -f1)" ]
then pass "caddy is recreated before the health checks"; else bad "caddy is recreated before the health checks" "$(cat "$st/log")"; fi
fresh; touch "$st/bad_sha256:newhello" "$st/bad_sha256:oldhello"; echo "FATAL: password authentication failed for user canccu_app" > "$st/logs_admin"
dep "a failed deploy whose previous version cannot start on the database" 1
has "the rollback says the previous version cannot start on the current database" "ROLLBACK FAILED.*admin cannot start on the current database"
if grep -q 'cannot start on the current database' "$st/issues"; then pass "the issue names the database as the rollback's problem"; else bad "the issue names the database as the rollback's problem" "$(cat "$st/issues")"; fi
fresh; touch "$st/caddy_changed" "$st/bad_sha256:newhello"; dep "a failed deploy of a Caddyfile change" 1
if [ "$(grep -c 'force-recreate caddy' "$st/log")" = 2 ]; then pass "the rollback recreates caddy with the previous Caddyfile"; else bad "the rollback recreates caddy with the previous Caddyfile" "$(cat "$st/log")"; fi
logged "the rollback removes services the failed commit added" "up -d --wait --no-build --remove-orphans"

# module sock has no network and no route (like screen-render): its Compose health counts, never curl
fresh; touch "$st/sock" "$st/sockonly_sock" "$st/down_sock"; echo sha256:newsock > "$st/remote_sock"; dep "deploy with a module that has no route" 0
notlogged "a module without a route is never checked through Caddy" "curl .*/api/sock/health"
logged "a module without a route is checked by its Compose health" "docker inspect .*Health.* c_sock"
fresh; touch "$st/sock" "$st/sockonly_sock"; echo unhealthy > "$st/health_sock"; echo sha256:newsock > "$st/remote_sock"; dep "deploy with an unhealthy module that has no route" 1
has "the unhealthy module without a route is named" "health check failed: sock"

# the failed commit adds module extra, whose route never answers; the previous commit has no extra
fresh; touch "$st/extra" "$st/down_extra"; echo sha256:newextra > "$st/remote_extra"; dep "a failed deploy of a commit that adds a module" 1
logged "the new module's health is checked on deploy" "curl .*/api/extra/health"
has "the rollback is healthy without the module only the failed commit had" "rolled back to 1111111, health ok"
if grep -q 'ROLLBACK FAILED' "$st/issues"; then bad "the issue reports a healthy rollback" "$(cat "$st/issues")"; else pass "the issue reports a healthy rollback"; fi

fresh; touch "$st/tag_fail_admin"; dep "deploy whose image tag fails" 1
if [ "$(cat "$st/head")" = "$old" ] && [ "$(cat "$st/live_hello")" = sha256:oldhello ]; then pass "a failed tag rolls back"; else bad "a failed tag rolls back" "$(cat "$st/log")"; fi
issues "a failed tag opens an issue" 1

fresh; touch "$st/up_kill" "$st/bad_sha256:newhello"; dep "a deploy killed during compose up" 143
if [ -s "$st/state/pending" ]; then pass "an interrupted deploy leaves a pending deploy"; else bad "an interrupted deploy leaves a pending deploy"; fi
status "a run killed by a signal is a failure, not ok" '"result":"failed"' '"failures":1' '"error":"the run stopped \(exit 143\)"'
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
fresh; echo "Error response from daemon: Get \"https://ghcr.io/v2/\": dial tcp: lookup ghcr.io: no such host" > "$st/pull_fail"
dep "deploy fails clearly when the registry is unreachable" 2
has "deploy says the registry cannot be reached and what to check" "cannot reach the registry ghcr.io.*network"
notlogged "deploy changes nothing when a pull fails" "merge -q|docker tag|compose .* up "
status "a failed pull is written to the status file" '"result":"failed"' '"failures":1' '"error":"[^"]*cannot reach the registry ghcr.io' "\"commit\":\"$old\""
since=$(sed -n 's/.*"failing_since":"\([^"]*\)".*/\1/p' "$st/state/status.json")
if [ -n "$since" ]; then pass "the status file says since when the deploy fails"; else bad "the status file says since when the deploy fails" "$(cat "$st/state/status.json")"; fi
dep "deploy whose pull fails again" 2
status "a second failure in a row counts two and keeps the start of the streak" '"failures":2' "\"failing_since\":\"$since\""
rm "$st/pull_fail"; dep "deploy after the registry is back" 0
status "a good run ends the streak and names the deployed commit" '"result":"ok"' '"failures":0' '"failing_since":""' "\"commit\":\"$new\""
fresh; echo "Error response from daemon: Head \"https://ghcr.io/v2/example-org/example-repo/hello/manifests/dev\": denied" > "$st/pull_fail"
dep "deploy whose pull is refused (a private package without a login)" 2
has "deploy says the package needs a registry login and how to add one" "private.*sudo docker login ghcr.io"
hasnt "deploy never advises making the private images public" "public"
status "the refused pull is written to the status file" '"error":"[^"]*sudo docker login ghcr.io'
fresh; mkdir "$st/dockercfg"; echo '{"auths":{"ghcr.io":{}}}' > "$st/dockercfg/config.json"
echo "Error response from daemon: Head \"https://ghcr.io/v2/x/manifests/dev\": unauthorized" > "$st/pull_fail"
dep "deploy whose registry login no longer works" 2
has "deploy says the login expired or was revoked and how to renew it" "expired or was revoked.*renew.*sudo docker login ghcr.io"
fresh; echo $'Error response from daemon: weird\tthing at 10.0.0.1' > "$st/pull_fail"; dep "deploy whose pull fails with an unknown answer" 2
if grep -q '10.0.0.1' "$st/vol/status.json"; then bad "the registry's raw answer stays out of the status" "$(cat "$st/vol/status.json")"; else pass "the registry's raw answer stays out of the status"; fi
fresh; touch "$st/extra"; echo "Error response from daemon: manifest unknown" > "$st/pull_fail_extra"; dep "deploy of a merge whose new module has no image yet" 0
has "deploy waits for the image of a new module" "waiting for the image of the new module extra"
if [ ! -e "$st/state/status.json" ]; then pass "waiting for a new module is not a failure"; else bad "waiting for a new module is not a failure" "$(cat "$st/state/status.json")"; fi
fresh; echo "Error response from daemon: manifest unknown" > "$st/pull_fail"; dep "pull fails" 2; dep "pull fails again" 2
rm "$st/pull_fail"; echo 3333333333333333333333333333333333333333 > "$st/rev"; dep "deploy waits for images after failures" 0
status "waiting keeps the failure streak" '"failures":2' '"result":"failed"'
fresh; echo $'https://git.example.org/a\tb\r.git' > "$st/origin"; dep "deploy with control characters in its error" 2
if jq -e . "$st/vol/status.json" >/dev/null 2>&1; then pass "control characters never break the status file"; else bad "control characters never break the status file" "$(cat -A "$st/vol/status.json")"; fi
fresh; echo "Error response from daemon: manifest unknown" > "$st/pull_fail"
dep "deploy whose image is not in the registry" 2
has "deploy says the image was not pushed yet" "not in the registry.*Images workflow"
fresh; echo "Error response from daemon: something else" > "$st/pull_fail"; dep "deploy whose pull fails otherwise" 2
has "deploy logs docker's reason when it does not know it" "docker pull .*:dev: Error response from daemon: something else"
fresh; echo "https://git.example.org/a/b.git" > "$st/origin"; dep "deploy refuses an origin not on GitHub" 2
has "deploy names the origin that is not on GitHub" "git.example.org/a/b.git.* is not a GitHub repository"
status "a refused run is a failure in the status file" '"result":"failed"' '"error":"[^"]*is not a GitHub repository'
fresh; echo "https://someone:s3cret@git.example.org/a/b.git" > "$st/origin"; dep "deploy refuses an origin with credentials" 2
if grep -q s3cret "$st/state/status.json" "$st/vol/status.json"; then bad "the status file never holds credentials from a URL" "$(cat "$st/vol/status.json")"; else pass "the status file never holds credentials from a URL"; fi
fresh; touch "$st/bad_sha256:newhello"; dep "a failed deploy that rolls back" 1
status "a rolled-back deploy is a failure and names the commit the host still runs" '"result":"failed"' "\"commit\":\"$old\"" '"error":"[^"]*rolled back'
dep "the held deploy on the next run" 1
status "holding a failed deploy keeps counting failures" '"failures":2' '"error":"[^"]*holding'
fresh; touch "$st/no_volume"; dep "deploy without the stack's status volume" 0
has "deploy says it could not hand the status to the stack" "warning: .*canccuplatform_deploy-status"
if [ -s "$st/state/status.json" ]; then pass "deploy still writes the status file in its state directory"; else bad "deploy still writes the status file in its state directory"; fi
fresh "CANCCU_DEPLOY_IMAGES='registry.example.org/canccu'\n"; dep "deploy with a quoted CANCCU_DEPLOY_IMAGES" 0
logged "deploy reads quoted values from deploy/.env" "docker pull -q registry.example.org/canccu/hello:dev"
if docker compose -f deploy/compose.yml config 2>/dev/null | grep -q 'name: canccuplatform_deploy-status' \
  && docker compose -f deploy/compose.yml config --format json 2>/dev/null | jq -e '.services.hello.volumes[] | select(.source == "deploy-status" and .target == "/run/canccu-deploy" and .read_only)' >/dev/null && grep -q 'CANCCU_DEPLOY_STATUS_FILE: /run/canccu-deploy/status.json' deploy/compose.yml
then pass "the stack mounts the volume deploy writes the status to into hello, read-only"
else bad "the stack mounts the volume deploy writes the status to into hello, read-only"; fi
