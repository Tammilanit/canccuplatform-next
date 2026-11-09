# shellcheck shell=bash
# The setup/install section of setup/test.sh, which sources it: it uses that file's helpers
# (exits, has, logged, envfile, ...) and adds to its $fail. Not meant to run on its own.
# shellcheck disable=SC2154  # $unreachable, $scratch, $out, $docker_ok are set by setup/test.sh

echo "# install"
exits "install rejects an unknown option" 2 setup/install --bogus
has "install prints its usage" "usage: install"
exits "install fails against an unreachable daemon" 2 env DOCKER_HOST="$unreachable" setup/install
has "install names the unreachable daemon" "cannot reach the Docker daemon"
exits "install --dry-run fails against an unreachable daemon" 2 env DOCKER_HOST="$unreachable" setup/install --dry-run
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

echo "# install: module images match the checkout (docker, git and curl are stubs)"
# Stub state in $ist: local_<m> is the "revision|local-changes" labels of canccuplatform-<m>:latest
# (no file = no image), remote_rev the revision of every registry image, head the checkout's HEAD,
# dirty its local changes, origin the origin remote (default a GitHub URL); pull_fail and
# build_fail make those fail.
istubs=$scratch/istubs; mkdir -p "$istubs/bin"
cat > "$istubs/bin/docker" <<'STUB'
#!/bin/sh
S=$STUB; echo "docker $*" >> "$S/log"
mod() { m=${1#canccuplatform-}; echo "${m%:latest}"; }
case "$1" in
  info|compose) exit 0 ;;
  volume) exit 1 ;;
  image) case "$5" in
      canccuplatform-*) [ -e "$S/local_$(mod "$5")" ] || exit 1; cat "$S/local_$(mod "$5")" ;;
      *) echo "$(cat "$S/remote_rev")|" ;;
    esac ;;
  pull) [ ! -e "$S/pull_fail" ] ;;
  tag) echo "$(cat "$S/remote_rev")|" > "$S/local_$(mod "$3")" ;;
  build) [ ! -e "$S/build_fail" ] || exit 1
    t=; rev=; lc=; prev=
    for a; do case "$prev" in
      -t) t=$a ;;
      --label) case "$a" in org.opencontainers.image.revision=*) rev=${a#*=} ;; canccu.local-changes=*) lc=${a#*=} ;; esac ;;
    esac; prev=$a; done
    echo "$rev|$lc" > "$S/local_$(mod "$t")" ;;
esac
STUB
cat > "$istubs/bin/git" <<'STUB'
#!/bin/sh
S=$STUB; echo "git $*" >> "$S/log"
while [ $# -gt 0 ]; do case "$1" in -c) shift 2 ;; --no-optional-locks) shift ;; *) break ;; esac; done
case "$1" in
  rev-parse) [ -s "$S/head" ] && cat "$S/head" ;;
  status) cat "$S/dirty" 2>/dev/null || true ;;
  remote) cat "$S/origin" 2>/dev/null || echo "https://github.com/Example-Org/Example-Repo.git" ;;
  *) echo "git stub: unexpected: $*" >&2; exit 9 ;;
