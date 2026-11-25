# The dev server

The dev server is the VM that runs main in dev mode, so the product owner can watch changes live over the private network and watch demo runs. It serves one event, the demo event (`events/demo`), on its own hostnames. Nothing on it is real event data.

## What it runs
- **The whole platform** from `deploy/compose.yml` (every module, Postgres, Valkey, Caddy in IP mode on port 80), with `CANCCU_VERSION=dev` in `deploy/.env`.
- **https on its Tailscale name** (#786): Tailscale serve holds port 443 with the tailnet's certificate and sends to Caddy's https front, `127.0.0.1:8480` ([HTTPS](#https)).
- **How often it updates:** auto-deploy ([setup/README.md](../../setup/README.md#auto-deploy)) checks every 2 minutes. A merge to main reaches it a few minutes after its Images run has pushed the `dev` images: it checks health, and on a failure it goes back to the previous version and opens an issue. `/api/hello/health` shows the last deploy (`deploy` check).
- **After each deploy** (#709, #715), and again each hour, it seeds the demo event, once per commit, list of names and hour:
  - `python -m canccu_tenants dev-hostnames` makes the names in `CANCCU_DEV_HOSTNAMES` hostnames of the demo event, the first one primary. Pages find their event by the `Host` they are called on ([contracts/tenants.md](../../contracts/tenants.md)), so without these names every event page answers `not_found`. Names are only added: one taken out of the list stays until the demo event is reset.
  - The same command gives the demo venue (`demo-venue`) the platform's Tailscale prefixes (`CANCCU_TAILSCALE_CIDRS`, by default `100.64.0.0/10` and `fd7a:115c:a1e0::/48`) as addresses, beside the loopback and documentation prefixes it has (#733). A screen plays only from its event's venue addresses ([contracts/tenants.md](../../contracts/tenants.md), Venue IP check), and the dev server is reached over Tailscale, not a venue network. It only adds; it leaves the venue alone, and says so in the deploy log, when someone gave the demo event another venue or another event uses `demo-venue`, so it never widens where a real venue's screens play.
  - Last, the same command turns the demo event's photo wall on (the `screen.photos` flag) and gives the demo event a public Wi-Fi, `demo-guest`, for the screens' venue card (#788): each only while nobody has set it.
  - `python -m canccu_admin dev-seed` loads `events/demo`'s profile and assets (the same import as the demo stack's `PUT /api/admin/profile`): its settings, look, logo and sounds. It loads into an empty event, and again when `events/demo` changes on main, but never over a profile someone loaded or uploaded or a setting someone changed since: then it says so in the deploy log and leaves the event alone.
  - Then the demo content (below): `python -m canccu_agenda dev-seed` (the run of show), `node dist/dev-seed-cli.js` in pizza (menus and the demo orders), in moments (the demo story and the day's announcements) and in screen (photos, the demo loop and ticker lines), in that order, as each module's own shell command ([agenda](../../modules/agenda/README.md#shell-commands), [pizza](../../modules/pizza/README.md#shell-commands), [moments](../../modules/moments/README.md#shell-commands), [screen](../../modules/screen/README.md#shell-commands)).
  - All refuse to run unless `CANCCU_VERSION` is `dev`. Each changes nothing that is in place, and never a part someone changed by hand: then it says so in the deploy log (`journalctl -u canccu-deploy`) and leaves that part alone. A seed that fails leaves the deploy in place, logs a warning and is tried again on the next run.

## The demo content
What the seed puts in the demo event, so its pages have something to show and to demo with, and the main zone something new in each box at least once a minute, all day (#788). People in it are placeholders with no accounts; the images and clips are generated (`events/demo/README.md`).
- **Run of show** (`/agenda/`): on today and tomorrow of the event's time zone, counted from the day of the seed's run, so it is always current. Today: Doors open 16:00, Tournament: group stage 17:00–19:00, Pizza order 18:00–18:30, Dinner 19:30–20:30, Raffle 21:00–21:30. Tomorrow: Breakfast 10:00–11:00, Tournament: finals 12:00–15:00, Raffle 15:15–15:45, Closing ceremony 16:00–16:30. All public, added as "Demo seed". On a later day the seed moves them to the new today and tomorrow, as long as nobody changed the run of show by hand.
- **Food** (`/pizza/`, `/pizza/crew`): the demo profile's two pizzerias with their menus (Demo Pizzeria for delivery, Demo Trattoria for takeaway), and one open order at Demo Pizzeria held by Alex, with pizzas for Alex, Sam, Robin, Kim and Jo, settling to Alex, Sam and Robin marked paid. It stays open through the event day: it closes at 05:00, an hour before the day turns, and the turn cancels it as any order never called in. Once it is done or cancelled, the next hourly run opens a fresh one; while any other order is under way, none is opened. Beside it a takeaway order at Demo Trattoria held by Robin, with Kim and Jo, called in with an estimate 40 minutes out; each hourly run moves it a stage: here (collect at the entrance table), then handed out with a fresh one called in, so the screens' food box and the Food pages show an order on its way or here all day, and Moments' "Pizza is here" plays every other hour. An order someone changed is left alone until it is over. The demo profile keeps ordering off, so attendees join the demo order but start none.
- **Moments** (`/moments/on-air`, `/moments/storyboards`): the storyboard and scene presets as an event's first use copies them, and Prize draw turned on for the run of show's next Raffle, so it is ready to go on air: its cards come 10 and 2 minutes before the raffle, and On air offers its Fire for a run at once. The scene presets give On air its "Peak now" crew button.
- **Announcements** (`/moments/announce`): each day of the run of show, an info one 15 minutes before its tournament item ("Tournament: group stage at 17:00") and an urgent one 30 minutes before its raffle, on the screens and the ticker (no Discord, no push). One someone edited or withdrew is never made again.
- **Screens** (`/screen/zones/main`, `/admin/screen/`): eight photos on the photo wall; the demo loop (three slides, a clip and the demo film) scheduled in the main zone every day at the lowest priority, so any window the crew adds wins; and four ticker windows, a line for each part of the day (night, morning, afternoon, evening), long enough to crawl. In the main zone's Pulse boxes: the clock turns each minute; the hero turns between the loop, the photo wall (a new lead every 8 seconds) and, within 12 hours of it, tonight's highlight; the rail between now and next and the next item's countdown; the venue rail between the Wi-Fi card and the food box; the ticker crawls. Each part is added only to an event that has none of its kind, and left alone once anyone changed it.
- **Not yet:** a sample tournament (bracket, standings, a match called) comes with the tournament module (step 7), and what's being played and who's in voice with the bot (step 6); until then the hero's bracket and hot game stay empty and skip their turn.

## Its URLs
`<dev host>` is the primary name from `CANCCU_DEV_HOSTNAMES`, the host of `CANCCU_PUBLIC_URL`, its Tailscale name. https over the tailnet ([HTTPS](#https)); plain http on that name redirects to https. Another name of the list (a LAN name) stays plain http, with pages signed out:
- `https://<dev host>/admin/`: the organiser's home; `/admin/sign-in` to sign in, `/admin/profile` for the event profile.
- `https://<dev host>/screen/zones/main`: the main zone as a screen draws it (signed in, see [Screens over Tailscale](#screens-over-tailscale)); `/screen/` is the kiosk page a real screen pairs from, and `/admin/screen/` the Screen studio.
- `https://<dev host>/agenda/`: the run of show.
- `https://<dev host>/pizza/`: Food for attendees, `/pizza/crew` for the crew.
- `https://<dev host>/moments/on-air`: Moments.
- `https://<dev host>/theming/studio/`: the Theme studio.
- `https://<dev host>/api/hello/health`: health, with the last deploy.

## Set up
Once, on the dev server, after [Set up auto-deploy](../../setup/README.md#auto-deploy). Real names and secrets go in `deploy/.env` only, never in the repo.
1. **Hostnames:** in `deploy/.env`, `CANCCU_DEV_HOSTNAMES=<full name> [<other name> …]`, space or comma separated, the one the product owner signs in on first (for example the VM's Tailscale name `<name>.<tailnet>.ts.net`, then its LAN name `<name>.lan`). Each must be fully qualified: the platform resolves no single-label name, so a bare `<name>` does not work. The next deploy run adds them; to apply them at once: `sudo systemctl start canccu-deploy`.
2. **https:** as in [HTTPS](#https), before sign-in: Web Push and the screens' pairing work only over https.
3. **Sign-in** is the same Discord sign-in as everywhere; nothing is stubbed on the dev server.
   - In `deploy/.env`: `CANCCU_PUBLIC_URL=https://<dev host>` (the primary name), `CANCCU_DISCORD_CLIENT_ID` and `CANCCU_DISCORD_CLIENT_SECRET` of the platform's Discord application.
   - **The Discord application needs the dev redirect URL.** The product owner, who owns the application, adds `https://<dev host>/admin/sign-in/callback` in the [Discord Developer Portal](https://discord.com/developers/applications): the application → OAuth2 → Redirects → Add Redirect → Save. It must match `CANCCU_PUBLIC_URL` exactly (scheme, name, no port).
   - Sign in on that name: the session cookie belongs to it, and admin refuses a form sent from any other origin. Pages on another name of the list load, but signed out.
   - The first person to sign in becomes the owner with the first-run code: `docker compose -f deploy/compose.yml logs admin | grep "first-run code"`, then `https://<dev host>/admin/first-run` ([modules/admin/README.md](../../modules/admin/README.md)).
   - Organiser pages open from anywhere with sign-in (admin access `internet`, the default, [contracts/tenants.md](../../contracts/tenants.md), Admin access). While an organiser has set it to `restricted`, they answer only from the venue or Tailscale, so open them over Tailscale then.
4. After changing `deploy/.env`, restart the stack so the modules read it: `docker compose -f deploy/compose.yml up -d --wait --no-build`.

## HTTPS
Browsers allow Web Push (service workers) only in a secure context, and keep the screens' pairing and device cookies only over https, since they are `Secure`. So the dev server is served over https on its Tailscale name (#786).
- **How:** Tailscale serve holds port 443 on the tailnet with the tailnet's certificate, and sends to Caddy's https front, `127.0.0.1:8480`. Caddy itself stays in IP mode on port 80, with no certificate of its own. Why not Caddy with the tailnet certificate: Caddy would need tailscaled's socket and port 443, which Tailscale serve already holds on this host (#255), and the TLS option for real domains is its own work (#5); Tailscale serve was already in place and renews its certificate itself.
- **The client address:** Tailscale serve reaches Caddy through Docker's gateway, so the app would see the gateway (`172.18.0.1`), not the phone. Caddy's front trusts the `X-Forwarded-For` and `X-Forwarded-Proto` that Tailscale serve sends, and passes the client's own address on, so logs, rate limits and every address check see the tailnet address (`100.x.y.z`), and pages know they are on https. Compose publishes the front only on the host's loopback, so nothing but the host reaches it; port 80 trusts no proxy, and a client's own `X-Forwarded-For` never counts there ([deploy/Caddyfile](../../deploy/Caddyfile)).
- **Plain http** on `<dev host>` redirects to https (308) once `CANCCU_PUBLIC_URL` is https. Every other name and address stays on plain http.

**What the product owner changes,** once, after the change that adds the front is deployed (`/api/hello/health` names its commit). The lead never edits `deploy/.env`, the host or the portal. In this order, since Caddy redirects plain http on `<dev host>` as soon as `CANCCU_PUBLIC_URL` is https, and a Tailscale serve still sending to port 80 would then loop:
1. Tailscale serve to the front. `sudo tailscale serve status` shows what it serves now; take off what it sends to port 80, then send to the front:
   ```
   sudo tailscale serve --https=443 off
   sudo tailscale serve --bg --https=443 http://127.0.0.1:8480
   ```
   If the `off` line is refused, `sudo tailscale serve reset` takes it off instead (with anything else serve holds). `tailscale serve status` then lists `https://<dev host>` → `proxy http://127.0.0.1:8480`. HTTPS certificates must be on in the tailnet's DNS settings (they are, since serve already ran).
2. In `deploy/.env`, the line:
   ```
   CANCCU_PUBLIC_URL=https://<dev host>
   ```
3. In the [Discord Developer Portal](https://discord.com/developers/applications), the application → OAuth2 → Redirects → Add Redirect, then Save:
   ```
   https://<dev host>/admin/sign-in/callback
   ```
   The old `http://<dev host>/admin/sign-in/callback` may stay or go.
4. Restart the stack so Caddy and the modules read the new URL: `docker compose -f deploy/compose.yml up -d --wait --no-build`.
5. Sign in again on `https://<dev host>/admin/sign-in`: the old session cookie belongs to the http address.

**Check it:** `curl -sI http://<dev host>/admin/` answers `308` with `location: https://<dev host>/admin/`; `https://<dev host>/api/hello/health` is `ok`. On the phone, open `https://<dev host>/` and turn notifications on in the hub; the next notification of a topic switched on (for example the lead delays a run-of-show item) then arrives as a push. `https://<dev host>/screen/` shows a pairing code, not "Not at the venue": the venue check sees the tailnet address, which the demo venue holds, where before it saw Docker's gateway and refused.

## Screens over Tailscale
- **The main zone in a browser:** sign in on `<dev host>`, then open `https://<dev host>/screen/zones/main` (`?orientation=portrait` for a portrait screen). The real player draws the zone live, as the zone's screens show it, with every widget, takeover and theme change, but without sound. It is a person's view, not a device: it needs the sign-in and the right `screen.devices.read` (the owner has it) and, like every organiser page, the venue or Tailscale, but never the venue IP check, which is only for paired devices ([contracts/screen.md](../../contracts/screen.md), A zone for a session). This is the screen view for demos.
- **A paired screen:** `/screen/` is the kiosk page. With the demo venue's Tailscale prefixes it passes the venue check over Tailscale, so it shows a pairing code instead of "Not at the venue". Over https ([HTTPS](#https)) the browser keeps the pairing and device cookies, which are `Secure` ([contracts/screen.md](../../contracts/screen.md), Pairing): open `https://<dev host>/screen/`, claim its code in Studio (`https://<dev host>/admin/screen/devices`), and the kiosk collects its device. Over plain http (a LAN name) it never does: the code shows and Studio claims it, but the browser drops the cookies.

## Reset the demo event
- **The demo content again** (as above, over any change made by hand), one part or all of them:
  - The profile (settings, look, logo and sounds): `docker compose -f deploy/compose.yml exec admin python -m canccu_admin dev-seed --force`.
  - The run of show: `docker compose -f deploy/compose.yml exec agenda python -m canccu_agenda dev-seed --force`. It removes every item but those the tournament module manages.
  - The food: `docker compose -f deploy/compose.yml exec pizza node dist/dev-seed-cli.js --force`. It cancels every order under way, applies the profile's menus, opens a fresh demo order and calls in a fresh takeaway one; pizzerias the profile does not name stay.
  - Moments: `docker compose -f deploy/compose.yml exec moments node dist/dev-seed-cli.js --force`, after the run of show. It puts the storyboard presets back with Prize draw on, and schedules the day's announcements afresh (the seed's that had not gone out are withdrawn).
  - The screens: `docker compose -f deploy/compose.yml exec screen node dist/dev-seed-cli.js --force`. It removes the photos, the demo loop and the ticker lines the seed added and adds them again; what the crew added stays. The photo wall's flag and the Wi-Fi are the tenants command's (above): set by hand, they stay as set.
  The other data (sign-ins, screens, moments already shown) stays.
- **Everything from empty:** this deletes all data of the dev server, sign-ins, the owner and paired screens included. `docker compose -f deploy/compose.yml down -v && docker compose -f deploy/compose.yml up -d --wait --no-build` (the tenants module makes the demo event as it starts), then `sudo rm /var/lib/canccu-deploy/dev-seed && sudo systemctl start canccu-deploy`, whose run gives the event its names, the demo venue its Tailscale prefixes, and the event the demo profile and the demo content. Sign in again with a new first-run code.

## A demo run
The lead drives a flow, the product owner watches.
1. Before: the change is merged and deployed (`/api/hello/health` names its commit), and the product owner is signed in on `<dev host>`.
2. The product owner opens what the flow shows: the pages it changes, and a screen view (`/screen/zones/main`, [Screens over Tailscale](#screens-over-tailscale)) in a second window.
3. The lead does the flow step by step on their own session (for example opens an order, delays a run-of-show item, takes a moment on air) and says what each step should show; the product owner watches it land on the pages and the screen.
4. Afterwards, reset what the run left behind if the next demo needs a clean event (above). Findings become issues, not edits on the VM: code reaches it only through a merge to main.
