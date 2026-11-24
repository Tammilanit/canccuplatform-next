# Plan: issue #789 — the step 5 demo's findings

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans, task by task, test first. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 17 findings of the PO's step 5 demo in the `pizza` module: menu reading (camera, real progress, an editable table, two-column menus with category prices, flags, several pages), the "Fantasia" own pizza, exact split by default and the even-share limit, group receipt lines, upload sizes, read errors and the read log, holder controls, photo viewers, and the two review leftovers of #767.

**Architecture:** Everything stays inside `modules/pizza` and its contract. The API keeps its shape and only adds: new optional fields on menus, items, money, reads and the menu read's answer, a multipart form of the menu read, one read-log endpoint, one event, one migration (`005_demo_findings.sql`, columns only). The pages keep working without a script; `static/*.js` adds the camera shrink, the progress and the table controls.

**Tech stack:** TypeScript, Fastify 5, Postgres (RLS), sharp, `@anthropic-ai/sdk` 1.12, vitest, Playwright (browser tests and CI screenshots).

**Spec:** [issue #789](https://github.com/Tammilanit/canccuplatform-next/issues/789) (the 17 items and its acceptance criteria), [contracts/pizza.md](../../contracts/pizza.md), the [step 5 plan](../briefs/step-5-pizza.md#plan).

## Why a plan first
1. **Size.** Estimated source plus tests (below): about 5,800 changed lines, past the package limit of about 4,000 ([AGENTS.md](../../AGENTS.md#how-work-flows)). The issue says "the lead may split it into packages"; a worker may not split an issue, so the lead decides (Q1).
2. **Two decisions the issue leaves open** touch the contract's rules (Q2, Q3) and one names a limit nobody has set yet (Q4).

## Size by part (source plus tests, estimated)
| Part | Items | Lines | Risk |
|---|---|---|---|
| A. Leftovers and pages: price write under the lock, hand-out on a done order, exact by default, holder controls, photo viewer | 7, 13, 14, 16, 17 | 700 | high (money code) |
| B. Photos and reads: upload sizes, read errors, read log and Integrations, organisers told | 10, 11, 12 | 1,600 | high (uploads, AI reader, secrets-adjacent) |
| C. Menu reading: camera, progress, table, categories, flags, several pages, the reader's Fantasia lines | 1–5, 6 (reading), 15 | 2,300 | high (AI reader) |
| D. Money: Fantasia price, the even-share limit, group receipt lines | 6 (price), 8, 9 | 1,200 | high (money) |
| **Total** | **17** | **≈ 5,800** | **high** |

Order: A → B → C → D. B before C because C's progress and errors use B's error reasons and B's shrinking; D last because its Fantasia price uses C's menu fields. A and D share `money-routes.ts`/`money.ts` only lightly; B and C share `reader.ts`, `anthropic-reader.ts`, `reader-routes.ts`.

## Global constraints
- Additive only: no field, code, path or event removed or renamed. Every contract change below is additive; if one turns out breaking, stop for the PO (issue AC 3).
- Migration `005_demo_findings.sql`: `ADD COLUMN` only, each nullable or with a default; no drop, rename or type change.
- No real pizzeria, event, venue or price list in the repo: the two-column menu fixture is synthetic (`Demo …` names, invented prices) and drawn by the test itself.
- The provider gets only the photos and fixed instructions: never a name, an order or a price of ours.
- A failed read changes no price, no total and no menu.
- Every page works without a script; scripts add the shrink, the progress, the countdown and the table controls.
- English and Finnish for every new string (`messages*.ts`, `money-messages*.ts`, `food-messages.ts`).
- About 400 lines per source file: `menu-read.ts`, `money-views.ts`, `reader-routes.ts` and `anthropic-reader.ts` will need splitting (named in the tasks); no new exemption.
- Shots at 390 and 1280 px (issue AC 2) in `scripts/demo-screenshots-pizza.mjs`.

## Design decisions
| # | Decision | Reason |
|---|---|---|
| D1 | Reader errors keep status 502 and code `reader_failed`; the body's `error` gains `reason` (`timeout`, `service_down`, `rate_limited`, `out_of_credit`, `declined`, `unreadable`, `failed`) and, for `rate_limited`, `retry_after_s`. `ReaderFailed.toBody()` adds them; the kit and the shared `Error` schema stay as they are (it does not forbid more properties) | Additive: a client that branches on `reader_failed` keeps working; the pages branch on `reason` |
| D2 | `reader_off` (no key or reader off), `reader_key_rejected`, `reader_limit` stay as they are and gain only their page texts | Already in the contract |
| D3 | "Unreadable or not a receipt/menu" and "partly read" come from the model: both schemas gain `readable` (boolean) and `reason` (string, 200), receipt lines and menu rows gain `unsure`. `readable: false` → 502 `reader_failed`, `reason: unreadable`, the model's text in `message`. Partly read is a 200 with the unsure parts marked | Item 11 |
| D4 | The provider timeout is 50 s for one page plus 10 s per further page, at most 100 s (`timeoutFor(pages)`); the pages give up 10 s after that. The SDK keeps `maxRetries: 0`; a `rate_limited` answer is retried by the page, after `retry_after_s` with a countdown, at most twice | Item 2 "after about 60 s"; item 15 "the timeout grows with the page count"; item 11 rate limit |
| D5 | Every read is a row of `pizza_reads` with `outcome` (adds `unreadable`, `declined`, `timeout`, `rate_limited`, `service_down`, `out_of_credit` to `ok`, `failed`, `rejected`), `reason` (200), `pages`, `input_tokens`, `output_tokens`, `cost_micro_usd`, `ms`. Cost = tokens × the model's per-token prices, two constants next to `MODEL` | Item 12 |
| D6 | A read the provider answered with an error and billed nothing (`rate_limited`, `service_down`, `timeout`, `out_of_credit`, `rejected`) is logged but does **not** count against `ai_reader_daily_reads`; a read with tokens (`ok`, `unreadable`, `declined`) counts. See Q2 | Item 11 "a failed read costs nothing"; a page that retries a rate limit must not use up the day |
| D7 | Organisers are told by a new event `pizza.reader.stopped` (`reason` `key_rejected` or `out_of_credit`, `user_ids` = `crewOf()`), personal, through the `food` topic; `key_rejected` once per key (it already stops the reader), `out_of_credit` once per event day. `notify.md`'s `food` registration gains its trigger | Item 11; the crew is the only list of organisers pizza has (`pizza_crew`) |
| D8 | Upload limit 30 MB (`MAX_PHOTO_BYTES`), for the API bodies and the multipart forms; the stored and sent photo is shrunk once to 1600 px on the long side, or 2400 when the photo is more than twice as tall as wide (`LONG_EDGE`, `TALL_EDGE`); the stored receipt is that shrunk JPEG/WebP, the upload's bytes are never written. The phone shrinks to 2000 px in `static/shrink.js` (canvas, JPEG 0.85) before sending; without a script the server does it all | Item 10 |
| D9 | The menu read takes up to 6 pages in one provider call: `POST /api/pizza/menu/read` also accepts `multipart/form-data` with parts named `page` in order (the single image body stays). The answer keeps `csv`, `items`, `unsure` and adds `rows` (`MenuRow[]`), `notes` (flags), `pages`, `cost_estimate_micro_usd` | Item 15; the old shape stays for any caller |
| D10 | The read's table round-trips in the page's form (hidden and visible inputs), so add, delete, merge and "Add more pages" need no state between requests; the final "Check the import" turns the rows into the menu CSV and posts to the import preview as today | Containers keep no state (AGENTS.md) |
| D11 | Real progress on the pages: the script sends the form with `XMLHttpRequest` (upload bar from `upload.onprogress`), to a page route that answers NDJSON as it goes: `{"phase":"reading","pages":n,"seconds":s}` before the provider call, `{"phase":"checking"}` after it, then `{"done":true,"html":…}` or `{"error":{…}}`. Without a script the form posts and the result page answers as today | Item 2; phases are what the server is doing, not timers |
| D12 | Categories: a menu row has `category` (60) and `category_price_cents`. After the read, `applyCategories(rows)` gives an item without a price its category's price and marks it `price_from_category`. Reading order across columns and pages is the model's (the instructions say: left column top to bottom, then the right, page after page; a heading continues until the next heading). Stored: `pizza_menu_entries.category`; the CSV gains `category` and `category_price` (an item with an empty `price` takes `category_price`) | Item 4 |
| D13 | Flags: the model returns `notes` (`kind` `campaign` or `lunch`, `text`, `page`); they are shown above the table and never become prices or rows | Item 5 |
| D14 | Fantasia: the menu's `base` gains `included_toppings` (0–10, null = today's pricing) and `extra_topping_price`; a topping gains `tier` (`normal`, the default, or `special`). With `included_toppings` set the own pizza costs base + max(0, normals − N) × extra price + Σ special prices; with it null, base + Σ topping prices as today. An own pizza takes 1 to 6 toppings (was 4). CSV columns `included_toppings`, `extra_topping_price`, `tier` | Item 6 |
| D15 | Gathered toppings: when a read has a base but no normal toppings, `gatherToppings(rows)` splits the items' descriptions at commas and "and"/"ja", folds case, keeps those on at least two pizzas, and adds them as `topping` rows marked `unsure` with `gathered: true`, which the crew confirms in the table | Item 6 |
| D16 | Exact stays the default when every pizza has a price (`amounts()` already does it); A pins it with tests on the API and the pages, and the holder's split form posts `split` only when the holder changes it | Item 7 |
| D17 | The even-share limit is `round(average of the pizzeria's visible priced items × 1.3)` to 10 cents, stored on the order as `even_limit_cents` when it is called in (live before), so a later menu edit does not move amounts. It applies only to an even split: each pizza over it pays the even share plus its part above the limit (`over_limit_cents` per person); the rest of the total is split evenly. No priced item: no limit, the page says plain even shares. A limit that would make the even share negative is dropped | Item 8 |
| D18 | Group receipt lines: the receipt schema's lines gain `group` (boolean: the line names no item, "15 × pizza") and `unit_cents` ("à €13,00"). Matching takes pizzas no line named; with `unit_cents` each gets it as its suggested price, else each keeps its own price and the difference becomes part of the extras (split per pizza in exact amounts, as extras are now). `group_count_mismatch` (`{line, count, pizzas}`) warns when the count differs from the pizzas it covers | Item 9 |
| D19 | Holder controls: My order shows "You hold this order" with the next step as a button whenever `you_hold` (not only after `?opened=1`); the next step by state: open → Close the order, closed → Call it in, placed without total → Scan the receipt, placed → It's here, arrived → Hand out | Item 13 |
| D20 | One photo viewer, `static/viewer.js`, for every receipt photo link in Food (`[data-viewer]`): a `<dialog>` with ✕, Esc, a click on the backdrop and a swipe down of 80 px or more; without a script the link opens the photo | Item 14 |
| D21 | `PUT …/items/{id}/price` reads the pizza again after `forMoney` locks the order and answers 404 when it is gone; `handOut` on a `done` order answers the order unchanged, as `handOutAll` does | Items 16, 17 |
| D22 | The read log is `GET /api/pizza/reader/reads?month=YYYY-MM` (`admin.integrations.write`): each read (when, kind, pages, outcome, reason, tokens, cost) and the month's totals (`reads`, `cost_micro_usd`, `limit_micro_usd`). Integrations shows it under the key | Item 12 |

## Questions
Question: **Q1, split.** One PR of about 5,800 lines, or four PRs in order A → B → C → D? **Recommendation:** four PRs on this issue, each `Part n of #789` with `Refs #789`, and only D's PR says `Closes #789`; all four high risk, each with its own accept. The parts follow the dependencies above, not a line count.

Question: **Q2, counting failed reads.** The contract says "each call counts, also a failed one". Item 11 says "a failed read costs nothing". **Recommendation:** D6: provider errors that billed nothing do not count against the daily reads; anything the model answered counts. The contract line changes to say so. It only loosens a limit (no client breaks), so it stays additive.

Question: **Q3, larger limits.** The contract's 10 MB upload, 2,576 px stored edge and "1 to 4 toppings" change to 30 MB, 1,600 (2,400 tall) px and 1 to 6. **Recommendation:** accept all three as additive: a larger upload and more toppings only allow more, and a smaller stored photo is within the old bound.

Question: **Q4, "this month's total against the limit".** No monthly limit exists in the platform; the provider's spend limit cannot be read with an API key. **Recommendation:** a new setting `ai_reader_monthly_limit_usd` (number 0–1000, default 0 = none) that the admin copies from the provider's Console; Integrations shows "this month $0.42 of $5.00" and a warning past 80 %; it stops nothing (the provider stops reads itself, which item 11's `out_of_credit` covers).

---

## Part A — leftovers and pages (items 7, 13, 14, 16, 17)

### Task A1: The price write takes the lock first (item 16)
**Files:** Modify `modules/pizza/src/money-routes.ts` (the `PUT /api/pizza/items/:id/price` handler) · Test `modules/pizza/test/races.test.ts`

- [ ] **Step 1: Write the failing test** `price write after the pizza's removal answers 404`: begin a transaction that deletes the pizza and holds it; start the price `PUT`; commit the delete; expect status 404, code `not_found`, and the order's `revision` unchanged.
- [ ] **Step 2: Run** `cd modules/pizza && npx vitest run test/races.test.ts` — expect FAIL (200).
- [ ] **Step 3: Implement**: after `forMoney(...)`, `const item = await getItem(c, id)` again; `null` → `notFound("pizza")`; keep the early read only for the order id.
- [ ] **Step 4: Run** the same — PASS. **Step 5: Commit** `fix(pizza): the price write reads the pizza under the order's lock`.

### Task A2: A hand-out tick on a done order answers as it is (item 17)
**Files:** Modify `modules/pizza/src/items.ts` (`handOut`) · Test `modules/pizza/test/items.test.ts`

- [ ] **Step 1: Failing test** `hand-out tick on a done order answers 200 unchanged`: make an order `done` by "Everyone got theirs", then `POST /api/pizza/items/{id}/hand-out {handed_out:false}` → 200, the order's state `done`, `revision` and the item's `handed_out_at` unchanged, no event in the outbox.
- [ ] **Step 2: Run** `npx vitest run test/items.test.ts` — FAIL (409).
- [ ] **Step 3: Implement** in `handOut`: read the order first; `done` → return `unchanged(o)` (as `handOutAll`).
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `fix(pizza): a hand-out tick on a done order answers the order as it is`.

### Task A3: Exact by default (item 7)
**Files:** Modify `modules/pizza/src/pages/money-views.ts` (`splitChoice`), `modules/pizza/src/pages/money.ts` · Test `modules/pizza/test/money.test.ts`, `modules/pizza/test/pages-money.test.ts`

- [ ] **Step 1: Failing tests**: `money.test.ts` `exact is the default when every pizza has a price` (`amounts({total_cents: 3000, split: null}, three priced rows).split === "exact"`), and `even is the fallback when a pizza has no price`; `pages-money.test.ts` `the money page shows exact checked for an all-priced order and stores no split until the holder picks one` (GET the holder's money page; `exact` radio checked; the order's `split` still null after saving the total).
- [ ] **Step 2: Run** `npx vitest run test/money.test.ts test/pages-money.test.ts` — the page test is expected to FAIL if any form posts a split with the total; if both pass, the defect is not in this path: use superpowers:systematic-debugging on the demo seed's orders (`dev-seed.ts`) before changing anything.
- [ ] **Step 3: Implement** the fix the test points at (no split in the total's form; the split form only on change).
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `fix(pizza): exact split stays the default while every pizza has a price`.

### Task A4: Holder controls always there (item 13)
**Files:** Modify `modules/pizza/src/pages/my-order-views.ts` (`myOrderView`; new `holderCard(c, o): Html`), `food-messages.ts` (en, fi) · Test `modules/pizza/test/pages-my-order.test.ts`

**Interfaces:** Produces `nextStep(o: OrderView): { label: string; href: string; method: "get" | "post" } | null` in `my-order-views.ts` (D19).

- [ ] **Step 1: Failing tests**, one per state: `holder sees "You hold this order" with <step> while <state>` for open → "Close the order", closed → "Call it in", placed (no total) → "Scan the receipt", placed (total in) → "It's here", arrived → "Hand out"; and `no holder card for someone who does not hold it`; and `no holder card on a done or cancelled order`. Each GETs `/pizza/orders/{id}` **without** `?opened=1`.
- [ ] **Step 2: Run** `npx vitest run test/pages-my-order.test.ts` — FAIL.
- [ ] **Step 3: Implement** `holderCard` above the pair, shown whenever `o.you_hold`; the step's button posts to the holder's existing routes (`/pizza/hold/{id}/…`) or links to the scan page; keep the `opened` notice's text.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `fix(pizza): the holder's controls are on the order whenever you hold it`.

### Task A5: The photo viewer (item 14)
**Files:** Create `modules/pizza/static/viewer.js`; modify `static/pizza.css` (dialog), `src/pages/money-views.ts`, `src/pages/record-views.ts`, `src/pages/receipt-views.ts` (add `data-viewer` to every receipt photo link) and the frame's script list · Test `modules/pizza/test/flows.browser.test.ts`, `modules/pizza/test/pages-record.test.ts`

- [ ] **Step 1: Failing tests**: `pages-record.test.ts` `every receipt photo link carries data-viewer`; browser `the photo viewer closes on ✕, Esc, a click outside and a swipe down` (open the Record's receipt, check `dialog[open]`, close each way, check closed; the swipe as `touchstart`/`touchmove` 120 px down/`touchend` at 390 px).
- [ ] **Step 2: Run** `npx vitest run test/pages-record.test.ts test/flows.browser.test.ts -t viewer` — FAIL.
- [ ] **Step 3: Implement** `viewer.js` (D20): one `<dialog class="pizza-viewer">` made on first use, `showModal()`, close button with `aria-label`, `cancel` for Esc, backdrop click by target check, swipe ≥ 80 px down closes.
- [ ] **Step 4: Run** — PASS. **Step 5: Commit** `feat(pizza): one photo viewer for Food's receipts`.

### Task A6: Shots and PR
- [ ] Add to `scripts/demo-screenshots-pizza.mjs`: `food-holder-card` (an order you hold, open and placed) and `food-photo-viewer` (open), each at 390 and 1280 px.
- [ ] Checks: `cd modules/pizza && npm run lint && npm run typecheck && npx vitest run test/races.test.ts test/items.test.ts test/money.test.ts test/pages-money.test.ts test/pages-my-order.test.ts test/pages-record.test.ts`; the repo checks (`scripts/check-naming`, `scripts/check-file-size`, `scripts/check-contracts`, `scripts/check-event-names`). PR per Q1.

---

## Part B — photos and reads (items 10, 11, 12)

### Task B1: Upload sizes (item 10)
**Files:** Modify `modules/pizza/src/photos.ts`, `src/pages/uploads.ts`; create `modules/pizza/static/shrink.js`; modify `receipt-views.ts` and `menu-read.ts` forms (`data-shrink`) · Test `modules/pizza/test/receipts.test.ts`, `modules/pizza/test/flows.browser.test.ts`

**Interfaces:** Produces `MAX_PHOTO_BYTES = 30 * 1024 * 1024`, `LONG_EDGE = 1600`, `TALL_EDGE = 2400`, `edgeFor(width: number, height: number): number` (2400 when height > 2 × width, else 1600), and `cleanPhoto(input, type): Promise<{ image: Buffer; type: string }>` now returning JPEG for JPEG/PNG and WebP for WebP (PNG is never kept).

- [ ] **Step 1: Failing tests** in `receipts.test.ts`: `a 25 MB photo is accepted` (201); `a 31 MB photo is 413 file_too_large with a plain message` (the message names 30 MB); `the stored receipt is at most 1600 px on its long side`; `a receipt more than twice as tall as wide keeps up to 2400 px`; `the stored file is the shrunk one: its bytes differ from the upload and have no EXIF`; `what the reader is sent is the stored photo` (the fake reader's last image equals the stored file). Images from `test/images.ts` (add `bigJpeg(bytes)`, `tallJpeg(w, h)`).
- [ ] **Step 2: Run** `npx vitest run test/receipts.test.ts` — FAIL.
- [ ] **Step 3: Implement** (D8); `forProvider` then only re-encodes when over `PROVIDER_MAX_BYTES`; the multipart limit follows `MAX_PHOTO_BYTES`; `shrink.js` redraws a chosen file to 2000 px JPEG 0.85 and replaces it in the form (`DataTransfer`) before sending.
- [ ] **Step 4: Browser test** `the phone shrinks a 4000 px photo to 2000 px before it uploads` (capture the request body size and the decoded width on the server side through the fake reader). **Step 5: Run** both — PASS. **Commit** `fix(pizza): photos up to 30 MB, shrunk on the phone and on the server, only the shrunk one kept`.

### Task B2: The reader's answers and errors (item 11)
**Files:** Modify `modules/pizza/src/reader.ts`, `src/anthropic-reader.ts` (split: `src/reader-schemas.ts` takes the schemas, instructions and `receiptOf`/`menuOf`), `src/fake-reader.ts` · Test `modules/pizza/test/anthropic-reader.test.ts`

**Interfaces:** Produces in `reader.ts`:
```ts
export type ReadReason = "timeout" | "service_down" | "rate_limited" | "out_of_credit" | "declined" | "unreadable" | "failed";
export interface ReadUsage { input_tokens: number; output_tokens: number; ms: number }
export class ReaderFailed extends KitError { constructor(reason: ReadReason, o?: { message?: string; retryAfterS?: number; usage?: ReadUsage }); readonly reason: ReadReason; readonly usage: ReadUsage | null; toBody(): ErrorBody /* adds reason, retry_after_s */ }
export interface Reader {
  receipt(image: Buffer, type: string): Promise<{ reading: ReceiptReading; usage: ReadUsage }>;
  menu(pages: { image: Buffer; type: string }[]): Promise<{ reading: MenuRead; usage: ReadUsage }>;
}
export const timeoutFor = (pages: number): number => Math.min(100_000, 50_000 + 10_000 * (pages - 1));
```
`ReceiptReading` gains `readable`, `reason`, line `unsure`, `group`, `unit_cents`; `MenuRead` is defined in Task C2 (B2 defines it with `rows` and `notes` only, C2 adds the rest).

- [ ] **Step 1: Failing tests** (mock `fetch`), one per row of the issue's table that the reader decides: 401 → `ReaderKeyRejected`; 403 → `ReaderKeyRejected`; 400 whose message names the credit balance → `reason: out_of_credit`; 429 with `retry-after: 7` → `rate_limited`, `retryAfterS: 7`; 500, 529 → `service_down`; a fetch that never answers (fake timers past `timeoutFor(1)`) → `timeout`; `stop_reason: "refusal"` → `declined`; `readable: false, reason: "not a menu"` → `unreadable` with that message; `stop_reason: "max_tokens"` → `failed`; a 200 → `usage` has the answer's token counts; the request carries `n` image blocks in page order for a 3-page menu, and no other text than the fixed instructions.
- [ ] **Step 2: Run** `npx vitest run test/anthropic-reader.test.ts` — FAIL.
- [ ] **Step 3: Implement** the mapping by SDK error class and status; `client.messages.create(…, { timeout: timeoutFor(pages) })`; the schemas gain the fields above; the fake reader answers by a marker in the photo (keep today's demo answers; add `FAKE_FAIL` markers per reason, chosen by the test through `test/images.ts`).
- [ ] **Step 4: Run** — PASS. **Commit** `feat(pizza): the reader names why a read failed`.

### Task B3: The read log, counting and the organisers told (items 11, 12)
**Files:** Create `modules/pizza/migrations/005_demo_findings.sql` (B's columns; C and D add theirs to the same file before their merge, or `006`/`007` if B has merged — a merged migration is never edited); modify `src/reader-key.ts` (`takeReader`, `noteRead`, new `readsOf`), `src/reader-routes.ts`, `src/events.ts`, the `food` topic registration (`src/topic.ts`) · Test `modules/pizza/test/reader.test.ts`, `modules/pizza/test/topic.test.ts`

**Interfaces:** `noteRead(c, taken, result: { outcome: ReadOutcome; reason: string | null; pages: number; usage: ReadUsage | null }, now)`; `ReadOutcome = "ok" | "rejected" | ReadReason`; `costMicroUsd(usage: ReadUsage): number`; `readsOf(c, month: string): Promise<{ reads: ReadRow[]; totals: { reads: number; cost_micro_usd: number } }>`.

SQL: `ALTER TABLE pizza_reads ADD COLUMN reason text, ADD COLUMN pages integer NOT NULL DEFAULT 1, ADD COLUMN input_tokens integer, ADD COLUMN output_tokens integer, ADD COLUMN cost_micro_usd integer, ADD COLUMN ms integer, ADD COLUMN counted boolean NOT NULL DEFAULT true;` and the `outcome` CHECK widened (drop and re-add the constraint by name with the longer list — the only allowed form of a CHECK change here, as it only allows more).

- [ ] **Step 1: Failing tests** in `reader.test.ts`: `a rate-limited read is logged and does not count against the day` (cap 1: rate-limited read, then an ok read → 200); `an unreadable read counts`; `every read is logged with outcome, reason, pages, tokens and cost`; `a failed read changes no price and no total` (receipt read failing → money unchanged); `a refused key tells the crew once` (two reads → one `pizza.reader.stopped`, `reason: key_rejected`, `user_ids` = crew); `out of credit tells the crew once per event day`; `GET /api/pizza/reader/reads?month= lists the month's reads with totals and needs admin.integrations.write` (403 without). In `topic.test.ts`: `the food registration has the reader.stopped trigger for the crew`.
- [ ] **Step 2: Run** `npx vitest run test/reader.test.ts test/topic.test.ts` — FAIL.
- [ ] **Step 3: Implement** D5–D7, D22: `takeReader` counts only `counted` rows of the day; `noteRead` sets `counted = false` for the non-billed outcomes; the event is written to the outbox in `noteRead`'s transaction.
- [ ] **Step 4: Run** — PASS. **Commit** `feat(pizza): every read logged with its cost; organisers told when the reader stops`.

### Task B4: The pages for errors and Integrations (items 2 for receipts, 11, 12)
**Files:** Modify `src/pages/receipt-views.ts`, `src/pages/money.ts` (the scan route), `src/pages/integrations.ts`, `money-messages*.ts`, `messages*.ts`; create `modules/pizza/static/progress.js` (the XHR sender, D11, used by C too) · Test `modules/pizza/test/pages-money.test.ts`, `modules/pizza/test/flows.browser.test.ts`

**Interfaces:** `readErrorView(c: PageCtx, e: { code: string; reason?: ReadReason; message: string; retry_after_s?: number }, ways: { retry: string; type: string; settings?: string }): Html` in a new `src/pages/read-errors.ts`, used by the receipt and menu pages: one text and way forward per row of the issue's table.

- [ ] **Step 1: Failing tests**: `pages-money.test.ts` one per row: `reader_off` → "type by hand" link; `reader_key_rejected` → message names that organisers were told; `out_of_credit` → the same; `reader_limit` → "crew can raise the cap" with a link to Food → Settings for `admin.settings.write`; `service_down` → Try again + type by hand; `timeout` → Try again; `unreadable` → the reader's reason and the photo tips; `declined` → type by hand; `415`/`413`/upload failed → message and try again; a partly read receipt → the check page with unsure lines marked (`pizza-unsure`). `pages-integrations` (in `pages-money.test.ts`): `Integrations lists this month's reads and their total`. Browser: `the receipt upload shows an upload bar, then "Reading…", then the check page`, and `a rate-limited read retries after a countdown`.
- [ ] **Step 2: Run** `npx vitest run test/pages-money.test.ts test/flows.browser.test.ts -t "read|Integrations"` — FAIL.
- [ ] **Step 3: Implement**; split `money-views.ts` if it passes 400 lines.
- [ ] **Step 4: Run** — PASS. **Step 5:** shots `food-receipt-progress`, `food-read-errors` (three cases), `admin-integrations-reads`, 390 and 1280 px. **Commit** `feat(pizza): read errors each with a reason and a way forward; the read log in Integrations`.

### Task B5: Contract
- [ ] `contracts/pizza.md` (The AI reader, Receipts) and `contracts/pizza/receipts.openapi.yaml`: D1, D3, D5, D6 (per Q2), D8 (per Q3), D22; `pizza.reader.stopped` in Events; `contracts/notify.md`'s `food` registration gains its trigger. Commit `docs(pizza): reader errors, the read log and upload sizes in the contract`.

---

## Part C — menu reading (items 1–5, 6 reading, 15)

### Task C1: The camera and several pages on the form (items 1, 15)
**Files:** Modify `src/pages/menu-read.ts` (split: `menu-read-views.ts` takes the views); `static/pizza.css` · Test `modules/pizza/test/pages-crew.test.ts`

- [ ] **Step 1: Failing tests**: `the menu read offers "Take a photo" with capture=environment on touch and "Attach images" on a pointer`; `"Add another page" appears after the first page, up to 6`; `the page shows the cost estimate for the pages chosen` (`about $0.0045` for 3 pages, from `PAGE_COST_MICRO_USD = 1500`); `a 7th page is refused with a message`.
- [ ] **Step 2: Run** `npx vitest run test/pages-crew.test.ts -t menu` — FAIL. **Step 3: Implement** with the receipt page's camera markup (`pizza-camera`, `pizza-drop`); thumbnails with move up/down and remove buttons in script, plain file inputs without. **Step 4: Run** — PASS. **Commit** `feat(pizza): the menu reader takes photos with the camera, up to 6 pages`.

### Task C2: One read, several pages, categories and flags (items 4, 5, 15)
**Files:** Modify `src/reader.ts`, `src/reader-schemas.ts`, `src/fake-reader.ts`, `src/reader-routes.ts` (split: `src/menu-read-route.ts`); create `src/menu-rows.ts` · Test create `modules/pizza/test/menu-rows.test.ts`; modify `test/reader-menu.test.ts`

**Interfaces:** in `reader.ts`:
```ts
export interface MenuRow { page: number; kind: "item" | "base" | "topping"; number: string | null; name: string; description: string | null; price_cents: number | null; category: string | null; category_price_cents: number | null; included_toppings: number | null; extra_topping_cents: number | null; tier: "normal" | "special" | null; unsure: boolean; price_from_category?: boolean; gathered?: boolean }
export interface MenuNote { kind: "campaign" | "lunch"; text: string; page: number }
export interface MenuRead { readable: boolean; reason: string | null; rows: MenuRow[]; notes: MenuNote[] }
```
in `menu-rows.ts`: `applyCategories(rows: MenuRow[]): MenuRow[]`, `gatherToppings(rows: MenuRow[]): MenuRow[]` (D15), `mergeRows(old: MenuRow[], added: MenuRow[]): { rows: MenuRow[]; conflicts: number[] }` (a row with the same number, or no number and the same folded name, is merged; a different price keeps the old and marks the index in `conflicts`), `rowsToCsv(pizzeria: string, rows: MenuRow[]): string`.

- [ ] **Step 1: Failing tests** in `menu-rows.test.ts`, on the synthetic fixture `test/fixtures/two-column-menu.ts` (a `MenuRead` as the model answers a two-column page: left column `Demo-/Kebab-/Kana-pizzat 13,90€` heading with four unpriced items, the heading's last two items at the top of the right column, a priced `Classics` category, a `Kampanja 14.6–15.9: all 11,90€` box, a lunch line, a "choose 3 toppings" item and an `Erikoistäytteet 2,50€` line): `an item without a price takes its category's price` (all six of the heading's items 1390, `price_from_category`); `a category continues into the right column and the next page`; `a priced item keeps its own price`; `campaign and lunch prices are flagged, never applied` (`notes.length === 2`, no row priced 1190); `the CSV carries category and category_price`; `a repeated number is merged and a conflicting price highlighted`. In `reader-menu.test.ts`: `three pages go to the reader in one call, in order` (the fake reader records `pages.length === 3` and the order); `the answer adds rows, notes and pages and keeps csv, items, unsure`; `a multipart read of 7 pages is 400`. The image for the stack's demo read is drawn by `test/images.ts` `twoColumnMenu()` (sharp from an SVG of the fixture's text) and the fake reader answers it with the fixture.
- [ ] **Step 2: Run** `npx vitest run test/menu-rows.test.ts test/reader-menu.test.ts` — FAIL.
- [ ] **Step 3: Implement**: the instructions (`MENU_TEXT`) gain the reading order, headings with prices, the campaign/lunch rule ("list them in notes, never as prices"), the own-pizza base ("choose N toppings") and the topping tiers; D9 multipart parsing with `@fastify/multipart` on the API route (parts `page`, at most 6, each 30 MB, each through `cleanPhoto`).
- [ ] **Step 4: Run** — PASS. **Commit** `feat(pizza): one menu read of several pages, with categories, their prices and flagged campaigns`.

### Task C3: The editable table (items 3, 6 confirm, 15 add more)
**Files:** Create `src/pages/menu-table.ts` (the table view and its form parsing); modify `src/pages/menu-read.ts`; create `static/menu-table.js` · Test `modules/pizza/test/pages-crew.test.ts`, `modules/pizza/test/flows.browser.test.ts`

**Interfaces:** `tableView(c: PageCtx, t: { rows: MenuRow[]; notes: MenuNote[]; conflicts: number[] }): Html`; `rowsOfForm(body: Record<string, string>): MenuRow[]` (fields `row[i][field]`); form actions `add`, `delete:<i>`, `merge:<i>:<j>`, `more` (with new photos), `check` (→ the import preview).

- [ ] **Step 1: Failing tests**: `the read shows a table: number, name, toppings, price, category, page per row`; `unsure values and conflicting prices carry pizza-unsure`; `price taken from a category is marked`; `gathered toppings show for the crew to confirm`; `add, delete and merge rows without a script` (POST each action, the re-rendered table); `"Add more pages" reads only the new photos and adds their rows, merging duplicates` (the fake reader is called with only the new pages); `"Check the import" posts the table as a menu CSV to the preview` (the preview names the pizzeria `matched` with the counts); `the CSV stays: download and paste still work`. Browser: `rows are added, deleted and merged in place with the script`.
- [ ] **Step 2: Run** `npx vitest run test/pages-crew.test.ts -t table` — FAIL. **Step 3: Implement**. **Step 4: Run** — PASS. **Commit** `feat(pizza): the menu read as an editable table`.

### Task C4: Real progress for the menu read (item 2)
**Files:** Modify `src/pages/menu-read.ts` (the NDJSON route, D11), `static/progress.js` (from B4) · Test `modules/pizza/test/flows.browser.test.ts`, `modules/pizza/test/pages-crew.test.ts`

- [ ] **Step 1: Failing tests**: `pages-crew.test.ts` `the read route answers NDJSON phases reading, checking, done when asked for it` (`Accept: application/x-ndjson`); browser `the menu read shows the upload bar, "Reading 3 pages (about 30 s)…", "Checking the prices…", then the table`, and `a read past the page's time limit shows the error with Try again` (fake reader with a delay marker, `timeoutFor` shortened through an env for tests only).
- [ ] **Step 2: Run** — FAIL. **Step 3: Implement**. **Step 4: Run** — PASS. **Step 5:** shots `crew-menu-read-pages` (thumbnails and the estimate), `crew-menu-read-progress`, `crew-menu-read-table`, `crew-menu-read-error`, 390 and 1280 px. **Commit** `feat(pizza): real progress while a menu is read`.

### Task C5: Menus keep categories and the own pizza's fields; contract
**Files:** migration (C's columns: `pizza_menu_entries ADD COLUMN category text, ADD COLUMN included_toppings integer CHECK (included_toppings BETWEEN 0 AND 10), ADD COLUMN extra_topping_cents integer CHECK (extra_topping_cents BETWEEN 0 AND 99999), ADD COLUMN tier text CHECK (tier IN ('normal','special'))`); modify `src/validate.ts` (`parseMenu`, `line`), `src/menus.ts`, `src/menu-csv.ts`, `src/export-csv.ts`, the profile loader for the `pizza` section; `contracts/pizza.md` (Pizzerias and menus, The menu CSV, The AI reader), `contracts/pizza/menus.openapi.yaml`, `contracts/pizza/receipts.openapi.yaml` (the menu read), `contracts/profile.md` (the pizza section) · Test `modules/pizza/test/menu-csv.test.ts`, `modules/pizza/test/menus.test.ts`

- [ ] **Step 1: Failing tests**: `menu-csv.test.ts` `category, category_price, included_toppings, extra_topping_price and tier import and export`; `an item without price takes category_price`; `tier must be normal or special`; `included_toppings only on a base`; `old CSVs without the new columns import as before`; `menus.test.ts` `a menu PUT keeps category, the base's fields and topping tiers`.
- [ ] **Step 2: Run** `npx vitest run test/menu-csv.test.ts test/menus.test.ts` — FAIL. **Step 3: Implement**. **Step 4: Run** — PASS. **Commit** `feat(pizza): menus keep categories, the own pizza's included toppings and topping tiers`.

---

## Part D — money (items 6 price, 8, 9)

### Task D1: The Fantasia price (item 6)
**Files:** Modify `src/validate.ts` (`snapshotOf`, `LIMITS.toppings = 6`), `src/pages/pick-views.ts` (the own-pizza tab: "includes 3 toppings", extra and special prices, the running price) · Test `modules/pizza/test/validate.test.ts`, `modules/pizza/test/pages-food.test.ts`

**Interfaces:** `ownPizzaPrice(base: { price_cents: number | null; included_toppings: number | null; extra_topping_cents: number | null }, chosen: { price_cents: number | null; tier: "normal" | "special" | null }[]): number | null` in `validate.ts`.

- [ ] **Step 1: Failing tests** with base 1000, N 3, extra 150, special 250: `three normal toppings cost the base` (1000); `five normal toppings cost two extras` (1300); `two normal and one special cost the base plus the special` (1250); `no included_toppings prices as before` (base + each topping's price); `a missing price makes the own pizza unpriced`; `six toppings are allowed, seven are not`; page: `the own-pizza tab says "includes 3 toppings" and the extra and special prices`.
- [ ] **Step 2: Run** `npx vitest run test/validate.test.ts test/pages-food.test.ts` — FAIL. **Step 3: Implement** (D14). **Step 4: Run** — PASS. **Step 5:** shot `food-own-pizza-fantasia`, 390 and 1280 px. **Commit** `feat(pizza): the Fantasia own pizza: included toppings, extra and special prices`.

### Task D2: The even-share limit (item 8)
**Files:** migration (D's column: `pizza_orders ADD COLUMN even_limit_cents integer CHECK (even_limit_cents BETWEEN 0 AND 99999)`); modify `src/money.ts` (split: `src/money-limit.ts`), `src/money-view.ts`, `src/lifecycle.ts` (store it at call-in), `src/pages/money-views.ts`, `src/pages/my-order-views.ts`, messages · Test `modules/pizza/test/money.test.ts`, `modules/pizza/test/money-routes.test.ts`, `modules/pizza/test/pages-money.test.ts`

**Interfaces:** `evenLimit(menuPrices: number[]): number | null` (`null` when empty; else `Math.round(avg × 1.3 / 10) × 10`); `amounts(order: { total_cents; split; even_limit_cents: number | null }, rows)` — `PersonAmount` gains `over_limit_cents: number`, `Amounts` gains `even_limit_cents: number | null`; the money view adds both (additive).

- [ ] **Step 1: Failing tests** in `money.test.ts`: `evenLimit of 1000, 1200, 1400 is 1560`; `evenLimit of no prices is null`; `an even split with a pizza over the limit: that person pays the share plus the part above` (total 4000, prices 1000, 1000, 2000, limit 1560 → surplus 440, share (4000 − 440)/3, Kim + 440; amounts add up to 4000 by the largest remainder); `the limit applies only to even` (exact unaffected); `no limit when no menu price` (`even_limit_cents: null`, plain even); `a limit larger than the share leaves even as it is`. `money-routes.test.ts`: `the order keeps the limit set at call-in after a menu edit`. `pages-money.test.ts`: `the page says "Even shares · €10.40 each · Kim +€2.10, over the limit"` and `"Even shares, no menu average" when there is none`.
- [ ] **Step 2: Run** `npx vitest run test/money.test.ts test/money-routes.test.ts test/pages-money.test.ts` — FAIL. **Step 3: Implement** (D17). **Step 4: Run** — PASS. **Step 5:** shot `food-money-even-over-limit` (holder and My order), 390 and 1280 px. **Commit** `feat(pizza): the even-share limit`.

### Task D3: Group receipt lines (item 9)
**Files:** Modify `src/receipt-match.ts` (split if over 400: `src/receipt-groups.ts`), `src/pages/receipt-views.ts`, messages · Test `modules/pizza/test/receipt-match.test.ts`, `modules/pizza/test/pages-money.test.ts`

**Interfaces:** `ReceiptMatch` gains `group_count_mismatch: { line: number; count: number; pizzas: number }[]`; `MatchedPizza` gains `group: boolean`.

- [ ] **Step 1: Failing tests**: `"15 × pizza €195" covers the 15 unnamed pizzas and keeps their menu prices` (each `suggested_cents === price_cents`, `group: true`, `extras_cents` includes 195 − Σ prices, `adds_up`); `"à €13,00" sets each pizza's price to 1300`; `a group count unlike the order's pizzas warns` (14 pizzas → `{count: 15, pizzas: 14}`); `named lines are matched before the group line`; page: `the check page shows the group line and its warning`.
- [ ] **Step 2: Run** `npx vitest run test/receipt-match.test.ts test/pages-money.test.ts` — FAIL. **Step 3: Implement** (D18). **Step 4: Run** — PASS. **Commit** `feat(pizza): a receipt's group line keeps menu prices and shares the difference`.

### Task D4: Contract and close
- [ ] `contracts/pizza.md` (Pizzas: the Fantasia price and 1 to 6 toppings; Money: the even-share limit; Receipts/The AI reader: group lines), `contracts/pizza/orders.openapi.yaml` and `receipts.openapi.yaml` (the new fields). Commit `docs(pizza): the Fantasia price, the even-share limit and group lines in the contract`.
- [ ] README's module description (`modules/pizza/README.md`) names the new files. Checks of every touched area, the repo checks (`scripts/check-naming`, `scripts/check-file-size`, `scripts/check-contracts`, `scripts/check-event-names`), the shots; the PR closes #789.

## Review focus
1. **A phone photo of 20–30 MB on a slow network** (no script, or a script that fails to shrink): the server must still answer within the page's time limit with a stored photo ≤ 1600 px, never an endless wait. B1 covers the size; add `a 30 MB PNG without a script is stored as a JPEG under 1600 px` to B1.
2. **A read retried while the first is still running** (double tap, the rate-limit retry): two reads may run; both are logged, and neither changes prices. B3: add `two reads of one receipt at once both log and neither touches the money`.
3. **The table posted back with a row removed by someone else's import meanwhile** (two crew on one pizzeria): the import's preview is the guard; C3: add `"Check the import" after another import shows the preview's counts, never applies`.
4. **An order called in before its pizzeria had any price, priced later:** the limit stored at call-in is null; D2: add `a limit is computed live while the stored one is null and the menu now has prices`.
5. **Finnish menus and receipts** (decimal commas, "à", "€" before or after, "ja" in toppings): D3 and C2 tests use Finnish forms (`13,90€`, `à 13,00 €`, `kinkku, ananas ja aurajuusto`).

## After the plan
The maintainer answers Q1–Q4 and accepts this plan. The worker then runs `execute` on the parts in order, each test first, with the module's checks (`npm run lint`, `npm run typecheck`, the touched test files) and the repo checks (`scripts/check-naming`, `scripts/check-file-size`, `scripts/check-contracts`, `scripts/check-event-names`) before each push, and the shots named in each part.
