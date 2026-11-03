# admin

Settings, a health view, and profile Save/Load, following [contracts/admin.md](../../contracts/admin.md) and [contracts/profile.md](../../contracts/profile.md). Python (Starlette) on the kit; settings and the profile record live in Postgres.

## What it does
- **Settings:** `GET`/`PUT /api/admin/settings/{module}` with `settings_version` concurrency and the `admin.settings.changed` event. Forms are generated from each module's *declared* settings: one file `declarations/<module>.yaml` (format in `src/cp_admin/declarations.py`). Pages: `/admin/settings`.
- **Health view:** `/admin/health-view` lists admin and every module in `CP_HEALTH_TARGETS` (`hello=http://hello:8080/health,...`), `hello` included.
- **Profile:** the profile lives in the event folder (`CP_EVENT_DIR`, default `/files/event`: `profile.yaml` + `assets/`). *Save* writes the current profile (record in Postgres plus stored settings) there; *Load* reads it, upgrades older versions step by step, validates it against the schema, applies it, and **warns about any file it names that is missing**. `GET`/`PUT /api/admin/profile` do the same as a zip; there a missing file is an error, as in the contract.

Rights come from the kit's `RightsChecker` via `/api/admin/session`, which arrives with sign-in (#10); until then every protected route answers 401.

## Environment
The kit's `CP_MODULE`, `CP_VERSION`, `CP_VALKEY_URL`, `CP_ADMIN_URL`, plus `CP_DATABASE_URL`; optional `CP_EVENT_DIR`, `CP_HEALTH_TARGETS`, `CP_CONTRACTS_DIR`, `CP_DECLARATIONS_DIR`.

## Check
```sh
pip install -e ".[dev]" && ruff check . && mypy . && pytest
```
The tests use in-memory stores and round-trip `events/demo/`; the Postgres store is exercised by the Compose job only through `/health`.
