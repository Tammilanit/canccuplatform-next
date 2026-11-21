# The dev server

The dev server is the VM that runs main in dev mode, so the product owner can watch changes live over the private network and watch demo runs. It serves one event, the demo event (`events/demo`), on its own hostnames. Nothing on it is real event data.

## What it runs
- **The whole platform** from `deploy/compose.yml` (every module, Postgres, Valkey, Caddy in IP mode on port 80), with `CANCCU_VERSION=dev` in `deploy/.env`.
- **How often it updates:** auto-deploy ([setup/README.md](../../setup/README.md#auto-deploy)) checks every 2 minutes. A merge to main reaches it a few minutes after its Images run has pushed the `dev` images: it checks health, and on a failure it goes back to the previous version and opens an issue. `/api/hello/health` shows the last deploy (`deploy` check).
- **After each deploy** (#709) it seeds the demo event, once per commit and list of names:
  - `python -m canccu_tenants dev-hostnames` makes the names in `CANCCU_DEV_HOSTNAMES` hostnames of the demo event, the first one primary. Pages find their event by the `Host` they are called on ([contracts/tenants.md](../../contracts/tenants.md)), so without these names every event page answers `not_found`. Names are only added: one taken out of the list stays until the demo event is reset.
  - `python -m canccu_admin dev-seed` loads `events/demo`'s profile and assets (the same import as the demo stack's `PUT /api/admin/profile`): its settings, look, logo and sounds. It loads into an empty event, and again when `events/demo` changes on main, but never over a profile someone loaded or uploaded or a setting someone changed since: then it says so in the deploy log and leaves the event alone.
  - Both refuse to run unless `CANCCU_VERSION` is `dev`. A seed that fails leaves the deploy in place, logs a warning (`journalctl -u canccu-deploy`) and is tried again on the next run.

## Its URLs
`<dev host>` is the primary name from `CANCCU_DEV_HOSTNAMES`, the host of `CANCCU_PUBLIC_URL`. Plain http over the private network:
- `http://<dev host>/admin/`: the organiser's home; `/admin/sign-in` to sign in, `/admin/profile` for the event profile.
- `http://<dev host>/screen/zones/main`: the main zone as a screen draws it (signed in); `/screen/` is the kiosk page a real screen pairs from, and `/admin/screen/` the Screen studio.
- `http://<dev host>/agenda/`: the run of show.
- `http://<dev host>/pizza/`: Food for attendees, `/pizza/crew` for the crew.
- `http://<dev host>/moments/on-air`: Moments.
- `http://<dev host>/theming/studio/`: the Theme studio.
- `http://<dev host>/api/hello/health`: health, with the last deploy.

## Set up
Once, on the dev server, after [Set up auto-deploy](../../setup/README.md#auto-deploy). Real names and secrets go in `deploy/.env` only, never in the repo.
1. **Hostnames:** in `deploy/.env`, `CANCCU_DEV_HOSTNAMES=<full name> [<other name> …]`, space or comma separated, the one the product owner signs in on first (for example the VM's Tailscale name `<name>.<tailnet>.ts.net`, then its LAN name `<name>.lan`). Each must be fully qualified: the platform resolves no single-label name, so a bare `<name>` does not work. The next deploy run adds them; to apply them at once: `sudo systemctl start canccu-deploy`.
2. **Sign-in** is the same Discord sign-in as everywhere; nothing is stubbed on the dev server.
   - In `deploy/.env`: `CANCCU_PUBLIC_URL=http://<dev host>` (the primary name), `CANCCU_DISCORD_CLIENT_ID` and `CANCCU_DISCORD_CLIENT_SECRET` of the platform's Discord application.
   - **The Discord application needs the dev redirect URL.** The product owner, who owns the application, adds `http://<dev host>/admin/sign-in/callback` in the [Discord Developer Portal](https://discord.com/developers/applications): the application → OAuth2 → Redirects → Add Redirect → Save. It must match `CANCCU_PUBLIC_URL` exactly (scheme, name, no port 80).
   - Sign in on that name: the session cookie belongs to it, and admin refuses a form sent from any other origin. Pages on another name of the list load, but signed out.
   - The first person to sign in becomes the owner with the first-run code: `docker compose -f deploy/compose.yml logs admin | grep "first-run code"`, then `http://<dev host>/admin/first-run` ([modules/admin/README.md](../../modules/admin/README.md)).
   - Organiser pages answer only from the venue or Tailscale while the event's admin access is restricted (the default, [contracts/tenants.md](../../contracts/tenants.md), Admin access), so open them over Tailscale.
3. After changing `deploy/.env`, restart the stack so the modules read it: `docker compose -f deploy/compose.yml up -d --wait --no-build`.

## Reset the demo event
- **The demo profile again** (settings, look, logo and sounds as in `events/demo`, over any change made by hand): `docker compose -f deploy/compose.yml exec admin python -m canccu_admin dev-seed --force`. The other modules' data (run of show, orders, moments, screens) stays.
- **Everything from empty:** this deletes all data of the dev server, sign-ins, the owner and paired screens included. `docker compose -f deploy/compose.yml down -v && docker compose -f deploy/compose.yml up -d --wait --no-build` (the tenants module makes the demo event as it starts), then `sudo rm /var/lib/canccu-deploy/dev-seed && sudo systemctl start canccu-deploy`, whose run gives the event its names and the demo profile. Sign in again with a new first-run code.

## A demo run
The lead drives a flow, the product owner watches.
1. Before: the change is merged and deployed (`/api/hello/health` names its commit), and the product owner is signed in on `<dev host>`.
2. The product owner opens what the flow shows: the pages it changes, and a screen view (`/screen/zones/main`, or a paired screen) in a second window.
3. The lead does the flow step by step on their own session (for example opens an order, delays a run-of-show item, takes a moment on air) and says what each step should show; the product owner watches it land on the pages and the screen.
4. Afterwards, reset what the run left behind if the next demo needs a clean event (above). Findings become issues, not edits on the VM: code reaches it only through a merge to main.
