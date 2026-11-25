# The dev server

The dev server is the VM that runs main in dev mode, so the product owner can watch changes live over the private network and watch demo runs. It serves one event, the demo event (`events/demo`), on its own hostnames. Nothing on it is real event data.

## What it runs
- **The whole platform** from `deploy/compose.yml` (every module, Postgres, Valkey, Caddy in IP mode on port 80), with `CANCCU_VERSION=dev` in `deploy/.env`.
- **How often it updates:** auto-deploy ([setup/README.md](../../setup/README.md#auto-deploy)) checks every 2 minutes. A merge to main reaches it a few minutes after its Images run has pushed the `dev` images: it checks health, and on a failure it goes back to the previous version and opens an issue. `/api/hello/health` shows the last deploy (`deploy` check).
- **After each deploy** (#709, #715), and again each hour, it seeds the demo event, once per commit, list of names and hour:
  - `python -m canccu_tenants dev-hostnames` makes the names in `CANCCU_DEV_HOSTNAMES` hostnames of the demo event, the first one primary. Pages find their event by the `Host` they are called on ([contracts/tenants.md](../../contracts/tenants.md)), so without these names every event page answers `not_found`. Names are only added: one taken out of the list stays until the demo event is reset.
  - The same command gives the demo venue (`demo-venue`) the platform's Tailscale prefixes (`CANCCU_TAILSCALE_CIDRS`, by default `100.64.0.0/10` and `fd7a:115c:a1e0::/48`) as addresses, beside the loopback and documentation prefixes it has (#733). A screen plays only from its event's venue addresses ([contracts/tenants.md](../../contracts/tenants.md), Venue IP check), and the dev server is reached over Tailscale, not a venue network. It only adds; it leaves the venue alone, and says so in the deploy log, when someone gave the demo event another venue or another event uses `demo-venue`, so it never widens where a real venue's screens play.
  - `python -m canccu_admin dev-seed` loads `events/demo`'s profile and assets (the same import as the demo stack's `PUT /api/admin/profile`): its settings, look, logo and sounds. It loads into an empty event, and again when `events/demo` changes on main, but never over a profile someone loaded or uploaded or a setting someone changed since: then it says so in the deploy log and leaves the event alone.
  - Then the demo content (below): `python -m canccu_agenda dev-seed` (the run of show), `node dist/dev-seed-cli.js` in pizza (menus and the demo order) and in moments (the demo story), in that order, as each module's own shell command ([agenda](../../modules/agenda/README.md#shell-commands), [pizza](../../modules/pizza/README.md#shell-commands), [moments](../../modules/moments/README.md#shell-commands)).
  - All refuse to run unless `CANCCU_VERSION` is `dev`. Each changes nothing that is in place, and never a part someone changed by hand: then it says so in the deploy log (`journalctl -u canccu-deploy`) and leaves that part alone. A seed that fails leaves the deploy in place, logs a warning and is tried again on the next run.

## The demo content
What the seed puts in the demo event, so its pages have something to show and to demo with. People in it are placeholders with no accounts.
- **Run of show** (`/agenda/`): on today and tomorrow of the event's time zone, counted from the day of the seed's run, so it is always current. Today: Doors open 16:00, Tournament: group stage 17:00–19:00, Pizza order 18:00–18:30, Dinner 19:30–20:30, Raffle 21:00–21:30. Tomorrow: Breakfast 10:00–11:00, Tournament: finals 12:00–15:00, Raffle 15:15–15:45, Closing ceremony 16:00–16:30. All public, added as "Demo seed". On a later day the seed moves them to the new today and tomorrow, as long as nobody changed the run of show by hand.
- **Food** (`/pizza/`, `/pizza/crew`): the demo profile's two pizzerias with their menus (Demo Pizzeria for delivery, Demo Trattoria for takeaway), and one open order at Demo Pizzeria held by Alex, with pizzas for Alex, Sam, Robin, Kim and Jo, settling to Alex, Sam and Robin marked paid. It stays open through the event day: it closes at 05:00, an hour before the day turns, and the turn cancels it as any order never called in. Once it is done or cancelled, the next hourly run opens a fresh one; while any order is under way, none is opened. The demo profile keeps ordering off, so attendees join the demo order but start none.
- **Moments** (`/moments/on-air`, `/moments/storyboards`): the storyboard and scene presets as an event's first use copies them, and Prize draw turned on for the run of show's next Raffle, so it is ready to go on air: its cards come 10 and 2 minutes before the raffle, and On air offers its Fire for a run at once. The scene presets give On air its "Peak now" crew button.

## Its URLs
`<dev host>` is the primary name from `CANCCU_DEV_HOSTNAMES`, the host of `CANCCU_PUBLIC_URL`. Plain http over the private network:
- `http://<dev host>/admin/`: the organiser's home; `/admin/sign-in` to sign in, `/admin/profile` for the event profile.
- `http://<dev host>/screen/zones/main`: the main zone as a screen draws it (signed in, see [Screens over Tailscale](#screens-over-tailscale)); `/screen/` is the kiosk page a real screen pairs from, and `/admin/screen/` the Screen studio.
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
   - Organiser pages open from anywhere with sign-in (admin access `internet`, the default, [contracts/tenants.md](../../contracts/tenants.md), Admin access). While an organiser has set it to `restricted`, they answer only from the venue or Tailscale, so open them over Tailscale then.
3. After changing `deploy/.env`, restart the stack so the modules read it: `docker compose -f deploy/compose.yml up -d --wait --no-build`.

## Screens over Tailscale
- **The main zone in a browser:** sign in on `<dev host>`, then open `http://<dev host>/screen/zones/main` (`?orientation=portrait` for a portrait screen). The real player draws the zone live, as the zone's screens show it, with every widget, takeover and theme change, but without sound. It is a person's view, not a device: it needs the sign-in and the right `screen.devices.read` (the owner has it) and, like every organiser page, the venue or Tailscale, but never the venue IP check, which is only for paired devices ([contracts/screen.md](../../contracts/screen.md), A zone for a session). This is the screen view for demos.
- **A paired screen:** `/screen/` is the kiosk page. With the demo venue's Tailscale prefixes it passes the venue check over Tailscale, so it shows a pairing code instead of "Not at the venue". It cannot finish pairing on the dev server, though: the pairing and device cookies are `Secure` ([contracts/screen.md](../../contracts/screen.md), Pairing), and a browser keeps them only over https, while the dev server is plain http. The code shows, Studio claims it, but the kiosk never collects its device. Pair a browser only once the dev server is served over https.

## Reset the demo event
- **The demo content again** (as above, over any change made by hand), one part or all of them:
  - The profile (settings, look, logo and sounds): `docker compose -f deploy/compose.yml exec admin python -m canccu_admin dev-seed --force`.
  - The run of show: `docker compose -f deploy/compose.yml exec agenda python -m canccu_agenda dev-seed --force`. It removes every item but those the tournament module manages.
  - The food: `docker compose -f deploy/compose.yml exec pizza node dist/dev-seed-cli.js --force`. It cancels every order under way, applies the profile's menus and opens a fresh demo order; pizzerias the profile does not name stay.
  - Moments: `docker compose -f deploy/compose.yml exec moments node dist/dev-seed-cli.js --force`, after the run of show. It puts the storyboard presets back with Prize draw on.
  The other data (sign-ins, screens, moments already shown) stays.
- **Everything from empty:** this deletes all data of the dev server, sign-ins, the owner and paired screens included. `docker compose -f deploy/compose.yml down -v && docker compose -f deploy/compose.yml up -d --wait --no-build` (the tenants module makes the demo event as it starts), then `sudo rm /var/lib/canccu-deploy/dev-seed && sudo systemctl start canccu-deploy`, whose run gives the event its names, the demo venue its Tailscale prefixes, and the event the demo profile and the demo content. Sign in again with a new first-run code.

## A demo run
The lead drives a flow, the product owner watches.
1. Before: the change is merged and deployed (`/api/hello/health` names its commit), and the product owner is signed in on `<dev host>`.
2. The product owner opens what the flow shows: the pages it changes, and a screen view (`/screen/zones/main`, [Screens over Tailscale](#screens-over-tailscale)) in a second window.
3. The lead does the flow step by step on their own session (for example opens an order, delays a run-of-show item, takes a moment on air) and says what each step should show; the product owner watches it land on the pages and the screen.
4. Afterwards, reset what the run left behind if the next demo needs a clean event (above). Findings become issues, not edits on the VM: code reaches it only through a merge to main.
