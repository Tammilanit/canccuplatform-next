# admin

Settings, a health view, and profile Save/Load, following [contracts/admin.md](../../contracts/admin.md) and [contracts/profile.md](../../contracts/profile.md). Python (Starlette) on the kit; settings and the profile record live in Postgres.

## What it does
- **Settings:** `GET`/`PUT /api/admin/settings/{module}` with `settings_version` concurrency and the `admin.settings.changed` event. Forms are generated from each module's *declared* settings: one file `declarations/<module>.yaml` (format in `src/canccu_admin/declarations.py`). Pages: `/admin/settings`.
- **Health view:** `/admin/health-view` lists admin and every module in `CANCCU_HEALTH_TARGETS` (`hello=http://hello:8080/health,...`), `hello` included.
- **Profile:** the profile lives in the event folder (`CANCCU_EVENT_DIR`, default `/files/event`: `profile.yaml` + `assets/`). *Save* writes the current profile (record in Postgres plus stored settings) there; *Load* reads it, upgrades older versions step by step, validates it against the schema, applies it, and **warns about any file it names that is missing**. `GET`/`PUT /api/admin/profile` do the same as a zip; there a missing file is an error, as in the contract.
- **Sign-in:** `/admin/sign-in` runs Discord OAuth2 (scope `identify`, `state` bound to the browser by a short-lived `canccu_sign_in` cookie, PKCE). The redirect URI is `CANCCU_PUBLIC_URL` + `/admin/sign-in/callback`; absolute URLs never come from the `Host` header. Each sign-in starts a new session; the opaque cookie `canccu_session` (HttpOnly, SameSite=Lax, host-only, Secure when `CANCCU_PUBLIC_URL` is https) names a row in Postgres, stored as a hash. A session ends after 4 hours idle or 24 hours in all. `GET /api/admin/session` and `POST /api/admin/session/sign-out` follow the contract; pages send a signed-out browser to sign in, and a page POST from another origin is refused.
- **First-run code:** while there is no owner, every start logs a new one-time code (`first-run code: XXXX-XXXX-XXXX`, in `docker compose logs admin`). Enter it at `/admin/first-run` and sign in with Discord: that account becomes the owner, and the code is used up. A restart replaces an unused code.
- **Rights:** two roles. The owner holds every admin right; an admin holds them all except `admin.rights.write`. Everyone who signs in gets a session; without a role it has no rights. The owner makes people admins on `/admin/people`, which emits `admin.rights.changed`. Admin checks its own pages through the kit's `RightsChecker` against `CANCCU_ADMIN_URL`, like every module.

## Environment
The kit's `CANCCU_MODULE`, `CANCCU_VERSION`, `CANCCU_VALKEY_URL`, `CANCCU_ADMIN_URL`, plus `CANCCU_DATABASE_URL`; optional `CANCCU_EVENT_DIR`, `CANCCU_HEALTH_TARGETS`, `CANCCU_CONTRACTS_DIR`, `CANCCU_DECLARATIONS_DIR`. Sign-in needs `CANCCU_PUBLIC_URL`, `CANCCU_DISCORD_CLIENT_ID` and `CANCCU_DISCORD_CLIENT_SECRET` (`deploy/.env`); without them admin starts, logs the first-run code and says on `/admin/sign-in` that Discord sign-in is off.

## Check
```sh
pip install -e ".[dev]" && ruff check . && mypy . && pytest
```
The tests use in-memory stores, a fake Discord and round-trip `events/demo/`. `tests/test_auth_store.py` also runs the sign-in store against Postgres when `CANCCU_DATABASE_URL` is set (`deploy/compose.test.yml`); without it that half is skipped.
