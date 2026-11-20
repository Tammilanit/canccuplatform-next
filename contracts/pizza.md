# Pizza contract

The event's group food orders, as the legacy ran them and fixed at their edges (the [step 5 plan](../docs/briefs/step-5-pizza.md#plan), direction C): someone opens an order at a pizzeria and holds it, people add their pizzas, the holder closes it, calls it in, marks it arrived and hands it out. The platform keeps what each order cost and each person's share and exports them for the payment system; no money moves through it. The `pizza` module owns it; what people see says "Food" (P7).

**Machine-readable API: [pizza.openapi.yaml](pizza.openapi.yaml)** (OpenAPI 3.1), with its paths in parts: [pizza/orders](pizza/orders.openapi.yaml) and [pizza/menus](pizza/menus.openapi.yaml). It is the source for paths, fields and status codes; this file explains them and adds the rules and events. Conventions (field names, times, error body): [README.md](README.md#conventions).

## Tenancy
- Orders, pizzerias and menus belong to one event, one tenant ([0013](../docs/decisions/0013-multi-tenant-core.md)), taken from the request's hostname. Every row carries `tenant_id` under row-level security; ids are random strings (`po_…`, `pi_…`, `pz_…`, `mi_…`), never numbers to count through (legacy problem 9).
- Events go to `t:<tenant>:events:pizza` with the envelope's `tenant` field. Two events at one venue each have their own pizzerias, orders and numbers (O9).
- An archived event is read-only: writes get 409 `event_archived`; the privacy delete still works.

## Who sees what
D9 and U15. Members only order: a guest, or a signed-in user who is not a member of the event (403 `not_a_member` on a write, E15), sees what the screens show. Sign-in is the central sign-in (`canccu_session`); no token is ever in a URL (0010).

| Caller | Sees of an order |
|---|---|
| Guest, or signed in but not a member | State, pizzeria, times, counts, `pickup`; no names and no pizzas. Only when the event's info-page mode lets a guest in (`public`; `venue_only` from the venue); otherwise 403 `info_pages_closed` ([tenants.md](tenants.md#info-page-mode)) |
| Member | Also the holder's name, the note, their own pizzas in full (`mine`) with their amount (`my_amount_cents`), and everyone's pizzas without names or notes (`lines`: "2 × #12 Kebab") |
| The order's holder, the crew (`pizza.order.manage`) | Everything: each pizza with its person, note, comment, price and hand-out tick; the pizzeria's phone; when the nudge went (`nudged_at`); the payer, the total, the split and settle to |

The holder is event-wide `public` in events, as the catalog's audience says (L8); the screens decide whether to show it.

## Rights
D5 and P5: every right of step 5 is defined and tested here; #118, #119 and the money issue use these and add none.

| Right | Allows |
|---|---|
| (the order's holder) | Everything on their own order: edit, close, reopen, call in, arrive, hand out, done, undo, cancel before call-in, release; its summary and history; its money until the event day turns |
| `pizza.order.open` | Start an order when the event's `open_by` is `crew` (U2) |
| `pizza.order.manage` | Step in on any order: take over, release, cancel (also once called in), undo, edit pizzas after close, mark arrived; its money at any time |
| `pizza.menu.write` | Pizzerias and menus: add, edit, hide, replace a menu, import and download the menu CSV, read a menu photo (the money issue) |
| `pizza.record.read` | The daily record, each person's amount, receipts, and the export |
| `admin.settings.write` | The food settings below, through admin's settings API |

- A right counts only where admin is reachable: while the event's `admin_access` is `restricted`, a request away from the venue and Tailscale that needs a right gets 403 `admin_access_restricted`, and reads show what a member sees ([tenants.md](tenants.md#admin-access)).
- **Crew overrides are audited** with before and after (D16): an action a caller takes through `pizza.order.manage` on an order they do not hold (take over, forced release, cancel, undo, call in, arrive, edits), and every change of someone else's pizza.
- The holder of an order who also holds a right acts as the holder, so their own steps are not overrides.

## Orders
An **Order** (the `Order` schema; the catalog's Order is its event-wide part, see Events):

| Field | Meaning |
|---|---|
| `id`, `seq`, `day` | The order; its number on its **event day**, which turns at 06:00 in the event's time zone (D4, E8), so an order at 01:00 belongs to the night it was in |
| `state` | `open` (pizzas can be added), `closed` (no more pizzas; the holder calls), `placed` (called in), `arrived` (it's here), `done`, `cancelled` |
| `pizzeria` | `id`, `name` as ordered, `service` (`delivery` or `takeaway`, D6); for the holder and the crew also `phone` and `website` |
| `closes_at` | The close time: a promise to the people in it (U3). `target_at` is the same time under the legacy's name |
| `estimate_at`, `pickup` | The pizzeria's estimate at call-in (U8), null when not given; where to collect it (U4) |
| `holder` | `user_id`, `name`, or null while nobody holds it; `you_hold` |
| `opened_at`, `closed_at`, `placed_at`, `arrived_at`, `done_at`, `done_reason` | When it reached each state; `done_reason` is `handed_out`, `holder` or `timer` |
| `cancelled_at`, `cancel_reason` | When, and the words of whoever cancelled it ("the pizzeria is closed today") |
| `pizza_count`, `people_count`, `revision` | Counts, and a number that grows with every change, a pizza's too |
| `stale` | Open or closed, from an earlier event day (E10) |

**Limits** (D1, O5, E14, U18): one order open (open or closed) per pizzeria, several pizzerias at once; at most `max_open_orders` open in the event; a person holds at most one open order; a person has at most `max_items_per_person` pizzas in one order. Unique indexes back the first and the third.

### The lifecycle
Every step is one conditional update of the order in a transaction, with its history line and its event stored in the same transaction and sent after it commits (E1, E12). Every write carries an `Idempotency-Key` header (8 to 64 of `A–Z a–z 0–9 - _`): the same key from the same person within 24 hours answers what the first answered and does nothing again (E2). A step already taken (closing a closed order, calling in a called-in one, releasing an order nobody holds) answers the order as it is, 200, and sends no second event.

| Step | `POST /api/pizza/orders/{order_id}/…` | From → to | Who | Event |
|---|---|---|---|---|
| Open | `POST /api/pizza/orders` | → `open`, the opener holds it | A member (`pizza.order.open` when `open_by` is `crew`) | `pizza.order.opened` |
| Claim | `claim` | holder none → caller, while open or closed | A member | `pizza.order.claimed` |
| Take over | `take-over` | holder → caller, while open or closed | `pizza.order.manage` | `pizza.order.claimed` |
| Release | `release` | holder → none, while open or closed | Holder (`released`), crew (`forced`) | `pizza.order.released` |
| Close | `close` | `open` → `closed` | Holder, crew | `pizza.order.closed` |
| Reopen | `reopen` | `closed` → `open` | Holder, crew | `pizza.order.reopened` |
| Call in | `place` | `open`, `closed` → `placed` | Holder, crew | `pizza.order.closed` (when it was open), `pizza.order.placed` |
| It's here | `arrive` | `placed` → `arrived` | Holder, crew | `pizza.order.arrived` |
| Everyone got theirs | `hand-out` | `arrived` → `done` (`handed_out`), every pizza ticked | Holder, crew | `pizza.order.done` |
| Nudge | `nudge` | while `arrived`, once per order; sets `nudged_at` | Holder, crew | `pizza.reminder.triggered` (`not_collected`) to each person not collected yet |
| Done | `done` | `arrived` → `done` (`holder`) | Holder, crew | `pizza.order.done` |
| Undo | `undo` | `arrived` → `placed`; `placed` → `closed` (clears the call-in, its estimate and payer; keeps the total) | Holder, crew | `pizza.order.reverted` |
| Cancel | `cancel` | `open`, `closed` → `cancelled`; the crew also from `placed` and `arrived` | Holder, crew; any member for a stale order (E10) | `pizza.order.cancelled` |

- **Open** takes `pizzeria_id` (a visible pizzeria), `closes_at` (in the future) and an optional `note`. 403 `ordering_closed` while the event's `ordering_open` is off (O3). 409 `another_open` with `open` (the order already open at that pizzeria), `too_many_open`, `already_holding`.
- **Claim** of an order someone holds: 409 `claimed` with `holder` (the name) and `since` (E1). **Call in** takes `estimate_minutes` (0 to 240) or `estimate_at`, `at` (when it was called in, default now) and `payer_user_id`; the payer is the holder by default, or whoever calls it in when nobody holds it, and is always set (U13). **It's here** takes `pickup`. **Cancel** takes `reason`; an order from an earlier event day is cancelled as `stale`. **Undo** of a call-in while another order of that pizzeria is open, or while its holder holds another: 409 `another_open` or `already_holding`.
- **Edit** (`PATCH /api/pizza/orders/{order_id}`; holder, crew): `closes_at` and `pizzeria_id` while not called in (the pizzeria only while the order has no pizzas: 409 `has_pizzas`, E6), `note`, and `estimate_at`, `placed_at` and `pickup` once called in. Emits `pizza.order.changed`.
- **Refusals by state** (409): `placed` (already called in), `not_placed`, `not_arrived`, `closed` (no more pizzas; with `open_orders`, the event's other open orders, E3), `cancelled` (never reopens), `done`. A caller who may not: 403 `not_holder` (an order step), `not_owner` (someone else's pizza), `money_locked` (the holder after the event day turned), `missing_right`.
- **No delete** (D17): cancel is the end of an order; personal data goes by retention.
- **The module's own steps**, actor null, taken by [the scheduler](#the-scheduler): auto-close at the close time (an empty order is cancelled instead, E9), auto-release (`timeout`; the record flags the order), done by the timer (`timer`, straight from `placed` without "it's here"), and cancelling a forgotten order never called in. Archiving the event cancels its open and closed orders (E11).
- **Summary** `GET …/summary` (holder, crew): the legacy summary for the call, grouped lines and "copy as text", never comments. **History** `GET …/history` (holder, crew): the order's own log (D16).

### The scheduler
The module's own clock (O2; the plan's [Forgotten orders](../docs/briefs/step-5-pizza.md#forgotten-orders)), inside every pizza container. Every 30 s it writes each live order's due steps as rows in Postgres from the order and the event's [settings](#settings) (a changed setting moves a step not taken yet), and takes the due ones, each with `FOR UPDATE SKIP LOCKED`, in the transaction that changes the order, stores its events in the outbox and marks the row sent. So a restart loses nothing, two replicas never take one step twice, and each step happens at most once for its anchor: a reopen with a new close time, or a later claim, arms it again. Times are the settings', shown here with their defaults.

| The order is | The scheduler |
|---|---|
| open | `pizza.order.closing` 10 min before `closes_at` (`last_call_minutes`; not for an order closed earlier); at `closes_at` it closes, or is cancelled when empty (E9), while `auto_close` is on. With it off: the holder is reminded 30 min past the close time (`remind_holder_minutes`), the holder and the crew at 60 (`remind_crew_minutes`) |
| closed, not called in | The holder at +30, the holder and the crew at +60, counted from the close or a later claim; the holder released at +120 (`release_after_minutes`; `reason` `timeout`) and the crew told (`released`) |
| called in, not arrived | "Has it arrived?" to the holder 30 min past `estimate_at` (`arrival_check_minutes`), or 90 min after the call-in without one (`arrival_check_no_estimate_minutes`); to the crew as much later as the crew's reminder comes after the holder's |
| arrived | `done` (`timer`) 120 min after arrival (`done_after_arrival_minutes`, O7) |
| not done when its event day turns at 06:00 | With `close_forgotten` on: never called in is cancelled (actor null); called in goes straight to `done` with `timer`, so no "it's here" is sent |

- **Reminders** are one `pizza.reminder.triggered` per person who hears it, with their `user_id` and `role` (D12). A reminder to the holder goes to the crew while nobody holds the order. A reminder more than 30 min late is skipped, and of two reminders of one kind due at once only the later is sent (the legacy rule), so an outage never sends stale ones. An archived event's orders are left alone.
- **The crew** is the members who hold `pizza.order.manage`. No module answers who holds a right, so pizza counts as crew each member whose session showed that right when they last used pizza (`pizza_crew`), and forgets them when a session shows it no longer, when they leave the event or are forgotten.
- **Health** (O8): `/health` has the check `scheduler`: `ok` with `lag N s` (how late the oldest due step was when the last tick found it), `degraded` past 120 s or when no tick ran for 90 s. It never makes the module `down`.

### Reading
- `GET /api/pizza/orders`: the orders not over yet and today's; `?day=YYYY-MM-DD` for one event day. `GET /api/pizza/orders/{order_id}`. Each as the caller may see it.
- `GET /api/pizza/me/orders` (signed in): this event's orders the caller has pizzas in, holds or opened, newest first, with their own pizzas, status and amount (D14). `me/summary` comes when the App track takes its D18.

## Pizzas
A pizza (`Item`) is one of: `menu` (`menu_item_id`, an item of the order's pizzeria's live menu), `custom` (the own pizza: the pizzeria's base and 1 to 4 of its toppings by name, `toppings`), or `text` ("Other", 1 to 80 characters). Each has an optional `note` for the pizzeria (120) and `comment` for the holder (120; "one is for a friend", U16).

- **Snapshot** (D15): a row keeps its label, number, description and price as ordered. A menu change never rewrites it; an open order offers the new menu for new picks (E7). The price of an own pizza is its base's plus each topping's; "Other" has none.
- `POST /api/pizza/orders/{order_id}/items` (a member, while open): 201. 409 `item_limit` past the per-person cap, `closed` once closed. `PUT /api/pizza/items/{item_id}` and `DELETE` (204): the owner while open; the holder and the crew until done, which is audited and tells the owner (`pizza.item.changed`, `pizza.item.removed`; U14).
- `POST /api/pizza/items/{item_id}/hand-out` with `handed_out` (true or false), once arrived: the holder, the crew, or the owner for their own (U9). The last tick makes the order done (`handed_out`).

## Money
In the API only, never on the bus: the plan's [Money](../docs/briefs/step-5-pizza.md#money-what-the-platform-keeps).

- **Per order:** the payer (who paid the pizzeria, always set at call-in), `total_cents` (what the pizzeria was paid, 0 to 500000, once called in; 409 `not_placed` before), `split` (`exact`, `even`, or null for the default) and `settle_to` (`organiser`, or `payer` when the event's `settle_to_payer` is on, else 409 `settle_to_payer_off`; M1). **Per pizza:** `price_cents` (0 to 99999, or null), from the menu or set by hand.
- **Each person's amount:** exact when the split is `exact`: their prices plus their share of the extras (the total less all prices: fees add, discounts take away), split per pizza. Even: the total over the order's pizzas, times theirs. The default is exact when every pizza has a price, else even; `exact` needs every pizza priced (409 `prices_missing`); an exact split that would give anyone a negative amount stays even. Amounts are rounded to the cent by the largest remainder, so they add up to the total; ties go in the order of the person's name. Before the total is in, priced pizzas give an estimate (`estimated`).
- `GET /api/pizza/orders/{order_id}/money` (holder, crew, `pizza.record.read`): the money and each person's amount. `PATCH …/money` (`total_cents`, `split`, `settle_to`, `payer_user_id`, someone in the order or its holder) and `PUT /api/pizza/items/{item_id}/price`: the holder until the order's event day turns at 06:00 (then 403 `money_locked`), the crew at any time; not on a cancelled order. A member sees only their own amount.
- **A change once the order is closed** is audited (`pizza.order.money_changed`, before and after), and the people whose amount it changed get `pizza.amount.changed` (U14).

## Pizzerias and menus
Per event (D11, TG12), loaded from the event profile and edited on the crew's pages.

- A **pizzeria**: `name` (80, unique in the event in any case: 409 `pizzeria_exists`), `phone` (40), `website` (an `http` or `https` URL), `service` (`delivery` or `takeaway`). `GET /api/pizza/pizzerias` and `/{pizzeria_id}` with its menu (guests per the info-page mode; the phone for the crew and the menu writers). `POST`, `PATCH` (`pizza.menu.write`); `PATCH` with `hidden: true` hides one, never deletes it (D17), so its orders keep it. Audited.
- A **menu**: `items` (`number`, up to 8 characters and unique in the pizzeria; `name`, 80; `description`, 300, which the menu filter searches; `price` in cents), an optional `base` (the own pizza) and `toppings`, each with a name, description and price. `PUT /api/pizza/pizzerias/{pizzeria_id}/menu` replaces it: items matched by number are updated (a hidden one comes back), new ones added, items missing hidden, never deleted (the legacy rule); the base and toppings are replaced as a set (a topping named twice is kept once). `?hidden=true` shows hidden items to the menu writers. Audited.
- **The profile's `pizza` section** carries the same fields ([profile.md](profile.md#the-pizza-section)), so a profile and a menu CSV hold the same menu. **Clone** with an event copies the source's pizzerias and menus, hidden ones left behind, into an event that has none; never its orders.

### The menu CSV
A CSV that anyone can produce: typed by hand, exported from a spreadsheet, or made by any AI tool from a photo or a web page, given this section as the instructions (D10).

| Column | Required | Meaning |
|---|---|---|
| `pizzeria` | yes | The pizzeria's name. Rows with the same name (any case) are one pizzeria; an existing pizzeria of the event is matched by name, otherwise one is added |
| `phone` | no | The pizzeria's phone number |
| `website` | no | The pizzeria's web page, an `http` or `https` URL |
| `service` | no | `delivery` (when empty) or `takeaway` |
| `kind` | no | `item` (when empty), `base` (the own pizza's base) or `topping` (an own-pizza topping) |
| `number` | for items | The menu number, up to 8 characters (`12`, `12a`); unique within the pizzeria; empty for a base or a topping |
| `name` | yes | The item's, base's or topping's name, up to 80 characters |
| `description` | no | The ingredients or a short description, up to 300 characters |
| `price` | no | The price in euros: a dot decimal with at most two decimals, no sign, 0 to 999.99. For a base, the own pizza's price; for a topping, its extra price |

- **Rules.** `phone`, `website` and `service` may be given on any of a pizzeria's rows; given on several, they must agree. A pizzeria has at most one `base`; without one it offers no own pizza. A topping's name is given once per pizzeria.
- **Format:** UTF-8 (a BOM is ignored), comma separator, a header row with these names in any order, LF or CRLF, RFC 4180 quoting; an unknown column is ignored with a warning; at most 1,000 rows and 512 KiB.
- **Errors and warnings:** each names its `row` (the header is row 1) and `column`. An error stops the whole import; a warning (an item without a price, an ignored column) does not.
- **Importing** needs `pizza.menu.write`, with the file as the `text/csv` body. `POST /api/pizza/menu/import/preview` changes nothing and answers, per pizzeria, whether it is `new` or `matched` and how many items would be added, updated and hidden, with the errors and warnings. `POST /api/pizza/menu/import` applies it, or answers 400 `menu_csv_invalid` with `errors` and changes nothing: for each pizzeria in the file its menu is replaced as above, and phone, web page and service are set where the file gives them; pizzerias not in the file are left alone. One audit entry per import, with its counts.
- **Downloading:** `GET /api/pizza/menu.csv` (`?pizzeria_id=` for one), `pizza.menu.write`: the same columns, pizzerias by name, without hidden items; phone, web page and service on each pizzeria's first row.

**Example** (placeholders only):
```
pizzeria,phone,website,service,kind,number,name,description,price
Demo Trattoria,+000 000 0000,https://trattoria.example,delivery,item,4,Margherita,"tomato, mozzarella",8.00
Demo Trattoria,,,,item,7,Funghi,"mushroom, mozzarella",8.50
Demo Trattoria,,,,item,12,Kebab,"kebab, onion, chili",9.50
Demo Trattoria,,,,base,,Own pizza,"tomato, mozzarella",7.00
Demo Trattoria,,,,topping,,Olives,,1.00
Demo Corner Grill,+000 000 0001,,takeaway,item,1,Demo Burger,"bun, patty, salad",
```

## The daily record
`GET /api/pizza/record` (`?day=` for one event day; `pizza.record.read`; mockup 12): one block per event day with its label, its order count and the total of its called-in orders (`incomplete` while one has no total), each order with its people, their pizzas, comments and amounts. `flags` name what the treasurer acts on: a called-in order without a total, an order released automatically (check the payer), and an order cancelled after call-in (remove it in the payment system, which a later export no longer carries).

## The export CSV
The file the payment system imports into one cost pool and splits ([#633](https://github.com/Tammilanit/canccuplatform-next/issues/633), M4). Settling happens there; the file is the only thing that passes between the two systems. `GET /api/pizza/export.csv` (`?day=` for one event day, else the whole event; `pizza.record.read`) answers the file (`text/csv; charset=utf-8`, named `pizza-<event>-<day or all>.csv`) and names the orders left out in its header `canccu-left-out` (their `order_id`s, comma-separated); `GET /api/pizza/export` answers the same as JSON: `file_name`, `csv` and `left_out` (`order_id`, `pizzeria`, `reason`).

| Column | Required | What the platform writes |
|---|---|---|
| `order_id` | yes | The event day and the order's number that day, `2026-11-21-3`. Never changes; unique in the event |
| `ordered_at` | yes | When the order was called in, ISO 8601 with the event's offset |
| `pizzeria` | yes | The pizzeria's name as ordered |
| `payer_nick` | yes | The payer's name |
| `order_total` | yes | The order's total, two decimals |
| `settle_to` | no | `organiser` or `payer`, always written |
| `nick` | yes | The person's name; the payment system matches on it |
| `discord_id` | no | The person's Discord id, empty when unknown (E13) |
| `units` | yes | How many items the person has in the order |
| `amount` | no | The person's exact amount when the order's split is `exact`; empty when it is `even`. An order has it on every row or on none |

- **Format:** comma separator, dot decimals, euros with no sign, UTF-8 without a BOM, a header row, LF line ends, fields with a comma, quote or line break quoted (RFC 4180). Values are written as they are, with no spreadsheet escaping, since the payment system matches names exactly.
- **Rows:** one per person per order, sorted by order (day, then number) and then by nick (by code point). `order_id`, `ordered_at`, `pizzeria`, `payer_nick`, `order_total` and `settle_to` repeat on every row of the order.
- **Which orders:** called in, arrived or done, with a total, on the chosen day or in the whole event. Open, closed and cancelled orders are not in it; a called-in order without a total is left out and named.
- **Changes after export** are allowed and audited (Money, Pizzas); there is no "exported" flag: every export holds the current state, and the payment system replaces the rows of an order it already has.

**Example** (placeholders only):
```
order_id,ordered_at,pizzeria,payer_nick,order_total,settle_to,nick,discord_id,units,amount
2026-11-21-1,2026-11-21T17:20:00+02:00,Demo Pizzeria,Player Two,38.00,organiser,Demo Player,,2,
2026-11-21-1,2026-11-21T17:20:00+02:00,Demo Pizzeria,Player Two,38.00,organiser,Player Five,,2,
2026-11-21-1,2026-11-21T17:20:00+02:00,Demo Pizzeria,Player Two,38.00,organiser,Player Six,,1,
2026-11-21-1,2026-11-21T17:20:00+02:00,Demo Pizzeria,Player Two,38.00,organiser,Player Two,,1,
2026-11-21-3,2026-11-21T18:31:00+02:00,Demo Trattoria,Player Three,54.50,payer,Demo Player,,2,20.00
2026-11-21-3,2026-11-21T18:31:00+02:00,Demo Trattoria,Player Three,54.50,payer,Player Four,,2,17.00
2026-11-21-3,2026-11-21T18:31:00+02:00,Demo Trattoria,Player Three,54.50,payer,Player Three,,1,9.00
2026-11-21-3,2026-11-21T18:31:00+02:00,Demo Trattoria,Player Three,54.50,payer,Player Two,,1,8.50
```

## Settings
Saved through admin's settings API with `admin.settings.write` ([admin.md](admin.md#settings)); the module follows `admin.settings.changed`.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `ordering_open` | boolean | `true` | Off: no new orders (O3) |
| `open_by` | `anyone` or `crew` | `anyone` | `crew`: only `pizza.order.open` starts orders (U2) |
| `max_open_orders` | integer 1–20 | 3 | Orders open at once in the event (O5) |
| `max_items_per_person` | integer 1–20 | 5 | One person's pizzas in one order (U18) |
| `settle_to_payer` | boolean | `false` | An order may settle to its payer instead of the organiser (M1) |
| `last_call_minutes` | integer 1–60 | 10 | The last call, before the close time |
| `auto_close` | boolean | `true` | An open order closes at its close time (U3) |
| `remind_holder_minutes` | integer 5–240 | 30 | A stalled order reminds its holder after this |
| `remind_crew_minutes` | integer 10–480 | 60 | Then the holder and the crew |
| `release_after_minutes` | integer 30–720 | 120 | A closed order's holder who never calls it in is released |
| `arrival_check_minutes` | integer 5–240 | 30 | "Has it arrived?" this long past the estimate |
| `arrival_check_no_estimate_minutes` | integer 15–480 | 90 | The same after a call-in without an estimate |
| `done_after_arrival_minutes` | integer 15–720 | 120 | An arrived order is done (`timer`) after this (O7) |
| `close_forgotten` | boolean | `true` | At the event day's turn, cancel what was never called in and make done what was |

The scheduler's times are described in [The scheduler](#the-scheduler).

## Data and privacy
- **Data class `personal`** ([tenants.md](tenants.md#privacy-and-retention), O6): orders' holders, openers and payers, pizzas with their person, notes, comments and ticks, each person's amount, the history's actors. No `presence` data.
- `GET /api/pizza/me/export`: the caller's pizzas (with their order, label, note, comment, price and tick), their amount in each order, the orders they held, opened or paid (with the total of those they paid), and their history lines. `DELETE /api/pizza/me` (204, also when the event is archived): their holds on orders not called in are released and their pizzas leave orders still open; everywhere else their name, user id and comments are taken away and replaced by a pseudonym (`anon_…`) that names nobody, so counts and totals stay. Events about it name nobody.
- **Retention:** `tenants.retention.reached` with `personal` (12 months after archiving) anonymises every person of the event the same way; totals and counts stay (0027). `tenants.user.deleted` forgets that user in every event; `tenants.tenant.deleted` deletes the event's rows.
- **Leaving the event** (`tenants.member.left`, E5): the holds of the person who left are released (actor null) and their pizzas leave orders still open; called-in orders keep theirs.

## Audit
To the tenants audit log ([tenants.md](tenants.md#audit-log)), in the request that made the change: every step taken through `pizza.order.manage` on an order the caller does not hold (`pizza.order.taken_over`, `.released`, `.closed`, `.reopened`, `.placed`, `.arrived`, `.done`, `.reverted`, `.cancelled`, `.changed`, with the state, holder or fields before and after and the `reason` given), changes to someone else's pizza (`pizza.item.changed`, `pizza.item.removed`), money changed once an order is closed (`pizza.order.money_changed`), and pizzerias and menus (`pizza.pizzeria.added`, `.changed`, `pizza.menu.replaced`, `pizza.menu.imported` with its counts).

## Events (version 1)
This contract adopts the catalog's provisional pizza events ([events.md](events.md#pizza)) and adds to them. Envelope and transport: [admin.md](admin.md#events). Menus, prices, totals, amounts and phone numbers never travel in events.

The **Order** in events: `id`, `seq`, `state` (adds `done`, D3), `pizzeria` (`id`, `name`), `target_at`, `holder` (Person or null), `pizza_count`, `people_count`, `opened_at`, `closed_at`, `placed_at`, `arrived_at`, `revision`, and the additive `closes_at` (the close time, which `target_at` equals), `estimate_at` (string or null), `pickup` (string or null) and `done_at` (string or null).

The catalog's "one open order at a time per event" becomes **one open order per pizzeria** (D1): no name or field is removed or renamed, and every consumer keys on the order's `id`.

| Type | When | Audience | `data` |
|---|---|---|---|
| `pizza.order.opened`, `.closed`, `.reopened`, `.placed` | As the catalog | event-wide, `public` | `order`, `actor_user_id` |
| `pizza.order.claimed` | A claim, or a take-over | event-wide, `public` | `order`, `previous_holder` (Person or null), `actor_user_id` |
| `pizza.order.released` | As the catalog | event-wide, `public` | `order`, `previous_holder` (Person, or null when that person asked to be forgotten), `reason` (`released`, `forced`, `timeout`), `actor_user_id` |
| `pizza.order.reverted` | As the catalog | event-wide, `public` | `order`, `from_state`, `actor_user_id` |
| `pizza.order.arrived` | As the catalog | personal (`user_ids`); `order` event-wide | `order`, `user_ids`, `people`, `actor_user_id` (added) |
| `pizza.order.cancelled` | As the catalog; also the scheduler's and the archive's (actor null) | as the catalog | `order`, `reason` (`cancelled`, `stale`), `user_ids`, `people`, `actor_user_id` |
| `pizza.order.done` (new, D3) | Everyone got theirs, the holder's Done, or the timer | event-wide, `public` | `order`, `reason` (`handed_out`, `holder`, `timer`), `actor_user_id` |
| `pizza.order.changed` (new) | The close time, note, pizzeria, estimate, call-in time or pickup was edited | event-wide, `public` | `order`, `changed` (field names), `actor_user_id` |
| `pizza.item.added`, `pizza.item.removed` | As the catalog; a removal also by the crew, or when the person left or deleted their data (then `user_id` and `person` are null) | personal (`user_id`) | as the catalog |
| `pizza.item.changed` (new) | Someone else changed a person's pizza (U14) | personal (`user_id`) | as `pizza.item.added` |
| `pizza.amount.changed` (new) | A money change once the order was closed changed these people's amounts (U14); no amounts | personal (`user_ids`) | `order_id`, `user_ids`, `actor_user_id` |
| `pizza.order.closing` | As the catalog: the last call, `last_call_minutes` (10 by default) before the close time; [the scheduler](#the-scheduler) | event-wide, `public` | `order`, `closes_at` |
| `pizza.reminder.triggered` | A person needs to act (D12): a stalled order's holder or the crew ([the scheduler](#the-scheduler)), or someone whose pizza waits (the nudge); one per person | personal (`user_id`); `order` event-wide, `public` | `order`, `kind` (`open_past_target`, `closed_not_placed`, and added: `not_arrived`, `released`, `not_collected`), `minutes` (past the close time, the close, the estimate or call-in, or the arrival), and added: `user_id` (who hears it), `role` (`holder`, `crew`, `member`) |

**Consumes:** `tenants.status.changed` (archived: E11), `tenants.retention.reached`, `tenants.member.left`, `tenants.tenant.cloned` on the event's stream; `tenants.user.deleted`, `tenants.tenant.deleted` on the platform stream; `admin.settings.changed`.

## Not in this contract
The attendee's pages and their live stream (#119); receipts, the AI reader, paid ticks and the money pages (the money issue; they use the rights above); the screens' food box and Notify's food triggers (their own issue); the bot (step 6). Moving any money.
