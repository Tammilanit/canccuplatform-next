# theming

Each event's theme ([contracts/theming.md](../../contracts/theming.md)). This first slice (`theming-core`, [docs/plans/issue-185.md](../../docs/plans/issue-185.md)) holds the module's skeleton, its store, the current theme and the served theme files. Drafts, publish and restore (#241), uploads (#242), the brand kit (#243), packages (#244), CSS and templates (#245), readability, pins and retention (#246) and the pages (#247) build on it.

- **Stack:** Node 22, Fastify 5, `pg`, on `@canccu/kit` and `@canccu/ui` (the token defaults) ([0006](../../docs/decisions/0006-stack.md)). Port 8080. Caddy routes `/api/theming/*` and `/theming/*` here unchanged, and `/api/theming/health` to `/health`.
- **Env:** the kit's (`CANCCU_MODULE`, `CANCCU_VERSION`, `CANCCU_VALKEY_URL`, `CANCCU_ADMIN_URL`, `CANCCU_SERVICE_KEY`), plus `CANCCU_DATABASE_URL` (the login role it serves as), `CANCCU_MIGRATE_DATABASE_URL` (the migration role), `CANCCU_TENANTS_URL`, `CANCCU_SIGNIN_HOSTNAME`, `CANCCU_SUPERADMIN_HOSTNAME` and `CANCCU_IP_MODE`.
- **Data:** `migrations/*.sql`, run at start by the kit's `runMigrations` (ledger `theming_migrations`). Every table is per event under RLS, and requests run as `canccu_theming_app`: `files` (content-addressed, `<sha256>.<ext>` under `/files/<tenant>/theming/files/`), `drafts`, `revisions` (immutable; the highest is current), `file_refs` (what refers to a file: `draft` or `r:<revision>`) and `pins`.
- **Routes so far:**
  - `GET /api/theming/current`: the highest revision, or the platform defaults as revision 0. Readable by whoever the event's info-page mode lets in; any valid session counts as a member.
  - `GET /theming/a/<sha256>.<ext>`: a file a revision refers to, public and immutable. The defaults' token CSS is the same for every event, so it is served from memory.
  - `GET /theming/draft/<sha256>.<ext>`: a file the draft refers to, `no-store`, to `theming.theme.write` within the admin address rule.
  - Every file response has `nosniff`, `Cross-Origin-Resource-Policy: same-origin` and the content type of its checked type. SVG also has the sandboxing CSP and `Content-Disposition: attachment`.
- **Health:** `postgres`, `valkey` and `files` (the files volume is readable; publishing, #241, needs it writable).

## Check

```sh
npm ci && npm run lint && npm run typecheck && npm test
```

`packages/kit-ts` and `packages/ui` need `npm ci` first. The tests need a Postgres for RLS and skip without one. Point `CANCCU_TEST_DATABASE_URL` at a throwaway database (the tests drop and recreate the theming tables) as a superuser; requests still run as the app role, which RLS binds:

```sh
docker run -d --rm --name canccu-theming-test -e POSTGRES_PASSWORD=test -p 127.0.0.1:55433:5432 postgres:17.11-alpine
CANCCU_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55433/postgres npm test
docker stop canccu-theming-test
```
