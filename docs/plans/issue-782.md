# Plan: issue #782 — screens on the admin home, page descriptions and tooltips, plain Notifications, the event's details page, the AI key how-to

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, task by task, test first. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Do the six items of the PO's 2026-11-23 look at the organiser pages, plus the notification tests and health the lead added on the issue the same day: a Screens section on a new admin home, a required one- or two-sentence description on every organiser and crew page, one kit tooltip used everywhere, a plain Notifications page with a usable advanced view, health box and crew test, one Event page for every event-specific base setting, and step-by-step instructions next to the AI reader's key.

**Architecture:** The kit (`packages/ui` for TypeScript, `canccu_kit.ui` for Python, `packages/ui/ui.css`, admin's `static/shell.js` that every organiser shell loads) gains the required description and the tooltip; every module's page wrapper passes them on. Admin gets two pages (`/admin/` home, `/admin/event`) that read and write through each owner's API with the person's cookie, as `access_pages.py` does today. Tenants adds a few fields and two reads; notify adds a health read, a crew test and two columns. Every contract change is additive.

**Tech stack:** Python 3 (Starlette, the kit, pytest, mypy), TypeScript (Fastify 5, `@canccu/ui`, vitest), Postgres with RLS, Playwright (browser tests and the CI screenshots).

**Status:** the lead answered Q1–Q9 on 2026-11-25: all as recommended; B and C are high risk (Q4, Q7). Part A is built in the plan's PR; the lead releases B, then C, after each merge. C still waits for the PO's accept of sheets 01 and 02.

**Spec:** [issue #782](https://github.com/Tammilanit/canccuplatform-next/issues/782) with the lead's comment of 2026-11-23 (notification tests and health); [contracts/tenants.md](../../contracts/tenants.md), [contracts/notify.md](../../contracts/notify.md), [contracts/admin.md](../../contracts/admin.md); the admin control room pack ([docs/briefs/admin-control-room.md](../briefs/admin-control-room.md), sheet 07 for the Event page).

## Why a plan first
1. **Size.** About 8,000 changed lines of source and tests (below), twice the package limit of about 4,000 ([AGENTS.md](../../AGENTS.md#how-work-flows)). The issue says the lead may split it; a worker may not, so the split is Q1.
2. **A PO gate.** Item 4 asks for two sheets the PO accepts before the build. They are in this PR.
3. **Overlap with blocked issues.** #744 (the control center at `/admin`), #745 (a switch per module) and #748 (event basics on one page) cover parts of items 1 and 5; #150 (series, clone, join link, event admins) is not built, and the Event page's Series, join and organiser rows read from it. Q2–Q5 draw the line.

## The sheets (for the PO)
SVG, the dark organiser shell and the `packages/ui` tokens, demo names only. Numbered markers point to the notes under each sheet.

| Sheet | What it shows |
|---|---|
| [01-notifications.svg](issue-782/01-notifications.svg) | The Notifications page at 1280 and 390 px: the page's description, the health box ("Can attendees get notifications?": https, push key, devices, last delivery, each with what to do) with "Send a test to the crew", then each kind of notification in plain words with an example of what a phone shows and an on/off switch, the notice with Undo after a switch, and two tooltips |
| [02-notifications-advanced.svg](issue-782/02-notifications-advanced.svg) | Advanced at 1280 and 390 px: grouped by the part a kind comes from, channels as switches in words with tooltips, the reminder lead time as a stepper with quick picks, how many went out, and the editor of the event's own kinds with choices (base, "Only when" field, test and value as lists) |

Words on the sheets: "kind of notification" for topic, "Phone notification" for push and "Discord message" for a DM. The page's title stays "Notifications" (PO, 2026-11-23).

## Parts
| Part | Items | Lines (source + tests) | Risk |
|---|---|---|---|
| A. The kit rules and the AI key: required page descriptions and their check, the tooltip, descriptions and tooltips on every existing page, the how-to next to the key | 2, 3, 6 | ≈ 2,800 | normal (UI across modules) |
| B. The admin home and the Event page, with the tenants fields and reads they need | 1, 5 | ≈ 2,900 | normal (additive tenants contract and migration; the Access section reuses #778's rules); see Q4 for the contact person |
| C. Notifications: the plain page, Advanced, the health box and the crew test | 4, comment 2 and 3 | ≈ 2,300 | normal (additive notify and admin contracts, one additive migration); see Q7 |
| **Total** | | **≈ 8,000** | **normal** |

Order: A first (B and C draw the kit's description and tooltip), then B, then C (Q1, recommendation B; B and C share no file, so they could also run side by side). C starts only after the PO accepts the sheets.

## Global constraints
- Additive only: no field, path, setting, event or topic removed or renamed. If one turns out breaking, stop for the lead.
- Migrations add only (`ADD COLUMN`, nullable or with a default), numbered after the module's last: tenants `004_event_details.sql`, notify `006_notify_health.sql`. A merged migration is never edited.
- The description rule: one or two sentences, at most 240 characters, under the title of every organiser and crew page; an error view (`plain`) has none (its view is its own title).
- Every page keeps working without a script; scripts add tap-to-show tooltips, save-on-switch and Undo.
- Every new string in each module's message files where the module has them (pizza: en and fi); Python modules are English.
- About 400 lines per source file; `topic_pages.py`, `custom_pages.py`, `pages.py` and `integrations.ts` grow and are split where named below. No new exemption.
- Nothing event-specific: demo names only, in code, tests, sheets and shots.
- Shots at 390 and 1280 px of the admin home, Notifications (plain and Advanced), Event and Integrations (issue AC 1), in `scripts/demo-screenshots-pages.mjs` (admin and notify groups) and `scripts/demo-screenshots-pizza.mjs`.
- PRs (Q1): A and B say `Part n of #782` and `Refs #782`; only the last to merge says `Closes #782`. Branches `pkg-782-<part>`, never `gh issue develop` (a developed branch closes the issue on merge).

## Design decisions
| # | Decision | Reason |
|---|---|---|
| D1 | TypeScript: `ShellOptions` becomes a union, `{ plain: true; description?: never } \| { plain?: false; description: Slot }`; Python: `shell_page(..., description_html: str = "")` raises `ValueError("page description required: <title>")` when it is empty and `plain` is false. Each module's page wrapper (admin `pages.page`, notify `web.page`, agenda's page helper, moments `page-kit.ts`, pizza `pages/kit.ts`, screen `studio/page.ts`, theming `studio.ts`, `studio-preview.ts`) takes `description` as a required parameter | "A check fails a page that has none": tsc and mypy fail a call without one, and a call that passes an empty one fails its module's page tests |
| D2 | The stack check: `scripts/demo-screenshots-shot.mjs` asserts, for every organiser shot, that `.canccu-pagehead__desc` exists, is not empty, has at most 240 characters and at most two sentence ends; a miss fails the shot with the page's path | Catches a page the unit tests never open |
| D3 | One tooltip, in both kits: `tooltip(trigger, text)` wraps a focusable trigger as `<span class="canccu-tip">` + `<span role="tooltip" id=… class="canccu-tip__text">`, and sets `aria-describedby` on the trigger; `infoTip(text)` is a 24 px `<button type="button" class="canccu-tip__info" aria-label="More about this">` with the tooltip; `iconButton({icon, label, href \| type})` is an icon-only button whose `aria-label` and tooltip are `label`; `statusChip(kind, label, tip)` a chip with its tooltip. CSS shows the text on `:hover` and `:focus-visible`; `shell.js` adds touch: a tap on an info or chip trigger toggles it (Esc and a tap elsewhere close it), a press of 500 ms on an icon-only button shows it without the click | Hover and keyboard focus on a PC, tap on a phone, readable by screen readers; an icon button still acts on a tap |
| D4 | Settings labels: the visible help line stays (sheet 4 of #732); the label's tooltip says the help line plus the default and the range ("How often a screen checks in. Default 30 s; 5 to 300 s.") | The PO asked for a tooltip on each label without losing the help under the field |
| D5 | The AI key how-to sits under the key field in `/pizza/integrations`, open while no key is set and folded ("How to get a key") once one is: create an Anthropic Console account; set up billing; create an API key; paste it here; set a monthly spend limit in the Console (suggested $5). The cost: "Claude Haiku 5.5 reads a receipt for about 0.06 cents; 50 receipts cost about 3 cents." The link: `https://console.anthropic.com/settings/keys`. A line says a Claude subscription cannot be used: the reader needs API billing | Issue item 6, copy as the issue fixes it |
| D6 | `/admin/` renders **Home** for any session with a role (the sign-in redirect for none stays): Screens (each zone from `GET /internal/screen/zones?tenant_id=` as admin's service identity, with "Open the live view" `/screen/zones/<key>`; "Screen studio" `/admin/screen/`; "Pair a screen" `/admin/screen/devices#pair=` with `screen.devices.pair`), shown to sessions with any Screen studio right; Event (name, dates, time zone, a link to Event) with `tenants.event.write` or `admin.settings.read`; then the menu's groups the session may follow, as links with their descriptions. Screen not answering within 2 s shows "Screens didn't answer. Open the Screen studio." and the page renders. A menu item `home` ("Home", icon `home`, every right of every other item) leads the first group | Item 1; #744 later replaces the page with the control center by role (Q2) |
| D7 | `/admin/event`: one section per owner, each its own form and Save, each written through its owner's API with the person's cookie and forwarded address (as `access_pages.py`): Basics (`PATCH /api/tenants/current`), Venue (`PUT …/venue-info`, `PUT …/venue-info/floor-plan`), Web addresses (read only), Access (the form `/admin/access` has today, moved here; `/admin/access` redirects to `/admin/event#access`), Modules (`PUT /api/tenants/current/flags`), Organisers, Privacy (read only), Series (read only, Q5). A refusal or 409 shows that section again with what was typed and the current values beside it; the other sections are untouched | One owner and one revision per form, so a conflict or refusal names one section and nothing saves half (the pack's E3) |
| D8 | Basics: name (1–120), short name (0–24), start and end (`datetime-local`, read and written in the time zone chosen in the same form), time zone (`<input list>` over the IANA zones of `zones.py`, the event's zone and this device's first; the server refuses a zone not in the list), description (0–500, the poster text). Language: not on the page (step 10) | Item 5's Basics list; the picker is searchable without a script |
| D9 | Tenants, additive: `short_name`, `description` and `contact_user_id` on the tenant (PATCH with `tenants.event.write`; `short_name` and `description` also in `PublicTenant`, `contact_user_id` not); `address` (0–300) in venue info; `GET /api/tenants/current/hostnames` (each `hostname`, `kind`, `status`, `primary`) and `GET /api/tenants/current/venue` (`id`, `name`, `addresses`, or 404 `not_found` without a venue), both `tenants.event.write`; `tenants.tenant.changed` lists the new fields in `changed`. Migration `004_event_details.sql` | The Event page's Basics, Venue and Web addresses have no API for these today |
| D10 | Modules: every module with its name, "Always on" for Run of show, Admin, Sign-in and Look, and for the others its `<module>.enabled` flag as a switch when `flags.yaml` declares it (today Food only), else "On"; each row links to its settings (`SETTINGS_TABS`, else `/admin/settings/<module>`) | Item 5 Modules; the other switches are #745's (Q3) |
| D11 | Privacy: in words, "Presence data is deleted 30 days after the event is archived; other personal data is made anonymous 12 months after", with the dates once archived; storage from `GET /api/tenants/current/storage` as "1.2 GB of 2 GB used", read only | Item 5 Privacy |
| D12 | The Notifications page (`/notify/admin/topics`, sheet 01): the description sentence as the issue gives it; the health box for `notify.topics.write`; one card per kind (title, the part it comes from, description, example, switch). The switch is a form that posts only `enabled` with the shown values (today's `save_config`), so no script is needed; `static/topics.js` saves on change and shows "Saved. <kind> is now off for everyone." with Undo (a post of the old value) | Item 4 plain view |
| D13 | Advanced (`/notify/admin/topics/advanced`, sheet 02) holds today's per-topic forms, grouped by owner (`PART_NAMES`-style map in notify), channels as switches "Phone notification" and "Discord message" with tooltips, an integer parameter as a stepper (unit "min" for a key ending `_minutes`; quick picks 5, 10, 15, 30 within its range), a boolean as a switch, each with its `description` as tooltip. The custom-topic editor offers the condition's field as a list (`_paths(base)` labelled by `PATH_LABELS`, e.g. `data.item.kind` → "Item kind"; others by their last part in words), the test as a list in words, and the value as a list where the field has known values (item kinds from `GET /api/agenda/kinds` with the person's cookie), else a text field | "Grouped, with choices instead of raw fields, and each field explained" |
| D14 | Examples: `examples.example_for(topic_type) -> tuple[str, str]` fills the first `event`-part trigger's (else the first trigger's) title and body with `SAMPLES` (path → demo value, e.g. `data.item.title` → "Opening ceremony", `data.item.starts_at` → 18:00 today in the event's zone, `data.order.pizzeria.name` → "Demo Pizzeria"), formatters applied by `engine`; an unknown path becomes "…". A custom topic shows its base's example | No contract change for an example (Q6) |
| D15 | Health: `GET /api/notify/health` (`notify.topics.write`) → `https` (the request reached the event over https, as Caddy forwards it), `push_key` (the VAPID key loaded), `devices` (`phones`, `pcs`: the event's subscriptions by `device`), `last_delivery` (`at`, `status` `sent` or `failed`, `error`; null when none). `notify_subscriptions.device` (`phone`, `pc` or null) is set at subscribe from the User-Agent (`Mobi`, `Android`, `iPhone`, `iPad` → phone, else pc; the User-Agent itself is never stored); `notify_deliveries.error` (≤ 200) holds a failed push's reason ("the push service refused it (403)"). Each problem's words say what to do | The comment's item 3 |
| D16 | Crew test: `POST /api/notify/test/crew` (`notify.topics.write`, at most once a minute per event, else 429 `rate_limited`) sends a personal notification "Test from <event>" (urgent, so quiet hours and the cap do not hold it; expires in 1 hour) to each user admin names as holding a role (Q7), on push only; answers `recipients`, `sent`, `failed`. It is not a topic: it is never listed, configured or followed | The comment's item 2: never to all attendees |

## Questions
Each with a recommendation; the lead answers in the PR.

- **Q1, split.** **A.** Three PRs: A, then B and C side by side; A and the first of B and C to merge say `Refs #782`, the last says `Closes #782`. **B.** Strictly A → B → C, C closes. **C.** One PR per item (six). **Recommendation: B.** Side by side saves little, and a fixed last PR keeps the closing line simple.
- **Q2, the home and #744.** **A.** #782 builds a plain Home (D6) that #744 replaces with the control center. **B.** #782 builds #744's control center now. **C.** No home: put Screens on Settings. **Recommendation: A.** The PO asked for screens on the front page now; #744 is blocked behind the step 5 gate.
- **Q3, the Event page and #745/#748.** **A.** The Event page is #748's event basics page (sheet 07) with the issue's longer list; the lead rewrites #748 to what is left (the profile's load wording, E3 is done here), and #745 keeps the switches, which appear on the Event page by themselves once declared (D10). **B.** Build #745's switches here too. **Recommendation: A.**
- **Q4, the new tenant fields.** Where do they show? **A.** Short name in the shell header at phone width when set; description on the event's front door poster; the contact person on the Event page and on the organiser refusal pages ("Ask Alex Demo for a role"), never to guests. **B.** Store and edit only. **Recommendation: A.** A field nobody reads is waste; the refusal page is where people ask who to contact. The contact is one of the people with a role in admin, stored as `contact_user_id`; a user id and a name are personal data, so the reviewer may raise B to high: say whether you accept normal.
- **Q5, join and series.** Join today has two values (`venue_or_link`, `closed`); "approval" does not exist, and the join link, series and clone endpoints are #150's, not built. **A.** Access shows the two join choices in words and the join link row only when the endpoint answers; Series shows the series when the endpoint answers, else "Not part of a series. The platform admin adds events to a series."; clone and "cloned from" come with #150 (Follow-up); approval is a Roadmap note. **B.** Build join approval, series and clone here. **Recommendation: A.**
- **Q6, example messages.** **A.** Notify fills the templates with its own sample values (D14). **B.** Each topic registration gains an `example` (additive, in agenda, pizza and moments and their contracts). **Recommendation: A.** One file, no contract change; a module's new topic shows "…" for paths notify has no sample for until one is added.
- **Q7, who is "the crew".** Notify does not know who holds a role. **A.** Admin adds `GET /internal/admin/people/with-role?tenant_id=` (user ids only, notify's service identity only, additive in admin.md); the crew test sends to those. **B.** Every member who holds any right a module checks. **Recommendation: A.** One list, admin's; it names no one, only ids. It reads who holds rights, so the reviewer may raise C to high: say whether you accept normal.
- **Q8, "Send a test to my devices" (the comment's item 1).** It belongs in "You", the hub's profile, which the App track builds. **A.** It ships with that page (its API is additive and ships with its consumer), Follow-up here. **B.** Build it here with a button on the Notifications page for the organiser's own devices. **Recommendation: A.**
- **Q9, two time zones.** The tenant's `time_zone` (what modules read) and admin's setting `timezone` (read by no module today). **A.** The Event page writes the tenant's; removing admin's setting is a breaking settings change, a Follow-up. **B.** Write both. **Recommendation: A.**

## Review focus
1. An error page (`plain`) never trips the description guard: `test_error_pages.py` in admin and notify stay green with no description passed.
2. Two organisers on the Event page: the later save of a section answers that section again with what was typed kept and the current values beside it (Task B4).
3. An owner that does not answer (tenants, screen, agenda): the page or section says so and renders; never a 500 (Tasks B2, B4, C3).
4. On a phone, a tap on an icon-only button still acts; only a long press shows its tooltip (Task A2, browser test at 390 px).
5. The crew test never reaches a guest subscription or a member without a role (Task C4).

---

## Part A — the kit rules and the AI key (items 2, 3, 6)

### Task A1: The page description is required
**Files:** Modify `packages/ui/src/shell.ts` (`ShellOptions`, `shellPage`), `packages/kit-py/src/canccu_kit/ui.py` (`shell_page`), `docs/design/README.md` (a new rule under "Decisions": the description, D1–D2) · Test `packages/ui/test/shell.test.ts`, `packages/kit-py/tests/test_ui.py`

**Interfaces:** Produces the D1 types; every later task passes `description`.

- [ ] **Step 1: Failing tests**: `shell.test.ts` `a page draws its description under the title` (`.canccu-pagehead__desc` text equals the option) and `a plain page needs none`; `test_ui.py` `test_shell_page_refuses_an_empty_description` (`pytest.raises(ValueError, match="page description required: Settings")`) and `test_plain_page_needs_no_description`.
- [ ] **Step 2: Run** `cd packages/ui && npx vitest run test/shell.test.ts` and `cd packages/kit-py && pytest tests/test_ui.py` — FAIL.
- [ ] **Step 3: Implement** D1 in both kits; add the rule to `docs/design/README.md`.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(ui): every organiser page has a description under its title`.

### Task A2: The tooltip
**Files:** Modify `packages/ui/src/components.ts`, `packages/ui/src/index.ts`, `packages/ui/ui.css` (`.canccu-tip*`, `.canccu-chip`), `packages/kit-py/src/canccu_kit/ui_views.py`, `modules/admin/src/canccu_admin/static/shell.js` · Test `packages/ui/test/components.test.ts`, `packages/ui/test/shell.browser.test.ts`, `packages/kit-py/tests/test_ui.py`

**Interfaces:** Produces `tooltip(trigger: Html, text: string): Html`, `infoTip(text: string): Html`, `iconButton(o: { icon: string; label: string; href?: string; type?: "button" | "submit" }): Html`, `statusChip(kind: "ok" | "warn" | "down" | "info", label: string, tip: string): Html`; Python `tooltip(trigger_html, text)`, `info_tip(text)`, `icon_button(icon, label, *, href=None, type="button")`, `status_chip(kind, label, tip)` in `canccu_kit.ui`.

- [ ] **Step 1: Failing tests**: `components.test.ts` `a tooltip names its text with aria-describedby` (the trigger's `aria-describedby` equals the `role="tooltip"` element's id; ids unique across two calls), `an icon button's label is its aria-label and its tooltip`; Python twins in `test_ui.py`; browser `tooltips open by hover and keyboard focus at 1280 px` (Tab to an info button → the tooltip is visible; Esc hides it) and `at 390 px a tap opens an info tooltip and a tap elsewhere closes it; a tap on an icon button acts, a 500 ms press shows its tooltip and does not act`.
- [ ] **Step 2: Run** `npx vitest run test/components.test.ts`, `npx vitest run test/shell.browser.test.ts` (in the Playwright image when the host has no Chromium), `pytest tests/test_ui.py` — FAIL.
- [ ] **Step 3: Implement** D3.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(ui): one tooltip for icon buttons, labels and status chips`.

### Task A3: Descriptions and tooltips on every existing page
**Files:** Modify every organiser and crew page's call through its module's wrapper: `modules/admin` (`pages.py`, `settings_view.py`, `settings_form.py`, `health_view.py`, `profile_pages.py`, `people_pages.py`, `access_pages.py`, `controls.py` for D4), `modules/agenda`, `modules/notify` (topic, custom and check-in admin pages), `modules/moments`, `modules/pizza` (`pages/kit.ts` and each crew page; messages en and fi), `modules/screen` (`studio/page.ts`, each tab), `modules/theming` (`studio.ts`, `studio-preview.ts`); `scripts/demo-screenshots-shot.mjs` (D2) · Test each module's page tests (`modules/admin/tests/test_pages.py`, `test_settings_controls.py`; `modules/notify/tests/test_pages.py`; agenda's, moments', pizza's, screen's, theming's page tests), `scripts/demo-screenshots-shot.test.mjs` (new, for the D2 check on a fixture page)

- [ ] **Step 1: Failing tests**: in each module's page test file, `every page has a description` — a table of the module's organiser page paths, each GET as a session with every right, asserting one non-empty `.canccu-pagehead__desc` (≤ 240 characters); in admin `test_settings_controls.py` `every setting label has a tooltip with its help, default and range`; per module `every icon-only button has a label and a tooltip` (no `<button>`/`<a class="canccu-button…">` whose text is only an icon lacks `aria-label` and `aria-describedby`); `every status chip has a tooltip` where the module draws chips (health badges, device states, order states); `demo-screenshots-shot.test.mjs` `a page without a description fails the shot with its path`.
- [ ] **Step 2: Run** each module's page tests — FAIL (and tsc/mypy already fail from A1 until each call passes a description).
- [ ] **Step 3: Implement**: write each page's one or two sentences (what the page is for, in the reader's words); swap icon-only buttons to `iconButton`/`icon_button`, chips to `statusChip`/`status_chip`, settings labels to D4.
- [ ] **Step 4: Run** each module's checks (README commands) — PASS. **Step 5: Commit** per module, e.g. `feat(agenda): page descriptions and tooltips`.

### Task A4: The AI key how-to
**Files:** Modify `modules/pizza/src/pages/integrations.ts` (split the key card out as `pages/integrations-key.ts` to stay under 400 lines), `modules/pizza/src/pages/messages.ts`, `messages-fi.ts`, `static/pizza.css` · Test `modules/pizza/test/pages-integrations.test.ts`

- [ ] **Step 1: Failing tests**: `with no key the how-to is open and lists the five steps in order`; `with a key set the how-to is folded`; `the how-to names Claude Haiku 5.5, about 0.06 cents a receipt, about 3 cents for 50, and a $5 monthly limit`; `it links to the Console's API keys page` (`href="https://console.anthropic.com/settings/keys"`, `rel="noopener"`, `target="_blank"`); `the Finnish page has the same steps`.
- [ ] **Step 2: Run** `cd modules/pizza && npx vitest run test/pages-integrations.test.ts` — FAIL.
- [ ] **Step 3: Implement** D5.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(pizza): how to get the AI reader's key, step by step`.

### Task A5: Shots and PR
- [ ] Shots `pizza-integrations` (no key; with a key) at 390 and 1280 px; a tooltip-open shot of the admin settings form at 390 px.
- [ ] Checks of every module touched (README commands), the repo checks (`scripts/check-naming`, `scripts/check-file-size`, `scripts/check-contracts`, `scripts/check-event-names`, `scripts/a11y-check`). PR `Part 1 of #782`, `Refs #782`.

---

## Part B — the admin home and the Event page (items 1, 5)

### Task B1: Tenants fields and reads (D9)
**Files:** Create `modules/tenants/migrations/004_event_details.sql`; modify `modules/tenants/src/canccu_tenants/current.py` (PATCH fields, the two reads), `model.py`, `venue_info.py` (`address`), `hostnames.py`, `venues.py`; `contracts/tenants.md`, `contracts/tenants/event.openapi.yaml` · Test `modules/tenants/tests/test_current.py`, `test_venue_info.py` (new), `test_leak.py`

**Interfaces:** Produces `GET /api/tenants/current/hostnames` → `{"hostnames": [{"hostname", "kind", "status", "primary"}]}`, `GET /api/tenants/current/venue` → `{"id", "name", "addresses"}`; PATCH accepts `short_name`, `description`, `contact_user_id`; venue info `address`.

- [ ] **Step 1: Failing tests**: `patch sets short_name, description and contact_user_id and emits changed with them`; `short_name over 24 or description over 500 is 400`; `a guest sees short_name and description, not contact_user_id`; `hostnames list marks the primary and needs tenants.event.write`; `venue read answers addresses, 404 without a venue`; `venue info keeps an address of up to 300 characters`; leak tests: another event's hostnames and venue are never answered.
- [ ] **Step 2: Run** `cd modules/tenants && pytest tests/test_current.py tests/test_venue_info.py tests/test_leak.py` (with the `_test` Postgres) — FAIL.
- [ ] **Step 3: Implement** D9; the contract text and OpenAPI in the same commit.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(tenants): short name, description, contact and the venue's and hostnames' reads for the Event page`.

### Task B2: The admin home (D6)
**Files:** Create `modules/admin/src/canccu_admin/home_page.py`; modify `app.py` (`index`), `packages/ui/src/menu.json` (`home`), `modules/admin/tests/test_role_rights.py` if it lists menu items · Test `modules/admin/tests/test_home.py`

**Interfaces:** Produces `async def screen_zones(request) -> list[tuple[str, str]] | None` (key, name; None when Screen does not answer in 2 s).

- [ ] **Step 1: Failing tests**: `home lists each zone with Open the live view to /screen/zones/<key>`; `home links the Screen studio, and Pair a screen only with screen.devices.pair`; `no Screens section without a Screen studio right`; `screens not answering: the page renders and says so`; `home shows the event's name, dates and zone with a link to Event`; `a session without a role still goes to sign-in`; `home has its description`.
- [ ] **Step 2: Run** `cd modules/admin && pytest tests/test_home.py` — FAIL.
- [ ] **Step 3: Implement** D6 (a fake Screen in `conftest.py` as the fake tenants registry is).
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(admin): a home with the event's screens`.

### Task B3: The Event page, reading (D7, D8, D10, D11)
**Files:** Create `modules/admin/src/canccu_admin/event_pages.py` (routes, reads), `event_views.py` (sections), `event_owners.py` (the owner calls, with `access_pages.py`'s cookie and address forwarding moved here and shared) · Test `modules/admin/tests/test_event_page.py`

**Interfaces:** Produces `class Owners` with `tenant()`, `venue_info()`, `venue()`, `hostnames()`, `flags()`, `storage()`, `series()` (each `dict | None`, None when the owner does not answer or the endpoint is missing) and `patch_tenant(body)`, `put_venue_info(body)`, `put_floor_plan(file)`, `put_flags(body)` (each returns the owner's answer or raises `KitError` with its status and code).

- [ ] **Step 1: Failing tests**: one per section: `basics show name, short name, start and end in the event's zone, the zone and the description`; `venue shows its name read only, address, Wi-Fi, house rules, floor plan and network addresses`; `web addresses list the primary first and say the platform admin changes them`; `access shows admin access, joining and info pages in words`; `modules show Always on for Run of show, Admin, Sign-in and Look, Food's switch, and links to settings`; `organisers link to People and show the contact`; `privacy says 30 days and 12 months and the storage use`; `series says Not part of a series when the endpoint is missing`; `an owner that does not answer leaves its section with a notice`; `without tenants.event.write the basics are read only`.
- [ ] **Step 2: Run** `pytest tests/test_event_page.py` — FAIL.
- [ ] **Step 3: Implement**; the time zone list from `zones.py`.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(admin): the Event page shows every base setting of the event`.

### Task B4: The Event page, saving
**Files:** Modify `event_pages.py`, `access_pages.py` (`/admin/access` → 303 `/admin/event#access`), `static/` (no new script: plain forms) · Test `modules/admin/tests/test_event_save.py`, `test_access_pages.py`

- [ ] **Step 1: Failing tests** (issue AC 2, "the Event page saves each field"): one test per field: name, short name, start, end, time zone, description (`PATCH` body has exactly that field and the `revision`); address, Wi-Fi add/edit/remove, house rules, floor plan (`PUT` venue info / floor plan); admin access, joining, info pages (`PATCH`, refused read-only without the role); a module switch (`PUT flags` with `flags_version`); contact person. Then `start and end are read in the zone chosen in the same form`; `a zone not in the list is refused with the section's words`; `a stale revision answers the section with what was typed and the current values` (Review focus 2); `a refusal shows the owner's message in the section`; `/admin/access redirects to the Access section`.
- [ ] **Step 2: Run** `pytest tests/test_event_save.py tests/test_access_pages.py` — FAIL.
- [ ] **Step 3: Implement** D7's writes.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(admin): the Event page saves each part through its owner`.

### Task B5: Shots and PR
- [ ] Shots `admin-home`, `admin-event` (top and each section) at 390 and 1280 px; `scripts/demo-screenshots-groups.mjs` needs no change (`/admin/` is mapped).
- [ ] Checks: admin and tenants README commands, `packages/ui` (menu), the repo checks. PR `Part 2 of #782`, `Refs #782`; `Follow-up:` lines for Q5 and Q9; `Roadmap note:` for join approval.

---

## Part C — Notifications (item 4; the comment's items 2 and 3)

Starts after the PO accepts sheets 01 and 02; any change the PO asks for is drawn into them first.

### Task C1: Examples (D14)
**Files:** Create `modules/notify/src/canccu_notify/examples.py` · Test `modules/notify/tests/test_examples.py`

**Interfaces:** Produces `example_for(topic_type: dict[str, Any], time_zone: str, today: date) -> tuple[str, str]`.

- [ ] **Step 1: Failing tests**: `schedule's example is "Opening ceremony at 18:00" / "Starts in 10 min"`; `food's is "Pizza order open: Demo Pizzeria" / "Order 3 closes at 19:30"`; `announcements' comes from its sample title and body`; `an unknown path shows …`; `a custom topic shows its base's example`.
- [ ] **Step 2: Run** `cd modules/notify && pytest tests/test_examples.py` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS. **Step 5: Commit** `feat(notify): an example message for each kind of notification`.

### Task C2: The plain page and Advanced (D12, D13)
**Files:** Modify `topic_pages.py` (the plain page), create `topic_advanced.py` (Advanced, moved from `topic_pages.py`'s forms), modify `custom_pages.py` (choices), `web.py` (`CHANNEL_LABELS` → "Phone notification", "Discord message"; `OWNER_NAMES`), create `static/topics.js` · Test `modules/notify/tests/test_pages.py`, `test_custom.py`; the script's save-on-switch and Undo in `scripts/demo-stack-test` (notify has no JS test runner)

- [ ] **Step 1: Failing tests**: `the page opens with the sentence "Choose what attendees can be notified about. Each person picks which of these they want in their hub."`; `each kind shows its example and a switch`; `switching posts only enabled and keeps people's choices`; `Advanced groups kinds by their part`; `channels read Phone notification and Discord message, each with a tooltip`; `lead time is a stepper within 1–1440 with quick picks 5, 10, 15, 30`; `the custom editor offers fields as a list, tests in words, and item kinds as values`; `a custom topic saved from the lists equals the old form's body` (custom.validate stays the only rule); `agenda not answering leaves the value as text`; every control has a tooltip; both pages have descriptions.
- [ ] **Step 2: Run** `pytest tests/test_pages.py tests/test_custom.py` — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS. **Step 5: Commit** `feat(notify): Notifications in plain words, with an advanced view that explains itself`.

### Task C3: The health box (D15)
**Files:** Create `modules/notify/migrations/006_notify_health.sql`, `src/canccu_notify/health_box.py`; modify `subscriptions.py` (`device`), `delivery.py`/`webpush.py` (`error`), `app.py` (route), `contracts/notify.md`, `contracts/notify.openapi.yaml` · Test `modules/notify/tests/test_health_box.py` (new), `test_subscriptions.py`, `test_delivery.py`

- [ ] **Step 1: Failing tests**: `a phone's subscription is counted as a phone, a desktop's as a PC, and no user agent is stored`; `a refused push keeps its reason`; `health says https missing on plain http, with what to do`; `push key OK`; `devices 3 phones, 1 PC`; `last delivery OK or its error`; `health needs notify.topics.write`; `another event's subscriptions are never counted` (leak).
- [ ] **Step 2: Run** `pytest tests/test_health_box.py tests/test_subscriptions.py tests/test_delivery.py` (with the `_test` Postgres) — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS. **Step 5: Commit** `feat(notify): a health box that says whether attendees can get notifications`.

### Task C4: The crew test (D16, Q7)
**Files:** Modify `modules/admin/src/canccu_admin/app.py` (the internal people read), `contracts/admin.md`; create `modules/notify/src/canccu_notify/crew_test.py`; modify `contracts/notify.md`, the OpenAPI files · Test `modules/admin/tests/test_internal_people.py`, `modules/notify/tests/test_crew_test.py`

- [ ] **Step 1: Failing tests**: admin `the role list answers user ids of the event's role holders, to notify only` (403 `service_forbidden` for another module); notify `the test goes to each role holder's push subscriptions`; `never to a guest subscription or a member without a role` (Review focus 5); `a second test within a minute is 429`; `the answer counts sent and failed`; `the test is not listed among the kinds`.
- [ ] **Step 2: Run** both — FAIL. **Step 3: Implement.** **Step 4: Run** — PASS. **Step 5: Commit** `feat(notify): send a test to the crew`.

### Task C5: Shots and PR
- [ ] Shots `notify-topics`, `notify-topics-advanced` (with the demo's custom kind) and the health box with https missing (the CI stack is plain http) at 390 and 1280 px, next to sheets 01 and 02 in the PR body.
- [ ] Checks: notify and admin README commands, the repo checks. PR `Part 3 of #782`, `Closes #782` (Q1 B); `Follow-up:` "Send a test to my devices" with the hub's You page (Q8).
