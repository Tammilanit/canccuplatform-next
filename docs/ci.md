# CI

`.github/workflows/ci.yml` and `.github/workflows/demo-stack.yml` run on every pull request, merge-queue entry and push to main. `.github/workflows/release.yml` builds the module images (see [Images](#images)). `.github/workflows/review-gate.yml` runs on pull requests, PR comments and merge-queue entries. There is no Claude review in CI (see [Code review](#code-review)).

## Checks (names are stable; branch rules require them)
| Check | What it does |
|---|---|
| `lint-types-test (kit-ts)` | In `packages/kit-ts`: `npm ci`, `npm run lint` (eslint + prettier), `npm run typecheck`, `npm test` (vitest). |
| `lint-types-test (kit-py)` | In `packages/kit-py`: `pip install -e ".[dev]"`, `ruff check .`, `mypy .` (strict), `pytest`. The `dev` extra pins these tools. |
| `lint-types-test (ui)` | In `packages/ui`: `npm ci`, `npm run lint` (eslint + prettier), `npm run typecheck`, `npm test` (vitest). After it first runs on main, a maintainer adds it to the required checks. |
| `integration (kit)` | Starts Valkey and Postgres from the Compose stack (`deploy/compose.yml` + `deploy/compose.test.yml`) and runs the kit-ts and kit-py integration tests against them: the bus and tenant streams on Valkey, and row-level security on Postgres (as a plain app role, because a superuser bypasses RLS). |
| `modules` | Passes when every module job passed. One `module (<name>)` job runs per `modules/<name>` that has checks: lint, types and unit tests, plus its Postgres and Valkey tests against the Compose services, through `scripts/check-module`. A new module needs no `.github/` change. See [modules](#modules). After it first runs on main, a maintainer adds `modules` to the required checks. |
| `compose (deploy)` | Starts the whole stack with `docker compose -f deploy/compose.yml up --build --wait`, and checks that only Caddy publishes a port, that only the four named volumes exist (the three for data, and `deploy-status`, which only the host's auto-deploy writes), that hello and admin health through Caddy are `ok`, that health is `503 down` when Valkey stops, and that hello refuses to start without a kit variable. |
| `demo-stack` | From `.github/workflows/demo-stack.yml`: starts the whole stack with the demo event (`deploy/compose.yml` + `deploy/compose.ci.yml`, `up --build --wait`), runs the API tests (`scripts/demo-stack-test`) and screenshots the admin pages (`scripts/demo-screenshots`), uploaded as the artifact `demo-screenshots`. See [demo-stack](#demo-stack). |
| `no-event-names` | Fails if the lines a PR adds contain a forbidden term. |
| `review-gate` | From `.github/workflows/review-gate.yml`: passes only on an independent review's `Review verdict: pass <head sha>` for the PR's current head (see below). |
| `contracts` | `scripts/check-contracts`: validates every `events/*/profile.yaml` against `contracts/profile.schema.json` and every `events/*/themes/*/theme.yaml` against `contracts/theme.schema.json`, checks the paths they name exist (for themes with `scripts/check-theme-refs`, which also checks ids, grid areas and references, and runs its self-test), and lints `contracts/*.openapi.yaml` with Redocly (`contracts/redocly.yaml`), each one with its parts (`contracts/<module>/*.openapi.yaml`). |
| `setup (self-test)` | Runs `setup/test.sh` (no root, never changes the host: every script with `--dry-run` or against an unreachable daemon) with shellcheck, jq and the docker CLI and daemon present, and fails if any check is skipped except `systemd-analyze verify`, which the runner may lack. Covers `setup/` and the Caddy ports and network in `deploy/compose.yml`. After it first runs on main, a maintainer adds it to the required checks. |
| `naming` | `scripts/check-naming`: fails if a tracked file name or line uses the old platform prefix as an identifier ([ADR 0017](decisions/0017-naming.md)). After it first runs on main, a maintainer adds it to the required checks. |
| `tenancy` | `scripts/check-tenancy`: every table in `modules/*/migrations/*.sql` is a tenant table with `tenant_id`, row-level security and a tenant policy, tenant-scoped keys and composite foreign keys, unless `scripts/tenancy-global-tables.txt` lists it; module source spells no raw Valkey key or stream name. See [tenancy](#tenancy). After it first runs on main, a maintainer adds it to the required checks. |
| `file-size` | `scripts/check-file-size`: warns, and never fails, on tracked source files over 400 lines (the file-size rule, AGENTS.md) and OpenAPI contracts over 1,500. Not a required check. |

Do not rename these jobs; renaming breaks the required checks.

## modules
- **The runner:** `scripts/check-module [--dry-run] <module> [ROOT]` runs the checks of `modules/<module>` and stops at the first one that fails (exit 1; exit 2 on wrong usage, an unknown module or a module without checks). `scripts/check-module --list` prints the modules that have checks as a JSON array, which the `modules (list)` job hands to the matrix. Self-test: `scripts/check-module --self-test`.
- **What runs** is chosen from the module's files, so a new module gets its checks by following the convention:
  - an executable `check` file in the module: that alone, from the module folder. For checks the plain runner cannot run, for example inside the module's own image.
  - otherwise, with a `package.json`: `npm ci` in each local package it uses (`file:../../packages/<name>`, built by its `prepare` script), then `npm ci`, `npm run lint`, `npm run typecheck` and `npm test`.
  - with a `pyproject.toml`: `pip install -e ".[dev]"`, `ruff check .`, `ruff format --check .`, `mypy .` and `pytest`. A module with both files runs both sets.
  - A module folder with none of these (a placeholder) has no checks and gets no job.
- **Postgres and Valkey:** each `module (<name>)` job starts its own Valkey and Postgres from the Compose stack (`deploy/compose.yml` + `deploy/compose.test.yml`) and sets `CANCCU_VALKEY_URL`, `CANCCU_DATABASE_URL` and `CANCCU_TEST_DATABASE_URL` (the same superuser database), so tests that skip without a database run in CI. Each job has its own database, so a module's tests may drop and recreate their tables.
- **The required check** is `modules`, never the per-module names, which come and go with the modules. It runs even when a module job fails or is cancelled and then fails, because a skipped required check counts as passed. Do not rename `modules`.
- **Locally:** start Postgres and Valkey as in `deploy/compose.test.yml`, export the three variables as the job does, and run `scripts/check-module <module>` (inside a Python virtual environment for a Python module).

## demo-stack
- **Stack:** `docker compose -f deploy/compose.yml -f deploy/compose.ci.yml up -d --build --wait`. The CI overlay adds two things, and is never used for a real install:
  - `event-seed` copies `events/demo/` into the demo tenant's event folder of the files volume (`/files/demo/admin/event`) before admin starts.
  - `session-stub` stands in for Discord sign-in, which CI cannot run: admin's own rights check (the kit's, through `CANCCU_ADMIN_URL`) asks it for `GET /api/admin/session`. The cookie `canccu_session=demo-ci` is a session with every admin right; any other cookie gets 401 `not_signed_in`. Admin's real session API still answers through Caddy, and the tests check it.
- **API tests:** `scripts/demo-stack-test [--dry-run] [BASE_URL]` (curl, jq, python3): health of hello and admin through Caddy, 401 without a session (also from admin's own `GET /api/admin/session`), the sign-in page, Load from the seeded event folder, profile import and export as a zip, settings read, save and `409 version_conflict`, `404` for an unknown module, the health view. It ends by importing the demo event again, so the screenshots show it. Hand-written for now; tests generated from `contracts/` come later.
- **Screenshots:** `scripts/demo-screenshots [--dry-run] [BASE_URL] [OUT_DIR]` takes full-page Chromium screenshots (Playwright, pinned in the script) of `/admin/settings`, `/admin/settings/admin`, `/admin/health-view` and `/admin/profile`, signed in with the stub's cookie. A page that does not answer 200 fails the check. `scripts/demo-screenshots --install` installs Chromium and its system packages (CI). The PNGs are the artifact `demo-screenshots` of the run (kept 14 days); on failure the Compose logs are the artifact `demo-stack-logs`.
- **Locally:** start the stack as above, then `scripts/demo-stack-test` and `scripts/demo-screenshots`. Without Chromium's system packages, run the screenshots in the Playwright image: `docker run --rm --network host -u "$(id -u):$(id -g)" -e HOME=/tmp -v "$PWD:/repo:ro" -v /tmp/shots:/out -w /repo mcr.microsoft.com/playwright:v1.64.1-noble scripts/demo-screenshots http://127.0.0.1 /out`. Stop with `docker compose -f deploy/compose.yml -f deploy/compose.ci.yml down -v`.
- **Required check:** after this job first runs on main, a maintainer adds `demo-stack` to the required checks of the main ruleset (#4). Do not rename the job.

## Images
- `.github/workflows/release.yml` builds one image per module that has a `modules/<name>/Dockerfile`, from the repo root as in `deploy/compose.yml`, as `ghcr.io/<owner>/<repo>/<module>` in lowercase (`ghcr.io/tammilanit/canccuplatform-next/<module>`).
- **Push to main** pushes the tag `dev`. **A release tag** `v*` (for example `v0.1.0`) pushes the images with that tag. A pull request that changes the workflow or a module's Dockerfile builds the images without pushing them. A module without a Dockerfile is skipped.
- It logs in with the workflow's `GITHUB_TOKEN` (`packages: write`, only in the image job); no other secret. Build layers are cached in the GitHub Actions cache per module.
- **First push:** GHCR creates each package on its first push and links it to this repo through the `org.opencontainers.image.source` label. The packages stay private (the product owner, 2026-11-08): each host that pulls them needs root's registry login with a read-packages token, renewed when it expires ([setup/README.md](../setup/README.md#auto-deploy), Set up auto-deploy, step 3).
- These are not required checks: they run after merge.
- **Auto-deploy:** a host in dev mode pulls the `dev` images and deploys them once every image's `org.opencontainers.image.revision` label is the new main commit (`setup/deploy`, see [setup/README.md](../setup/README.md#auto-deploy)).

## contracts
- `scripts/check-contracts [--dry-run]`; tools come through `npx` with pinned versions (ajv-cli, ajv-formats, @redocly/cli), so it needs Node 22 and no `package.json`.
- Fails (exit 1) on an invalid profile, a missing asset, an invalid theme package (schema, files or references), a failing `check-theme-refs` self-test or an OpenAPI lint error; exit 2 on wrong usage or missing files.
- **Required check:** after this job first runs on main, a maintainer adds `contracts` to the required checks of the main ruleset. Do not rename the job.

## naming
- `scripts/check-naming [DIR]` scans every tracked file (names and contents) of the repo, or of `DIR`, for an identifier with the old prefix: the uppercase prefix followed by `_` or `-`, the lowercase one followed by `_` or `-` and a letter, a template `$` or a regex `[`, or the old npm scope. Exit 1 lists `file:line`; exit 2 on a broken run.
- Exempt: `docs/plans/` (history). The coreutils `cp` command never matches, because a space follows it; neither do longer words such as `scp-`.
- Self-test: `scripts/check-naming --self-test`.
- **Required check:** after this job first runs on main, a maintainer adds `naming` to the required checks of the main ruleset. Do not rename the job.

## file-size
- `scripts/check-file-size [DIR]` scans every tracked source file of the repo, or of `DIR`, and warns on each one over 400 lines, and on each `*.openapi.yaml` over 1,500 lines ([contracts/README.md](../contracts/README.md#shared-components)): a `file:line` line locally, a `::warning` annotation on the file in Actions. It exits 0 whether or not it warns, so the job never fails on a long file; exit 2 only on a broken run (not a git work tree). The self-test step does fail the job, because a failing self-test means the checker itself is broken.
- **Source:** files ending in `.ts`, `.tsx`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.sh`, `.bash`, `.css`, `.scss`, `.html`, `.svelte`, `.vue` or `.sql`, and files without an extension that start with `#!`. Docs, data, lockfiles and config are not source; OpenAPI contracts have their own limit.
- **Exempt:** generated files, marked by `@generated` or `DO NOT EDIT` in their first five lines, and the entries of `scripts/file-size-exemptions.txt`: one `<path or glob> <reason>` per line, where `*` also matches `/`. An entry without a reason is reported and exempts nothing. The health pass reviews the list ([0019](decisions/0019-work-packages.md)).
- Self-test: `scripts/check-file-size --self-test`.
- Not a required check: it only warns. Do not rename the job.

## tenancy
- `scripts/check-tenancy [DIR]` (Python 3, no packages) reads every tracked `modules/<module>/migrations/*.sql` in name order, per module, and every module source file under `modules/<module>/src/` ([0013](decisions/0013-multi-tenant-core.md) items 5–7).
- **A tenant table** (every table not on the allow-list) needs: a `tenant_id` column; `ENABLE` and `FORCE ROW LEVEL SECURITY`; a `CREATE POLICY` for all commands (no `FOR`, or `FOR ALL`) on the kit's tenant setting (`current_setting('canccu.tenant', …)`), and no permissive policy without it, because Postgres ORs permissive policies (an `AS RESTRICTIVE` one only narrows); `tenant_id` in its primary key, every unique constraint and every unique index; and foreign keys composite with `tenant_id` on both sides, except a plain reference to a global table of the same module. `DISABLE` or `NO FORCE ROW LEVEL SECURITY`, `DROP POLICY`, dropping `tenant_id` and `DROP CONSTRAINT` on a tenant table fail. The kit writes the column and the policy for you: `TENANT_COLUMN_SQL` and `rlsSql(table)` (kit-py: `rls_sql`).
- **Global tables** are listed in `scripts/tenancy-global-tables.txt`, one `<module> <table> <reason>` per line; an entry without a reason is reported and exempts nothing. A new global table needs a change to that list, so the review sees it.
- **No raw keys:** a string literal in module source starting with `events:` or `t:` fails; modules use the kit's `tenantStream`, `platformStream` and `tenantKey` (kit-py: `tenant_stream`, `platform_stream`, `tenant_key`).
- **Limits:** the SQL reader understands `CREATE TABLE`, `ALTER TABLE`, `CREATE [UNIQUE] INDEX` and `CREATE POLICY`; DDL built at runtime in code is invisible to it, so modules keep their schema in migration files.
- Exit 1 lists `file: problem`; exit 2 on a broken run (not a git work tree). Self-test: `scripts/check-tenancy --self-test`.
- **Required check:** after this job first runs on main, a maintainer adds `tenancy` to the required checks of the main ruleset. Do not rename the job.

## no-event-names
- `scripts/check-event-names [--dry-run] [BASE]` scans added lines of `BASE...HEAD`, case-insensitively.
- The term list (event name, venue, IPs, hostnames, Discord ids) is **not in the repo**. A maintainer stores it in the Actions secret `EVENT_NAME_TERMS`, one term per line or comma-separated.
- Exempt: `github.com` git remote URLs (https, ssh, `git@`) and `<org>/<repo>` slugs of this org. Nothing else: the bare org name in prose, or its domain in a hostname or URL, still fails when it is on the term list.
- The log shows only `file:line`, never the matched term.
- Locally: `EVENT_NAME_TERMS=$'term1\nterm2' scripts/check-event-names origin/main`. Self-test: `scripts/check-event-names --self-test`.
- Without the secret the check fails (exit 2), except on fork PRs, where secrets are unavailable and it is skipped with a warning; a maintainer reviews those when approving the run.

## Code review
- There is no `claude-review` check any more. It ran Claude in CI on a subscription token that can no longer be renewed, so `.github/workflows/claude-review.yml` and its prompt `.github/claude-review.md` were removed.
- In its place every PR gets an independent review outside CI. A separate reviewer that did not write the change runs the review: in Claude Code, a fresh session with `/code-review` at `high` effort, plus `/security-review` for code or config for sign-in, rights, sessions, secrets or tenancy/RLS. It posts, as the reviewer identity (see review-gate), a PR comment whose last line is `Review verdict: <pass|changes|manual — reason> <head sha>`. Neither the author nor the reviewer enables auto-merge: the dispatcher (the maintainer tooling) does so after `review-gate` passes, for PRs that need no maintainer's accept, or a maintainer does. A maintainer arranges the review for fork PRs. See AGENTS.md, A package run (step 8) and Merge rules.
- **Required check:** a maintainer removes `claude-review` from the required checks of the main ruleset before the removal merges; otherwise every PR waits for a check that never runs.
- The secret `CLAUDE_CODE_OAUTH_TOKEN` is no longer used; a maintainer may delete it under Settings → Secrets and variables → Actions.

## review-gate
- **Reviewer identity:** the gate trusts verdicts from one account only: the login in the repository variable `REVIEWER_LOGIN`. This is a dedicated reviewer bot account, and author sessions do not hold its token. Independent reviews post their verdict comment as that account; authors never post verdict lines, and comments by anyone else (maintainers included) are ignored. `author_association` is not used: the Actions token reports privately listed org members as `CONTRIBUTOR`.
- **Setup:** a maintainer sets `REVIEWER_LOGIN` under Settings → Secrets and variables → Actions → Variables, and gives the reviewer account the access it needs to comment on PRs (it does not enable auto-merge). Its token stays with the reviewer sessions or the maintainer tooling, never with author sessions and never in the repo. While the variable is unset, the gate fails with a message that says so. The variable may not be available to fork runs; there, the gate fails, and the maintainer who approves the run re-runs the check.
- **Rule:** among the reviewer identity's comments, the newest one that contains `Review verdict:` anywhere, or that has been edited, decides. The check passes only when all of these hold:
  - the comment was never edited (`updated_at` equals `created_at`);
  - its last line fully matches `^Review verdict: (pass|changes|manual — .+) ([0-9a-f]{40})$`;
  - the verdict is `pass`;
  - the SHA equals the PR's current head;
  - the base branch has not changed since the comment was posted (no `base_ref_changed`, `base_ref_force_pushed` or `automatic_base_change_succeeded` event after it in the PR timeline).

  Otherwise the check fails and names the reason: no verdict, verdict comment edited, unparseable verdict line, `changes`, `manual`, a verdict for an older head, or a base change after the verdict. A newer verdict that is not the bare last line therefore fails the gate instead of letting an older `pass` decide: a footer after it, bold, backticks, a quote or indentation. Every comment the reviewer edits fails the gate too, verdict or not.
- **Edited verdicts do not count:** anyone with write access can edit another user's comment, and the comment keeps its author. So an edited verdict comment fails the gate with "verdict comment was edited; ask for a new review". The same happens when a verdict line is edited away. The reviewer posts a new comment instead of editing an old one.
- **A push voids a review:** the new head has a new SHA, so the old `pass` no longer matches, and the check fails until the reviewer posts a verdict for the new head.
- **Triggers:** `pull_request` (opened, synchronize, reopened, ready_for_review, edited) runs the check. `edited` covers a base-branch change, which keeps the head SHA; title and body edits only re-run the check. The `review-gate (rerun on verdict)` job handles PR comments by the reviewer identity:
  - It fires on created, edited and deleted comments that contain `Review verdict:`, on edits whose old body did, and on any edit of a reviewer comment. So a withdrawn verdict or an edited note re-runs the gate at once, instead of failing it later at an unrelated moment.
  - It re-runs **every** review-gate run of that PR for the current head (same SHA, branch and head repo, and the PR number when GitHub lists one), with `.github/scripts/review-gate-rerun`. A push and a body edit that land together start two runs for one head; the check job's concurrency group (one per PR, `cancel-in-progress`) cancels one of them, but GitHub still counts each run's check, so re-running only one left the other red and kept the PR out of the queue for good (#202). A passed run is re-run too, so a newer `changes` verdict turns it red.
  - It re-runs them one at a time, each after the previous one has finished: two re-runs at once share the concurrency group and cancel each other. A re-run that a newer run cancels is re-run again. It waits for a run still in progress (it may have read the comments before the verdict), and gives up after about 8 minutes with an error.
  - It skips a run that still waits for a maintainer's approval.
  - The rerun is needed because a comment run belongs to the default branch, so its own check would never appear on the PR.

  On `merge_group` the check passes, because the PR was gated before it was queued. Every other comment on any issue or PR only starts a skipped run, which is noise in the Actions list and nothing more.
- **Why its own workflow file:** the gate re-runs its whole workflow run after each verdict, and GitHub only re-runs a run once it has finished. In `ci.yml` that would mean waiting for the full demo stack; on its own, the run finishes in seconds. Keeping it separate also keeps comment events away from the other CI jobs.
- **Safety:** no secrets and no LLM. The check job's `GITHUB_TOKEN` only reads (`contents`, `issues`, `pull-requests`). The rerun job additionally has `actions: write`, which it uses only to re-run the gate. Comment text is matched with `jq` in `.github/scripts/review-gate` and never executed. The gate runs the PR's own copy of its workflow and script, so a PR could weaken its own gate. This is why changes under `.github/` need a maintainer's accept.
- **Locally:** `.github/scripts/review-gate --self-test` and `.github/scripts/review-gate-rerun --self-test` (offline: a fake `gh` stands in for GitHub; it covers the push-plus-body-edit case, a cancelled and a failed run, both re-run in turn and never at once). To evaluate a PR: `gh api --paginate repos/<org>/<repo>/issues/<pr>/comments | jq -s 'add' > /tmp/c.json`, `gh api --paginate repos/<org>/<repo>/issues/<pr>/timeline | jq -s 'add' > /tmp/t.json`, then `REVIEWER_LOGIN=<login> .github/scripts/review-gate /tmp/c.json <head sha> <head sha> /tmp/t.json`.
- **Manual check of the rerun** (after a change to it is on `main`): on a test PR, push a commit and edit the PR body within a few seconds, so two review-gate runs start for one head (one ends cancelled, the other fails: no verdict yet). Post `Review verdict: pass <head sha>` as the reviewer identity. The `review-gate (rerun on verdict)` run logs `Re-running review-gate run <id>` once per run, one after the other, and both runs then end green, as does the required check on the PR.
- **Comment trigger:** GitHub runs comment events only from the workflow file on `main`, so re-runs on a verdict start once this workflow is merged. Before that, re-run the check by hand.
- **Required check:** after the workflow first runs on main, a maintainer adds `review-gate` to the required checks of the main ruleset. Do not rename the job.
- **Known limits.** The maintainer tooling (the dispatcher) treats every `.github/` PR as needing a maintainer's accept, which covers the first limit:
  - **A PR runs its own gate.** The check runs the PR's copy of `review-gate.yml` and `.github/scripts/review-gate`, so a PR that changes them can make its own check green. Possible follow-ups: `pull_request_target` with a checkout of the base ref only, or CODEOWNERS for `.github/` with required code-owner review.
  - **Deleted reviewer comments.** Anyone with write access can delete the reviewer's newer `changes` comment, so an older `pass` on the same head decides again. Deletions show in the organization audit log. Only people with write access can do this; it is a maintainer-only risk.
  - **The merge queue does not re-check.** On `merge_group` the gate passes without looking: a `changes` verdict posted after the PR was queued does not stop the merge. Remove the PR from the queue by hand.
  - **The rerun lookup has edge cases.** For fork PRs GitHub lists no PR number on the run, so two PRs from the same fork branch and SHA cannot be told apart. Runs older than 30 days cannot be re-run, and the rerun job then fails. In both cases, re-run the check by hand or push a new commit.

## Fork and first-time PRs
- Settings → Actions → General → "Fork pull request workflows from outside collaborators" is set to *Require approval for all outside collaborators*. CI does not run on a fork or first-time-contributor PR until a maintainer approves the run; that maintainer also arranges the independent review.
