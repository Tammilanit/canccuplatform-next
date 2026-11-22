# Step 5 (Pizza): deep review

This review covers the whole change of step 5, from the tag `step-4` to `origin/main` at `e265abc8e8918a6c99d2bc9149966de803c93839`: 46 commits, 496 files and about 72,000 lines added, about 4,100 of them `modules/pizza/package-lock.json`.

It was read against these sources:
- [AGENTS.md](../../AGENTS.md).
- The step's plan: [step-5-pizza.md, ## Plan](../briefs/step-5-pizza.md#plan).
- The contracts the code relies on: `contracts/pizza.md`, `contracts/pizza.openapi.yaml` with its parts `contracts/pizza/*.openapi.yaml`, `events.md` (pizza), `screen.md` (`food_status`), `notify.md` (the `food` topic), `profile.md` and `tenants.md` (privacy).

The step's issues are #116, #117, #118, #119, #643, #644, #703, #750, #704 and #747. This review does not repeat the findings already filed in the follow-up issues #617, #665, #676, #699, #706 and #753. Among them:
- the take-over race on the holder-only UPDATEs (#665);
- `eventDay` and summer time (#665);
- sessions not yet bound to a tenant (#665);
- `noteCrew` running before the membership check (#676);
- the reader's daily cap racing (#699);
- `by_owner` being false for a null actor (#706).

## Architecture

**What holds up**

- **A new module that talks only through contracts.** Pizza touches no other module's tables.
  - It reaches tenants (the audit log, Discord ids), admin (settings, rights) and Notify (registering its topic) only through their APIs and the kit clients.
  - Screen and Notify learn about food only from pizza's events. Screen keeps its own `screen_food_orders` (migration 019): the event-wide part of each order, with the newest `revision` deciding between events, and only the revision once an order is over.
- **One transaction per step, with a transactional outbox.** Every write runs in one tenant transaction (`http.ts` `write`). That transaction holds the conditional UPDATE, the history row, the idempotency answer and the outbox rows, and the events are flushed only after the commit.
- **A restart-safe scheduler.** It writes due steps as `pizza_due` rows and takes them with `FOR UPDATE SKIP LOCKED`, so a restart loses nothing and two replicas never take one step twice. The scheduler tests step every boundary minute by minute and also run two replicas and a restart.
- **Rights in one place.** Rights are a pure table (`policy.ts`) that every route goes through.
- **Pages go through the module's own API**, as in Moments. Each page action therefore gets the API's rights, idempotency key and audit.
- **Money stays in the API.** It is computed by one pure function (`money.ts` `amounts`), which the API, the pages, the record and the export all share. It never travels on the bus: the notices name who hears them, never an amount, a MobilePay number or an IBAN.
- **The reader is optional and fenced.**
  - Its key is sealed with the platform's secrets key and bound to the event.
  - Only the last four characters reach the audit log.
  - Outside dev, the fake reader and the placeholder secrets key are both refused at start-up (`main.ts:57`, `:148`).
- **Additive migrations, files within size.** All five migrations of the step are additive (pizza 001–004, screen 019). No source file passes about 400 lines; the largest are `order-routes.ts` (378) and `lifecycle.ts` (366).

**What a single PR could not see**

- **Item writes check the item before taking the lock.** The 7c85214 fix made order writes lock the order before checking rights (`orderFor(…, true)`). The pizza routes read the item *before* that lock (`itemFor`), and `editItem` / `removeItem` never check that a row was changed. Each of the step's PRs added a path on top of this: the notices and `by_owner` (#703) and money (#644). Together they turn a narrow race into a misleading notice and a 500. See blocking 1.
- **The privacy delete and Screen's copy do not meet.** #117 wrote `forgetUser` before Screen kept a copy of each order (#643). Because the delete changes called-in orders without a new revision or event, Screen's copy keeps the forgotten holder's name on the screens and in the hub. See blocking 2.
- **Three paths take a person out of an order, and they disagree on the event's fields.** Those paths are the owner's or holder's removal, a member leaving and the privacy delete. The contract wants `user_id` and `person` null after a leave or a delete, but only the delete does so. See blocking 6. The same mismatch is behind the notice that #706 filed.
- **The pseudonym is only half applied.** The contract replaces a forgotten person's name *and* user id with `anon_…`. The code replaces the user id but sets the name to null, so the export, which matches on the name, writes empty nicks. See blocking 7.
- **HTTP calls are made inside open transactions.** Audit entries (`deps.audit`) and the `personOf` Discord-id lookups are HTTP calls to tenants, made while the order's row lock is held. A slow tenants service therefore stalls every write to that order. This is the same pattern the step 4 review found in Moments.
- **The cleanup paths are the least tested.** Archive, retention, tenant delete and the receipt cap have no tests. Neither does the idempotency replay: its only test cannot fail. See Test quality.

## Security

- **What was checked and holds:**
  - Every write needs a session and refuses an archived event.
  - Guests' and non-members' reads follow the info-page mode.
  - Rights count only where admin is reachable (`restricted`).
  - The kit's `checkOrigin` refuses cross-site posts to the pages.
  - Receipt photos are re-encoded, so their metadata and location go. They are stored under the event's own folder by a server-chosen file name, and served with `private, no-store` and `nosniff`.
  - The reader key never appears in an answer, the audit or an event.
  - The fake reader works only in dev.
  - Caddy routes `/api/pizza/*` to the module and hides `/pizza/internal`, `/pizza/api` and `/pizza/health`.
  - Pizza's tables use forced row-level security, like the rest of the platform.
  - No event names, real IPs or hostnames were found in code, fixtures or the dev seeds. The dev seed's Tailscale prefixes are the generic CGNAT range.
- **Found:**
  - A privacy delete leaves the holder's name on the public screens (blocking 2).
- **Already filed, not repeated:**
  - Admin sessions not bound to a tenant, and every session counted as a member (#665, #753).
  - The placeholder-key check missing `CANCCU_SECRETS_KEYS_RETIRED` (#699).
  - `noteCrew` running before the membership and venue checks (#676).

## Contracts

All contract changes in the step are **additive**. `pizza.md` and its OpenAPI files are new. `events.md`, `screen.md`, `notify.md`, `profile.md` and `flags.yaml` add fields, events and rules. The finals, games and moments edits re-word text to follow 0030.

The catalog's "one open order per event" became "one per pizzeria" without removing or renaming any field. Its consumers (Screen, Notify, Moments) read only the field names pizza sends: `closes_at`/`target_at`, `pickup`, `estimate_at`, `user_ids`, `order_seq`, `by_owner`.

**Checked and kept:**
- **Lifecycle:** the state table with its 409 codes, and the answers for steps already taken (close, reopen, place, arrive, done, cancel, claim, release, take-over).
- **Idempotency:** the `Idempotency-Key` pattern and its scope per person.
- **Scheduler:** the times and defaults, and the late and superseded rules.
- **Settings:** names, defaults and ranges agree across pizza.md, `admin/declarations/pizza.yaml` and `settings.ts`.
- **Money:** the split, the largest-remainder rounding, ties by name, and negative extras falling back to even.
- **Export CSV:** columns and their order, `<day>-<seq>`, the event's offset, LF, no BOM, `amount` on every row or none, the `canccu-left-out` header and the file name.
- **Menu CSV:** BOM, CRLF, quoting, the limits and row numbering.
- **Receipts:** the 10 MB limit (413), at most 10, 2,576 px and the folder path.

**Found:**
- `price_cents`, required in both places that set a price, is treated as optional, and leaving it out wipes the price (blocking 3).
- Hand-out of an order that is already done answers 409 where the contract answers the order (blocking 4).
- The crew's "Everyone got theirs" is not audited (blocking 5).
- A member leaving sends item events that still name them (blocking 6).
- The export writes empty required nicks after a privacy delete (blocking 7).
- Smaller gaps are under Non-blocking: `pickup` before call-in, the `stale` reason, the payment reminder's late rule, replay past 24 hours, code-unit sorting, and the catalog's `user_id` type.

No breaking contract change and no destructive migration.

## Test quality

**Strong and real:**
- No test was skipped, emptied or weakened. The only skips are `describe.skipIf(!DATABASE_URL)` and the browser skip, and CI enforces both: `scripts/check-module` provides the database, and `test/chromium.ts` throws under `CI` when no browser starts.
- The assertions removed from older tests were renames (admin's food settings moved to Food → Settings, `hint` became `help`) or got stronger (the screenshot-compare ratios).
- **Money:** the tests cover ties by name and negative extras, with a seeded property check over 1,000 orders.
- **Export:** a byte-exact test of the contract's example, through the route as well.
- **Rights:** a policy matrix per caller.
- **Races:** proven with Postgres lock waiters.
- **Scheduler:** boundaries stepped minute by minute, two replicas and a restart.
- **Bug fixes:** each `fix(` commit came with a test that fails without it.

**Gaps:**
- The only idempotency replay test uses a step that is already a no-op, so it cannot fail (blocking 8).
- `409 event_archived` and the archived privacy delete have no test (blocking 9).
- Retention, tenant delete and `DELETE /me` are tested for names and photos only, not for Paid marks, "Pay me with", the receipt files on tenant delete, the reader key, or the `me/export` fields (blocking 10).
- `too_many_receipts` has no test (blocking 11).
- `my_amount_estimated` is never asserted (blocking 12).
- Smaller gaps are under Non-blocking:
  - the scheduler's `/health` thresholds;
  - the price route's wiring to its rights;
  - the lock fix covered for one path only;
  - the reader key not checked in events and logs;
  - status-only rights checks;
  - half of "amount on every row or none";
  - the stream's keep-alive and retry lines.

Blocking:
1. [correctness] modules/pizza/src/item-routes.ts:32 — a pizza edit or removal acts on the item as read before the order lock, and never checks that a row was changed
   Evidence: `itemFor` runs `getItem(c, id)` and only then `getOrder(c, item.order_id, true)`. `removeItem` (`items.ts:216`) deletes with no `rowCount` check and then emits. Two cases follow:
   - The owner and the holder remove the same pizza at once. The second request waits on the lock, deletes 0 rows, logs and audits `pizza.item.removed`, and emits a second `pizza.item.removed` with `by_owner: false`. Notify then tells the owner "Your pizza was taken out… The holder or the crew removed it", though they removed it themselves.
   - A `PUT /api/pizza/items/{id}` that waited behind a DELETE updates 0 rows. `getItem` then returns null, and `after.label` (`items.ts:201`) throws: a 500 instead of 404.
   Fix: after the lock is taken, read the item again (`getItem` inside `itemFor`, after `getOrder(…, true)`) and answer 404 when it is gone; check `rowCount` in `editItem` and `removeItem`. Add a race test with `waitForLockWaiter`, as `races.test.ts` does for release.
2. [security] modules/pizza/src/privacy.ts:75 — a privacy delete clears the holder of a called-in order without a new revision or event, so the screens keep showing the deleted person's name
   Evidence: `forgetUser` sets `holder_name = NULL` on `placed` and `arrived` orders with a plain UPDATE: no `revision = revision + 1`, and no event. Screen keeps `holder_name` in `screen_food_orders` and changes it only on a newer revision (`modules/screen/src/compose/food.ts:91`). An arrived order therefore goes on showing "Pizza is here · collect from <name>" on the screens and in the hub's `/api/screen/now` until the order is done, up to `done_after_arrival_minutes` (720 at most). Yet pizza.md says "Events about it name nobody", and the delete is meant to take the name away.
   Fix: in `forgetUser`, for each order whose holder or payer was cleared, raise `revision` and emit `pizza.order.changed` (actor null, `changed: ["holder"]`) through the outbox. Test that Screen's copy loses the name.
3. [data-loss] modules/pizza/src/money-routes.ts:226 — a price write without `price_cents` clears the pizza's price instead of answering 400
   Evidence: orders.openapi.yaml (`PUT /api/pizza/items/{item_id}/price`) has `required: [price_cents]`, and pizza.openapi.yaml has `required: [item_id, price_cents]` for each `prices` entry. Yet `parsePrice(body(request).price_cents, …)` maps `undefined` to `null` (`validate.ts:75`). So `PUT …/price {}`, or a misspelt `{"price": 850}`, deletes the stored price. That turns an exact split into an even one and sends `pizza.amount.changed`. The same happens for a `prices` entry without `price_cents` in `PATCH …/money` (`money-routes.ts:163`).
   Fix: answer 400 `price_cents` when the key is absent; only an explicit `null` clears a price. Test both routes.
4. [contract] modules/pizza/src/items.ts:234 — "Everyone got theirs" on an order that is already done answers 409 `done` instead of the order
   Evidence: orders.openapi.yaml `handOutOrder` says "A step already taken answers the order without a second event", and pizza.md:59 says "A step already taken … answers the order as it is, 200". But `handOutAll` calls `lockOrder(s.c, orderId, ["arrived"], "hand_out")`, which refuses `done`. A holder who presses the button after the timer or a second crew member has finished the order gets an error. The `done` step itself answers 200 in the same case.
   Fix: when the order is already `done`, answer it unchanged with no event, as `simple()` does. Test a second hand-out.
5. [contract] modules/pizza/src/item-routes.ts:145 — the crew's "Everyone got theirs" on an order they do not hold is not audited
   Evidence: pizza.md Audit says "every step taken through `pizza.order.manage` on an order the caller does not hold (… `.done` …), with the state … before and after". The route `POST /api/pizza/orders/{id}/hand-out` takes `order.hand_out` as `crew` and moves the order `arrived` → `done`, but never calls `deps.audit`. The order steps audit through `auditCrew` (`order-routes.ts:302`).
   Fix: when `as === "crew"`, audit `pizza.order.done` with the state before and after (reuse `auditCrew`). Test it, as the other crew steps are tested.
6. [contract] modules/pizza/src/privacy.ts:53 — when a member leaves the event, `pizza.item.removed` still carries their `user_id` and `person`
   Evidence: pizza.md:279 says "a removal also by the crew, or when the person left or deleted their data (then `user_id` and `person` are null)". The code passes `quiet ? { ...i, user_id: null, name: null } : i`, so only the delete (`quiet`) nulls them, and `tenants.member.left` sends the real person. Notify's `food` trigger then tells the person who left that "the holder or the crew removed it" (the symptom filed in #706). This line is its cause, and it breaks the contract.
   Fix: always pass `{ ...i, user_id: null, name: null }` from `leave()`. Assert the event's `user_id` and `person` in the leave test.
7. [contract] modules/pizza/src/export-csv.ts:82 — after a privacy delete or retention, the export writes an empty `nick` (and `payer_nick`), which the contract requires
   Evidence: the forgotten person's name should be "replaced by a pseudonym (`anon_…`)" (pizza.md, Data and privacy). The export's `nick` is "required: yes; the payment system matches on it". But `forgetUser` sets `pizza_items.name = NULL` and `payer_name = NULL` (`privacy.ts:71`, `:79`), and the export writes `p.name ?? ""` and `o.payer_name ?? ""` (line 73). An order with two forgotten people gives two rows with the same empty nick, which the payment system merges or rejects.
   Fix: write the pseudonym where the name is gone (`p.name ?? p.user_id`, and the same for the payer), or store the pseudonym in `name` when forgetting. Test the export after `DELETE /api/pizza/me`.
8. [test] modules/pizza/test/cancel.test.ts:98 — the only Idempotency-Key replay test (E2) cannot fail
   Evidence: the test closes an order twice with the key `close-once-1` and expects the same body and one event. A second close of a closed order is already a no-op by contract: 200, the order as it is, no event (`lifecycle.ts`). So with `once()` in `idempotency.ts` removed, the test still passes. Nothing replays a write that is not idempotent on its own, tests the scope per person, or tests the 24-hour expiry (`dropOldKeys`).
   Fix: POST `orders/{id}/items` twice with one key and expect one pizza, the same 201 body and one `pizza.item.added`. The same key from another person adds a second pizza. After 24 h and `dropOldKeys`, the key acts again.
9. [test] modules/pizza/src/http.ts:182 — 409 `event_archived` and "the privacy delete still works" on an archived event are not tested
   Evidence: a grep for `event_archived` in `modules/pizza/test` finds nothing. The `archived.test` host is defined in `test/helpers.ts` and never used. The same refusal guards `reader-routes.ts:55`, `paid.ts` and `reader-key.ts`.
   Fix: a write on `archived.test` answers 409 `event_archived`, and `DELETE /api/pizza/me` on it answers 204.
10. [test] modules/pizza/src/privacy.ts:160 — retention, tenant delete and `DELETE /me` are not tested for the money data they must delete
   Evidence: `privacy.test.ts` checks names, orders and pizzerias, and `receipts.test.ts` checks the photos at retention. Nothing asserts any of these:
   - retention deleting `pizza_paid` and `pizza_pay_details`;
   - `DELETE /me` deleting the caller's Paid marks (`paid.test.ts:157` checks only pay details);
   - `tenants.tenant.deleted` removing the receipt files and the reader key;
   - the `paid_marks` and `reader` fields of `GET /api/pizza/me/export`.
   Fix: extend `privacy.test.ts` with each of these, checking table counts, files on disk and the export's fields.
11. [test] modules/pizza/src/receipts.ts:100 — the cap of 10 receipts per order (409 `too_many_receipts`) is never tested
   Evidence: a grep for `too_many_receipts` and `MAX_RECEIPTS` in `modules/pizza/test` finds nothing.
   Fix: upload 10 receipts, then expect the 11th to answer 409 `too_many_receipts`.
12. [test] modules/pizza/src/views.ts:115 — `my_amount_estimated`, a contract field of the member's view, is never asserted
   Evidence: a grep for `my_amount_estimated` and for the My order page's estimate note in `modules/pizza/test` finds nothing. If the flag were inverted or dropped, no test would fail.
   Fix: in `money-routes.test.ts`, assert that a member's order view has `my_amount_estimated: true` before the total is in and `false` after it. Assert the note on My order.
Non-blocking:
- [contract] modules/pizza/src/order-routes.ts:350 — `PATCH` sets `pickup` in any state, while pizza.md:79 allows `pickup` "once called in", as it does for `estimate_at` and `placed_at` (line 347).
- [contract] modules/pizza/src/lifecycle.ts:361 — the scheduler's cancel of a forgotten order at the event day's turn passes the reason `cancelled`; pizza.md:78 says an order from an earlier event day is cancelled as `stale`.
- [other] modules/pizza/src/policy.ts:142 — with `open_by` `crew`, `pizza.order.manage` may also open orders. The setting's text says "only `pizza.order.open`". `policy.test.ts` makes it deliberate, so align the contract's Rights table or the code.
- [contract] modules/pizza/src/due.ts:144 — `staleReason` returns null for steps without `remind`, so the `not_paid` payment reminder is never skipped when it is more than 30 min late (after an outage or `pizza.enabled` back on), against pizza.md:97.
- [correctness] modules/pizza/src/items.ts:225 — a single hand-out tick raises the revision but emits nothing, so `/api/pizza/stream` sends no `change`, and other open hand-out pages do not see an owner's own tick until the order is done (D13).
- [contract] modules/pizza/src/idempotency.ts:41 — the stored answer is replayed without checking its age, so a key replays until the hourly `dropOldKeys`, up to about 25 h instead of "within 24 hours".
- [correctness] modules/pizza/src/record-routes.ts:29 — `?day=2026-02-30` passes the `DAY` shape check and reaches `day = $1::date`, so `/record`, `/export` and `/export.csv` answer 500 instead of 400 `day`.
- [correctness] modules/pizza/src/reader-routes.ts:102 — the menu read reserves a counted read before `cleanPhoto` checks the photo (and the receipt read before `readFile`, line 72), so a corrupt photo uses up one of the day's reads though the provider was never called.
- [contract] modules/pizza/src/money.ts:39 — `byName` compares UTF-16 code units, while pizza.md sorts the export "by nick (by code point)"; names with characters outside the BMP sort differently.
- [correctness] modules/pizza/src/export-csv.ts:60 — a called-in order with a total whose pizzas were all removed gets no rows and no `left_out` entry, so its cost silently never reaches the payment system.
- [correctness] modules/pizza/src/menu-routes.ts:108 — the import plans against visible pizzerias only (`listPizzerias(c)`), so a CSV naming a hidden pizzeria adds a second one with the same name instead of matching it; un-hiding the old one then fails with `pizzeria_exists`.
- [docs] contracts/events.md:203 — the catalog still types `pizza.item.removed`'s `user_id` as "string: adding a pizza needs sign-in", while pizza.md:279 makes it null after a leave or a delete; note the nullable type in the catalog.
- [docs] contracts/events.md:211 — `pizza.reminder.triggered` is now one event per person who hears it, where the catalog's bot "posts in the event's channel". Say there which events the bot posts (one per order, `role` `holder`?), so step 6 does not post N copies.
- [docs] modules/moments/src/story/model.ts:99 — `PROVISIONAL` still lists `pizza.order.closing` as sent by no module ("the pizza module, step 5"), so the story picker says it waits for a module that now sends it.
- [other] modules/pizza/src/order-routes.ts:39 — audit entries and Discord-id lookups are HTTP calls to tenants made inside the write's transaction, so a slow tenants service holds the order's row lock for every other write to it.
- [test-gap] modules/pizza/test/scheduler.test.ts:310 — `/health` is tested only as "not run yet" and "lag 30 s". The thresholds (lag over 120 s, no tick for 90 s), the archived-event skip and a failed step being retried are not tested.
- [test-gap] modules/pizza/src/money-routes.ts:220 — the policy table cannot see a route wired to the wrong action. No test has the owner or a member `PUT …/price`, the holder `PUT …/price` after the day turns (`money_locked`), or a member `GET /api/pizza/export`.
- [test-gap] modules/pizza/test/races.test.ts:122 — the 7c85214 lock fix is raced only on release. PATCH order, the holder's edit of someone else's pizza during a take-over, money and Paid could lose `FOR UPDATE` without a failing test.
- [test-gap] modules/pizza/test/reader.test.ts:111 — the reader key is checked in the answer, the database and the audit, but not in `w.events()` or the log output, which the contract also names.
- [test-gap] modules/pizza/test/money-routes.test.ts:114 — the money rights test asserts only `403`, where the contract names the code (`not_holder`); use `errorOf(...).code`.
- [test-gap] modules/pizza/test/export-csv.test.ts:75 — "amount on every row or none" checks only the even order's first data row; assert every row of both orders.
- [test-gap] modules/pizza/src/live.ts:57 — neither the stream's `retry: 3000` line nor the 25 s `: keep-alive` comment (line 40) is asserted.
Pre-existing:
Risk: high — the step's packages include money, personal data, rights and a sealed secret (the reader key: #117, #644, #703), agent config (`AGENTS.md`, #692 and #714) and `.github/` (the gates, #663 and #740), which need the maintainer's accept; the rest are normal (a new module, additive contracts and migrations, UI). No breaking contract change and no destructive migration.
Findings: 12 blocking, 22 non-blocking, 0 pre-existing
Review verdict: changes e265abc8e8918a6c99d2bc9149966de803c93839