esac
STUB
# shellcheck disable=SC2016  # $* and $STUB belong to the stub script
printf '#!/bin/sh\necho "curl $*" >> "$STUB/log"; echo ok\n' > "$istubs/bin/curl"
chmod +x "$istubs/bin/"*
ihead=3333333333333333333333333333333333333333; istale=4444444444444444444444444444444444444444
# Every module with a Dockerfile, as setup/install walks them; a list here would miss new modules.
imods=$(for f in modules/*/Dockerfile; do m=${f#modules/}; echo "${m%/Dockerfile}"; done)
# ifresh [ENV]: the checkout is at $ihead; both local images and the registry's are stale
ifresh() {
  ist=$(mktemp -d "$scratch/ist.XXXXXX"); : > "$ist/log"; echo "$ihead" > "$ist/head"; echo "$istale" > "$ist/remote_rev"
  for m in $imods; do echo "$istale|" > "$ist/local_$m"; done
  # shellcheck disable=SC2034  # read by logged and notlogged in setup/test.sh
  stub=$ist; ienv=$(envfile "POSTGRES_PASSWORD=x\n${1:-CANCCU_VERSION=dev\n}")
}
inst() { local n=$1 want=$2; shift 2; exits "$n" "$want" env STUB="$ist" PATH="$istubs/bin:$PATH" CANCCU_ENV_FILE="$ienv" setup/install "$@"; }
ilocal() { if [ "$(cat "$ist/local_$2" 2>/dev/null)" = "$3" ]; then pass "$1"; else bad "$1 (canccuplatform-$2:latest is '$(cat "$ist/local_$2" 2>/dev/null)', want '$3')" "$(cat "$ist/log")"; fi; }

ifresh; for m in $imods; do echo "$ihead|" > "$ist/local_$m"; done; inst "install with images that match the checkout" 0
notlogged "install reuses images built from HEAD (no pull, no build)" "docker (pull|build|tag) "
logged "install starts the stack without building" "compose -f deploy/compose.yml up -d --wait --no-build"

ifresh; echo "$ihead" > "$ist/remote_rev"; rm "$ist/local_admin"; inst "install with stale or missing images, registry at HEAD" 0
logged "install pulls the dev image from the repo's registry" "docker pull -q ghcr.io/example-org/example-repo/hello:dev"
logged "install pulls a missing image too" "docker pull -q ghcr.io/example-org/example-repo/admin:dev"
logged "install tags the pulled image the way compose expects" "docker tag ghcr.io/example-org/example-repo/hello:dev canccuplatform-hello:latest"
notlogged "install builds nothing when the pull matches HEAD" "docker build "
ilocal "the stale hello image is replaced by HEAD's" hello "$ihead|"

ifresh 'CANCCU_VERSION=dev\nCANCCU_DEPLOY_IMAGES=registry.example.org/canccu\n'; echo "$ihead" > "$ist/remote_rev"; inst "install with CANCCU_DEPLOY_IMAGES" 0
logged "install pulls from CANCCU_DEPLOY_IMAGES" "docker pull -q registry.example.org/canccu/hello:dev"
ifresh "CANCCU_VERSION=\"dev\"\nCANCCU_DEPLOY_IMAGES='registry.example.org/canccu'\n"; echo "$ihead" > "$ist/remote_rev"; inst "install with quoted values in deploy/.env" 0
logged "install reads quoted values from deploy/.env" "docker pull -q registry.example.org/canccu/hello:dev"
ifresh; echo "git@github.com:Example-Org/Example-Repo.git" > "$ist/origin"; echo "$ihead" > "$ist/remote_rev"; inst "install with an ssh origin on GitHub" 0
logged "install derives the registry from an ssh origin" "docker pull -q ghcr.io/example-org/example-repo/hello:dev"
ifresh; echo "https://git.example.org/a/b.git" > "$ist/origin"; inst "install with an origin not on GitHub" 0
has "install says it has no registry" "no registry"
notlogged "install pulls nothing without a registry" "docker pull "

ifresh; inst "install with stale images, registry stale too" 0
has "install says why it builds" "hello: .*built from 4444444.*building"
logged "install builds the stale image from the checkout" "docker build .*-f modules/hello/Dockerfile"
logged "a local build gets the revision label" "docker build .*--label org.opencontainers.image.revision=$ihead"
ilocal "the rebuilt image is labelled with HEAD" hello "$ihead|"
notlogged "install never tags a stale pulled image" "docker tag "

ifresh; touch "$ist/pull_fail"; inst "install when the registry is unreachable" 0
has "install says private images need a registry login" "sudo docker login"
ilocal "install builds when the pull fails" admin "$ihead|"

ifresh; echo " M modules/hello/src/main.ts" > "$ist/dirty"; for m in $imods; do echo "$ihead|" > "$ist/local_$m"; done; echo "$ihead" > "$ist/remote_rev"
inst "install with local changes in the checkout" 0
has "install warns about local changes" "local changes"
notlogged "install with local changes does not pull" "docker pull "
logged "install with local changes marks the build" "docker build .*--label canccu.local-changes=true"
ifresh; for m in $imods; do echo "$ihead|true" > "$ist/local_$m"; done; echo "$ihead" > "$ist/remote_rev"; inst "install after a build with local changes, now clean" 0
logged "install does not reuse an image built with local changes" "docker pull -q ghcr.io/example-org/example-repo/hello:dev"
ilocal "the image built with local changes is replaced" hello "$ihead|"

ifresh 'CANCCU_VERSION=v0.1.0\n'; echo "$ihead" > "$ist/remote_rev"; inst "install with a release version" 0
logged "install pulls the images of the release" "docker pull -q ghcr.io/example-org/example-repo/hello:v0.1.0"
notlogged "install with a release pulls no dev image" ":dev"
ilocal "the release image is tagged the way compose expects" hello "$ihead|"

ifresh; touch "$ist/pull_fail" "$ist/build_fail"; inst "install when pull and build both fail" 2
has "install names the module it cannot get" "admin"
has "install says it neither pulled nor built" "cannot pull or build"
notlogged "install starts nothing when an image is missing" "compose .*up"
ifresh 'CANCCU_VERSION=dev\nCANCCU_WEB_ALLOW=192.0.2.1\n'; touch "$ist/pull_fail" "$ist/build_fail"; inst "install --dry-run --boot does not build" 0 --dry-run --boot
notlogged "install --dry-run pulls, builds and tags nothing" "docker (pull|build|tag) "

ifresh; echo "$ihead|" > "$ist/local_admin"; inst "install --dry-run with one stale image" 0 --dry-run
has "install --dry-run says it would reuse a matching image" "would reuse canccuplatform-admin:latest"
has "install --dry-run says it would pull, or else build, a stale one, and why" "would pull ghcr.io/example-org/example-repo/hello:dev .*else build.*built from 4444444"
notlogged "install --dry-run changes no image" "docker (pull|build|tag) "

ifresh; : > "$ist/head"; inst "install outside a git checkout" 2
has "install says it needs the checkout's commit" "commit"
if grep -E '^ExecStart' setup/canccu-stack.service | grep -q 'compose -f deploy/compose.yml up -d --wait' && ! grep -Eq '^ExecStart.*(pull|build)' setup/canccu-stack.service
then pass "canccu-stack at boot neither pulls nor builds"; else bad "canccu-stack at boot neither pulls nor builds"; fi
