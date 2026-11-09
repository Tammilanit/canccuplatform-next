# hello (test module)

A test module for the Compose stack (`deploy/compose.yml`): it serves the shared `GET /health` ([contracts/admin.md](../../contracts/admin.md#health)) through `@canccu/kit` and does nothing else. Both checks are essential: Valkey or Postgres down → `status: down`, HTTP 503.

Through Caddy: `http://<host-ip>/api/hello/health` (Caddy strips `/api/hello`).

**The `deploy` check** (only with `CANCCU_DEPLOY_STATUS_FILE` set, as `deploy/compose.yml` does): the host's auto-deploy result, read from the file `setup/deploy` writes ([setup/README.md](../../setup/README.md#auto-deploy), Status). It names the deployed commit, and turns `degraded` (never `down`, so HTTP 200) after two failed deploy runs in a row: `failing since <time> (<n> runs in a row): <error>; <commit> still runs`. No file: `ok`, `no auto-deploy on this host`. An unreadable file: `degraded`.

## Environment

The kit's `CANCCU_MODULE`, `CANCCU_VERSION`, `CANCCU_VALKEY_URL`, `CANCCU_ADMIN_URL` (hello never calls admin), plus `CANCCU_DATABASE_URL`, and the optional `CANCCU_DEPLOY_STATUS_FILE`. A missing required one stops it at start with `missing environment variable(s): …`. It listens on port 8080 and writes nothing to disk.

## Check

```sh
(cd ../../packages/kit-ts && npm ci)   # builds the kit hello depends on
npm ci && npm run lint && npm run typecheck && npm test
```

CI runs the same commands in the `compose (deploy)` job, then starts the stack and checks the health through Caddy (200 ok, and 503 down with Valkey stopped).
