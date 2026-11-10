# theming

Each event's theme ([contracts/theming.md](../../contracts/theming.md)). The first slice (`theming-core`, [docs/plans/issue-185.md](../../docs/plans/issue-185.md)) holds the module's skeleton, its store, the current theme and the served theme files; #186 adds embeds in the same-host sandbox. Drafts, publish and restore (#241), uploads (#242), the brand kit (#243), packages (#244), CSS and templates (#245), readability, pins and retention (#246) and the pages (#247) build on it.

- **Stack:** Node 22, Fastify 5, `pg`, on `@canccu/kit` and `@canccu/ui` (the token defaults) ([0006](../../docs/decisions/0006-stack.md)). Port 8080. Caddy routes `/api/theming/*` and `/theming/*` here unchanged, and `/api/theming/health` to `/health`.
- **Env:** the kit's (`CANCCU_MODULE`, `CANCCU_VERSION`, `CANCCU_VALKEY_URL`, `CANCCU_ADMIN_URL`, `CANCCU_SERVICE_KEY`), plus `CANCCU_DATABASE_URL` (the login role it serves as), `CANCCU_MIGRATE_DATABASE_URL` (the migration role), `CANCCU_TENANTS_URL`, `CANCCU_SIGNIN_HOSTNAME`, `CANCCU_SUPERADMIN_HOSTNAME` and `CANCCU_IP_MODE`.
- **Data:** `migrations/*.sql`, run at start by the kit's `runMigrations` (ledger `theming_migrations`). Every table is per event under RLS, and requests run as `canccu_theming_app`: `theming_files` (content-addressed, `<sha256>.<ext>` under `/files/<tenant>/theming/files/`), `theming_drafts`, `theming_revisions` (immutable; the highest is current), `theming_file_refs` (what refers to a file: `draft` or `r:<revision>`), `theming_pins` and `theming_embed_files` (an embed's files by owner, embed and path inside its folder; the only thing that refers to stored HTML, JS and JSON). `putEmbed` (`src/embeds.ts`) stores an embed for an owner; publish (#241) and package uploads (#244) call it. The prefix keeps them apart from other modules' tables in the shared schema.
- **Routes so far:**
  - `GET /api/theming/current`: the highest revision, or revision 0: the platform defaults with the profile's `theme` over them. Readable by whoever the event's info-page mode lets in; a session is looked up only when guests are kept out, and any valid session counts as a member until #150 (`isMember` in `src/routes.ts`). No module can read the profile yet (`src/profile.ts`), so revision 0 is the platform defaults for now.
  - `GET /theming/a/<sha256>.<ext>`: a file a revision refers to, public and immutable. Revision 0's token CSS is generated on each read and never stored, so any container serves it by generating it again.
  - `GET /theming/draft/<sha256>.<ext>`: a file the draft refers to, `no-store`, to `theming.theme.write` within the admin address rule.
  - `GET /theming/sandbox/<revision>/<embed>/<path>` and `GET /theming/sandbox/draft/<draft key>/<embed>/<path>`: an embed's files, with the sandbox CSP (`<embed base>` is the embed's folder on the request's own origin; `connect-src 'none'`; `sandbox allow-scripts`), `Cross-Origin-Resource-Policy: cross-origin`, `Access-Control-Allow-Origin: *`, immutable for a revision and `no-store` for the draft. The entry goes only to a frame (`Sec-Fetch-Dest: iframe` or `frame`), every other file only to cross-site requests (an opaque origin's); in IP mode (`CANCCU_IP_MODE=demo`, plain http) that Fetch Metadata rule is skipped. Every response under the path, errors included, sets no cookie, and a refusal is an empty body under `default-src 'none'; sandbox`, so a failed embed paints nothing over the still behind its frame. `GET /api/theming/current` lists each stored embed of the revision with its `frame_url`.
  - Every file response has `nosniff`, `Cross-Origin-Resource-Policy: same-origin` and the content type of its checked type. SVG also has the sandboxing CSP and `Content-Disposition: attachment`.
- **Health:** `postgres`, `valkey` and `files` (the files volume is readable; publishing, #241, needs it writable).

## Check

```sh
npm ci && npm run lint && npm run typecheck && npm test
```

`packages/kit-ts` and `packages/ui` need `npm ci` first. The tests need a Postgres for RLS and skip without one. Point `CANCCU_DATABASE_URL` at a throwaway database whose name ends in `_test` (the tests drop and recreate the theming tables, and refuse any other name; [docs/ci.md](../../docs/ci.md#modules)) as a superuser; requests still run as the app role, which RLS binds:

```sh
docker run -d --rm --name canccu-theming-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=canccu_test -p 127.0.0.1:55433:5432 postgres:17.11-alpine
CANCCU_DATABASE_URL=postgres://postgres:test@127.0.0.1:55433/canccu_test npm test
docker stop canccu-theming-test
```

`test/sandbox.browser.test.ts` proves the sandbox in Chromium (opaque origin, no storage, no network, no access to the page, the still on failure and under reduced motion) with the level-up demo theme's `drift` embed. It uses Playwright's Chromium where one is installed, else the system Chrome (`channel: "chrome"`, as on CI runners); without either it skips locally and fails in CI. Where the host lacks Chromium's libraries, run it in Playwright's image:

```sh
docker run --rm --network host -u "$(id -u):$(id -g)" -e HOME=/tmp -e CANCCU_DATABASE_URL=postgres://postgres:test@127.0.0.1:55433/postgres \
  -v "$PWD/../..:$PWD/../.." -w "$PWD" mcr.microsoft.com/playwright:v1.64.1-noble npx vitest run test/sandbox.browser.test.ts
```
