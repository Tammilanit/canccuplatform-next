# screen

The venue screens ([contracts/screen.md](../../contracts/screen.md)). It holds the module's skeleton, devices with pairing, and zones with assignments and mirroring (#220); moving devices (#221), heartbeat and health (#222), content (#108) and the player (#109) build on it.

- **Stack:** Node 22, Fastify 5, `pg`, on `@canccu/kit` ([0006](../../docs/decisions/0006-stack.md)). Port 8080. Caddy routes `/api/screen/*` here unchanged and `/api/screen/health` to `/health`.
- **Env:** the kit's (`CANCCU_MODULE`, `CANCCU_VERSION`, `CANCCU_VALKEY_URL`, `CANCCU_ADMIN_URL`, `CANCCU_SERVICE_KEY`), plus `CANCCU_DATABASE_URL` (the login role it serves as), `CANCCU_MIGRATE_DATABASE_URL` (the migration role), `CANCCU_TENANTS_URL`, `CANCCU_SIGNIN_HOSTNAME`, `CANCCU_SUPERADMIN_HOSTNAME` and `CANCCU_IP_MODE`.
- **Data:** `migrations/*.sql`, run at start by the kit's `runMigrations` (ledger `screen_migrations`). `devices` is the one global table (device identity only); every other table (`assignments`, `screen_zones`, `screen_zone_seeds`) is per event under RLS, and requests run as `canccu_screen_app`. Open pairing codes live in Valkey for 10 minutes, device commands for 60 seconds; no device token is ever stored, only its SHA-256.
- **Routes so far:** `POST`, `DELETE /api/screen/pairing`, `GET /api/screen/pairing/{pairing_id}`, `GET`, `POST /api/screen/devices`, `PATCH /api/screen/devices/{device_id}`, `POST /api/screen/devices/{device_id}/revoke`, `PUT`, `DELETE /api/screen/devices/{device_id}/assignment`, `POST /api/screen/devices/{device_id}/commands`, `GET`, `POST /api/screen/zones`, `GET`, `PUT`, `DELETE /api/screen/zones/{zone_key}`. `requireDevice` (`src/device-access.ts`) is the check the device routes of later slices run; `takeCommands` (`src/assignments.ts`) is what the push channel (#109) delivers, and `ZONE_USES` (`src/zones.ts`) is where #108 adds its own `zone_in_use` checks.
- **Zones:** an event gets its `main` zone once, on `tenants.tenant.created` or its first zone, assignment or pairing request, whichever comes first; a deleted `main` is not made again. `detachDevice` (`src/detach.ts`) is the one place that clears mirrors and sound devices when a device leaves the event.

- **Cookies** `canccu_pairing` and `canccu_device` are always `Secure`, as the contract says, so browsers keep them only over HTTPS: the IP-mode demo stack (plain http on port 80) cannot pair a real kiosk until TLS (#5). The tests send the cookies themselves.

## Check

```sh
npm ci && npm run lint && npm run typecheck && npm test
```

The tests need a Postgres for RLS and skip without one. Point `CANCCU_TEST_DATABASE_URL` at a throwaway database (the tests drop and recreate the screen tables) as a superuser; requests still run as the app role, which RLS binds:

```sh
docker run -d --rm --name canccu-screen-test -e POSTGRES_PASSWORD=test -p 127.0.0.1:55432:5432 postgres:17.11-alpine
CANCCU_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/postgres npm test
docker stop canccu-screen-test
```
