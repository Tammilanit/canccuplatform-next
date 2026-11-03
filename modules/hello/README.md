# hello (test module)

A test module for the Compose stack (`deploy/compose.yml`): it serves the shared `GET /health` ([contracts/admin.md](../../contracts/admin.md#health)) through `@cp/kit` and does nothing else. Both checks are essential: Valkey or Postgres down → `status: down`, HTTP 503.

Through Caddy: `http://<host-ip>/api/hello/health` (Caddy strips `/api/hello`).

## Environment

The kit's `CP_MODULE`, `CP_VERSION`, `CP_VALKEY_URL`, `CP_ADMIN_URL` (hello never calls admin), plus `CP_DATABASE_URL`. A missing one stops it at start with `missing environment variable(s): …`. It listens on port 8080 and writes nothing to disk.

## Check

```sh
(cd ../../packages/kit-ts && npm ci)   # builds the kit hello depends on
npm ci && npm run lint && npm run typecheck && npm test
```

CI runs the same commands in the `compose (deploy)` job, then starts the stack and checks the health through Caddy (200 ok, and 503 down with Valkey stopped).
