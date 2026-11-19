# Step 5 question bank

Every open question the research for [the step 5 brief](../step-5-pizza.md) found, grouped by theme, each with its options and a recommendation, for the product owner's brainstorming session (#116). IDs are stable, so the session can answer "D1: A" and the mockups can point here.

The themes: **U** who uses it and how · **L** look and feel · **D** data and integrations · **E** edge cases and failure · **O** operations and scale · **P** plan and scope.

**Decide first** (they change the most): P1 (the direction), D1 (several open orders at once), U3 (a close time that closes the order), U4 (hand-out and done), D8 (the bill total), D9 (who sees what), P2 (the issue set), P3 (the exit criterion).

**Already decided, so not asked again:** no payments and no service-order engine ([0022](../../decisions/0022-product-vision.md)); pizzerias and menus per event, loaded from the event profile ([TG12, DR11](../../legacy-inventory/README.md#conflicts-with-the-decision-records)); sign-in instead of tokens in URLs ([0010](../../decisions/0010-scope.md), #117); the attendee is a member who joined at the venue or with the event's link ([0027](../../decisions/0027-product-decisions-2026-11-07-08.md)); the Pizza last call and Pizza orders ready stories and the `pizza` rule (step 4's plan, built); Notify's `food` topic (built).

A question marked **contract** needs a contract change if the recommendation is taken. Every such change here is additive, so it ships in the package whose code uses it ([0029](../../decisions/0029-additive-contracts-ship-with-consumers.md)); D1 names the one catalog sentence that changes meaning, and why it is still not a breaking change.

## U · Who uses it and how

### U1. Who holds an order?
- **A.** An attendee: whoever opens it, or takes it over (the legacy model). The crew may step in.
- **B.** Always a crew member; attendees only add pizzas.
- **Recommendation: A.** The legacy plan's "who orders, from where and when is decided on the spot" worked at real events; B puts the work on the crew at their busiest hour (direction B in the brief). A crew-run event gets B's feel through U2's "crew only" setting.

### U2. Who may start an order?
- **A.** Anyone who joined the event (the default), with a per-event setting "crew only" that limits opening to the right `pizza.order.open`.
- **B.** Anyone who joined, always.
- **C.** Crew only, always.
- **Recommendation: A.** Spontaneous by default, structured when an organiser wants fixed food rounds ([mockup 06](06-start-order.svg), [17](17-food-settings.svg)). One setting, no second flow.

### U3. What does an order's time mean?
The legacy `target_at` was a "calling around" hint: ordering stayed open until the holder closed it, and reminders came 30 and 60 minutes past it. Step 4 then added `pizza.order.closing` with a `closes_at`, which Moments' Pizza last call waits for.
- **A.** A close time: a last call 10 minutes before (`pizza.order.closing`), and the order closes by itself at the time unless the holder already did. Auto-close is a setting, on by default. The holder may move the time while open.
- **B.** The legacy hint: no auto-close; `closes_at` = `target_at` only for the last call; the "open past target" reminders stay.
- **C.** No time at all.
- **Recommendation: A.** People ask one thing, "until when can I add?", and the screen's last call only makes sense if the time holds. With auto-close the "open past target" reminder becomes rare; it stays for events that turn auto-close off ([mockup 15](15-reminders.svg)). **Contract:** `closes_at` on the Order (additive).

### U4. Hand-out: who, and when is an order done?
The roadmap's goal says "the crew hands it out"; the legacy stopped at "placed".
- **A.** After "It's here" the holder ticks people off (crew with `pizza.order.manage` may too, attendees may tick themselves, U9). The order is **done** when everyone is ticked, when the holder taps Done, or after a set time (O7).
- **B.** The crew hands out at a counter; the holder's job ends at "It's here".
- **C.** No hand-out step: `arrived` is the end.
- **Recommendation: A.** It closes the loop the legacy left open (who still has a pizza waiting) at the cost of one list ([mockup 09](09-hand-out.svg)). **Contract:** `done` (D3).

### U5. What do venue staff get?
At a venue, the delivery often reaches the door, a bar or the crew first, not the holder.
- **A.** A door helper on the crew's Food page: pick the pizzeria, see the order, its holder and pickup place, and mark it arrived for the holder (`pizza.order.manage`).
- **B.** Nothing: the delivery asks for the holder.
- **Recommendation: A.** It is the only moment venue staff touch food, and today it is a shout across the hall ([mockup 10](10-crew-food-page.svg)).

### U6. "The same again"?
- **A.** On the menu, the person's last pizza from this pizzeria at this event, one tap to add.
- **B.** Favourites the person saves.
- **C.** Nothing.
- **Recommendation: A.** At a three-day event most people order the same thing twice; A needs no new data (their earlier rows) and nothing across events ([mockup 04](04-menu-and-add.svg)).

### U7. Pizzas in several orders at once?
- **A.** Yes: a person may add to any open order (for example lunch for a friend from another pizzeria).
- **B.** One order at a time per person.
- **Recommendation: A.** No reason to forbid it; each order's list stays its own.

### U8. The pizzeria's estimate at call-in?
- **A.** Optional chips (30, 45, 60 minutes, don't know) when the holder marks it called in; it shows as "about 19:31".
- **B.** Required.
- **C.** None.
- **Recommendation: A.** It answers "when does it come?", the question the holder gets most, without forcing a guess ([mockup 08](08-call-mode.svg)). **Contract:** `estimate_at` on the Order (additive, null when not given).

### U9. May attendees tick "I've got mine"?
- **A.** Yes, optional; it ticks the same box as the holder.
- **B.** Only the holder or crew tick.
- **Recommendation: A.** It spreads the work; the holder still sees the list.

### U10. Who hears a reminder?
- **A.** The holder at +30, the holder and the crew at +60 (both per-event settings); auto-release at 2 h tells the crew.
- **B.** The holder only (the legacy, through a Discord mention).
- **C.** The crew from the first reminder.
- **Recommendation: A.** The holder is a volunteer; after an hour someone with the right to step in should know ([mockup 15](15-reminders.svg)).

### U11. A called-in order that never "arrives"?
Without it, a forgotten order says "on the way" on every phone and screen for the rest of the night.
- **A.** 30 minutes past the estimate (or 90 minutes after call-in without one) the holder gets "Has order 3 arrived?"; after 3 hours a placed order leaves the screen's box.
- **B.** Nothing.
- **Recommendation: A.** Cheap with the scheduler that #118 builds anyway.

### U12. Who sees the "paid the holder" tick?
- **A.** The holder and the crew; each person sees only their own ("Player Three has your payment marked").
- **B.** The holder and the crew only.
- **C.** Everyone in the order.
- **Recommendation: A.** People like to know they are marked; nobody else needs to ([mockup 09](09-hand-out.svg)).

### U13. Who paid the pizzeria (the payer)?
- **A.** The holder by default, changeable at call-in; the crew can correct it later (audited). The legacy rule.
- **B.** Always the holder.
- **Recommendation: A.** The legacy "an admin placed leaves the payer empty" bug (problem 16) goes with it: the payer is always set.

### U14. Editing after close?
- **A.** The pizza's owner edits while open; after close the holder and the crew may edit (the pizzeria said "no #7 today"), audited, and the owner is told.
- **B.** Nobody after close.
- **Recommendation: A.** The legacy allowed holder and admin edits; the audit and the owner's notice are new.

### U15. What does a guest see?
- **A.** What the screen already shows, following the info-page mode: open orders, pizzeria, close time and counts; no names; "sign in to order".
- **B.** Nothing; sign in first.
- **Recommendation: A.** The screen's QR brings guests to the page; a blank wall loses them ([mockup 03](03-open-orders.svg)).

### U16. Ordering for someone without an account?
- **A.** The comment field ("one is for a friend"), as the legacy.
- **B.** A "for" name on each pizza.
- **Recommendation: A.** The legacy's answer was enough; B adds a personal-data field for little.

### U17. Desktop?
- **A.** Attendee pages phone-first and fine on desktop (#119); the crew page desktop and phone both.
- **Recommendation: A.**

### U18. How many pizzas may one person add to one order?
- **A.** A per-event cap, 5 by default.
- **B.** No cap (the legacy).
- **Recommendation: A.** A joke of 40 pizzas costs the holder a phone call; a cap costs nobody anything (E14).

## L · Look and feel

### L1. The pages' look?
- **A.** The event's theme through `packages/ui` in the hub's frame (App track D2), sheet 7's "the event up front, one task per page" style; no pizza mascot.
- **B.** A food look of its own (the legacy's banner, mascot and fonts).
- **Recommendation: A.** One app for the attendee; the legacy theme was an event's brand, which belongs in the event repo.

### L2. Where does Food live in the hub?
- **A.** A card in For you while you have a pizza in an order, Food in More, the screen's QR straight to the page; no tab of its own (App track L2).
- **B.** A Food tab.
- **Recommendation: A**, as the App track recommends; this pack follows whatever that session decides.

### L3. The screen's food box when nothing is happening?
- **A.** Hidden (the widget's empty state); the layout fills the space, as step 3's widgets do.
- **B.** "No food order open · start one in the hub".
- **Recommendation: A.** A quiet hall screen is better than an advert; Moments' preset 10 already announces an order when one opens.

### L4. The status words?
- **A.** Open · Closed (being called) · Called in · On the way · Pizza is here · Done, in Finnish and English.
- **B.** The legacy's Open · Closed · Ordered · Cancelled.
- **Recommendation: A** ([mockup 05](05-my-order.svg)); the contract keeps its state names (`placed`, `arrived`).

### L5. A celebration on the phone at arrival?
- **A.** No: a calm card and the push; the screen celebrates (preset 21).
- **B.** Confetti on the page.
- **Recommendation: A** (App track L3: the hub is calm).

### L6. Where does the screen's QR land?
- **A.** On the only open order's menu when one is open; on the list when several are.
- **B.** Always on the list.
- **Recommendation: A.** One tap fewer for the common case ([mockup 02](02-flow-qr-to-order.svg)).

### L7. Call mode?
- **A.** Large type, one line per kind with its count, notes under the line, tick as you read, Copy as text, tap to call ([mockup 08](08-call-mode.svg)).
- **B.** The legacy summary as it is, small type.
- **Recommendation: A.** The same summary data, read in a noisy hall.

### L8. Holder names on the venue screen?
- **A.** Shown (they are event-wide `public` in the catalog), with a per-event setting to hide them.
- **B.** Never.
- **Recommendation: A.** "Collect from Demo Player" is useful in the hall; the setting serves events that prefer not to.

### L9. Sound?
- **A.** No new sounds: Moments' existing `pizza.open`, `pizza.closed`, `pizza.placed` cues and the presets' stings.
- **Recommendation: A.**

## D · Data and integrations

### D1. One open order per event, or several?
The catalog says "one open order at a time per event" ([events.md](../../../contracts/events.md#pizza)); #117 asks for "more than one … (for example per pizzeria)".
- **A.** One open order per pizzeria, several at once (a partial unique index on event and pizzeria). A person holds at most one open order (E14).
- **B.** Any number, even two for one pizzeria.
- **C.** One per event, as the legacy.
- **Recommendation: A.** Two groups wanting two pizzerias is the legacy's commonest wait; two orders to one pizzeria is the confusion C was meant to stop. **Contract:** the catalog sentence changes to "one open order per pizzeria". No name or field is removed or renamed and every consumer already keys on the order's `id` (Moments' stories, the `pizza` rule), so it is not a breaking change under [contracts/README.md](../../../contracts/README.md#changing-a-contract); the reviewer of the #117 package confirms that, and if the maintainer sees it otherwise it becomes its own PR first.

### D2. The screen's `food_status` with several orders?
- **A.** Additive `orders` (a list of the current fields per order, most urgent first); the existing top-level fields stay as the first order's, so templates written for one order still work.
- **B.** One widget per order.
- **C.** Only the most urgent order.
- **Recommendation: A** ([mockup 14](14-screen-and-moments.svg)). **Contract** (screen.md, additive).

### D3. A `done` state?
- **A.** `done` as a new `state` value and `pizza.order.done` as a new event (everyone handed out, the holder's Done, or the timer). Moments' preset 21 may end on it, as its catalogue foresaw.
- **B.** No state: hand-out ticks only; `arrived` stays final.
- **Recommendation: A.** The screen box, the hub card and the record need to know an order is over. A new value in an enum is additive by the contracts' rule ("clients ignore what they do not know"), but each consumer of `state` (Screen's template, Moments' fills) is checked in the package. **Contract** (additive).

### D4. Order numbers?
- **A.** `seq` per event day in the event's time zone, the day turning at 06:00 (as Screen's "today in numbers"), so a night past midnight keeps its numbers.
- **B.** Per calendar date (the legacy).
- **C.** Per event, never reset.
- **Recommendation: A.** The catalog's "its number of the day" holds, and 01:00 orders stop being "order 1" of a new day (E8).

### D5. Which rights?
- **A.** `pizza.order.open` (start an order when "crew only" is set), `pizza.order.manage` (step in on any order: take over, release, cancel, undo, edit after close, correct the payer, mark arrived), `pizza.menu.write` (pizzerias and menus), `pizza.record.read` (the daily record and CSV). Settings save through admin's API (`admin.settings.write`).
- **B.** One right, `pizza.admin`.
- **Recommendation: A.** A door volunteer needs `manage` but not the menus; a treasurer needs the record and nothing else. Defined and tested in the #117 package (P5).

### D6. Delivery or takeaway?
- **A.** A per-pizzeria flag; for takeaway the checklist says "fetch" and the estimate means "ready at".
- **B.** Delivery only.
- **Recommendation: A.** A small flag, real at venues near a grill ([mockup 06](06-start-order.svg)).

### D7. Prices on the menu?
- **A.** No prices (the legacy decision): no totals, nothing to keep current.
- **B.** An optional price per item, shown as a hint and summed per person.
- **Recommendation: A.** Prices change and would make the app look like a shop that takes money (0022). The holder tells people what they owe.

### D8. The bill total?
The legacy kept each order's bill (entered by the payer, holder or admin) for an after-event bill system that reads the CSV.
- **A.** Keep it: the payer, holder or crew enter the total after call-in; shown only to them and in the record and CSV.
- **B.** Drop it: the record keeps the payer and who had what.
- **Recommendation: A**, if the organisers still settle food after the event (the CSV is the only reason the record exists). It is a sum, not a payment, but it is money data, so the package that adds it is high risk (it is anyway, P5). Ask the product owner whether that bill system is still in use.

### D9. Who sees what in an order?
- **A.** Members see each order's pizzeria, times, holder and counts, and its pizzas **without names** ("3 × #12 Kebab"); a person sees their own rows in full; the holder and the crew see names, notes and comments; guests see counts only (U15).
- **B.** Members see everything but comments (the legacy showed everyone's list to anyone).
- **C.** Members see counts only.
- **Recommendation: A.** "What are the others having?" helps people choose; who had what is personal data (#117: comments only for the order's members and the crew; A keeps them for the holder and the crew, which is narrower).

### D10. Reading a menu from a photo?
- **A.** Later: the paste-a-text import and the profile cover step 5.
- **B.** In step 5.
- **Recommendation: A** (the legacy filed it as an idea; it needs an external model).

### D11. Pizzerias in the event profile?
- **A.** A `pizza` section in the profile with `pizzerias` (name, phone, delivery, base name, menu items with number, name and ingredients, toppings), loaded with the profile and copied by clone.
- **B.** Only the UI.
- **Recommendation: A.** TG12 already chose the profile; the demo event gets two placeholder pizzerias (the lead's note on #116). **Contract** (profile.md, additive).

### D12. Which pushes does Food send?
Notify's `food` topic today: the event part on `pizza.order.opened` and `.closed` (off by default), the personal part on `.arrived`.
- **A.** Add to the event part `pizza.order.closing` (last call); to the personal part `pizza.order.cancelled` (its people), the holder's reminders, and the hand-out nudge (once per order).
- **B.** Leave the topic as it is.
- **Recommendation: A.** Each is a message a person needs; the nudge and reminders name their recipient with `user_id` at the top of `data` (events.md's rule), which `pizza.reminder.triggered` does not have yet. **Contract** (events.md and notify.md, additive).

### D13. How do pages stay live?
- **A.** A server-sent event stream from the pizza module, per page, filtered server-side to what the caller may see, built like Screen's push channel; a page reconnects and re-reads the order.
- **B.** The hub's service worker relays pushes.
- **Recommendation: A.** #119 asks for push without polling; Screen already proved the pattern.

### D14. The caller's own orders (the lead's step 2 note)?
- **A.** `GET /api/pizza/me/orders` (this event's orders with the caller's rows and status) and, if the App track takes D18, `GET /api/pizza/me/summary` (cards for For you).
- **Recommendation: A** ([mockup 05](05-my-order.svg)). **Contract** (pizza.md, new).

### D15. Snapshots of menu items?
- **A.** Each pizza row stores the label, number and ingredients as ordered; menu edits never rewrite old rows (legacy problem 16).
- **B.** Rows point at live items (the legacy).
- **Recommendation: A.**

### D16. History of an order?
- **A.** The order's own log (the legacy `pizza_order_log`, ported) drives the order's history on the crew page; crew overrides also go to the tenants audit log with before and after.
- **B.** Only the audit log.
- **Recommendation: A.** The log is the order's story for its page; the audit is the platform's record of who overrode whom (N6).

### D17. Hard delete?
- **A.** None: cancel is the end of an order; personal data goes by the retention rules (O6).
- **B.** A logged hard delete for the crew (the legacy had an unlogged one).
- **Recommendation: A.** The legacy delete lost the audit trail (problem 15).

### D18. Demo data?
- **A.** Two placeholder pizzerias in `events/demo/profile.yaml`; demo orders made by the stack's screenshot script through the API, so CI shows every state.
- **B.** Demo orders in the profile.
- **Recommendation: A.** Orders are runtime data; the profile holds setup (the lead's note on #116).

## E · Edge cases and failure

### E1. Two people claim (or take over) at once?
- **A.** One conditional update wins; the other gets 409 `claimed` with the holder and since when (the legacy's), shown as "Player Three holds this order".
- **Recommendation: A**, with a race test (#117).

### E2. Double taps and retries?
- **A.** Every write carries an idempotency key (as Moments' crew actions); a repeated close, call-in or arrived is a no-op, never a second event.
- **Recommendation: A.** The legacy's double "placed" posted twice (problem 15).

### E3. The order closes while someone is choosing?
- **A.** 409 `closed` with the other open orders: "Order 2 closed at 18:31 · add it to order 3?" ([mockup 16](16-edge-states.svg)).
- **Recommendation: A.**

### E4. The holder vanishes?
- **A.** Auto-close at the close time (U3); reminders (U10); auto-release 2 h after close (legacy); the crew can take over at any time.
- **Recommendation: A.**

### E5. The holder leaves the event or deletes their account?
- **A.** Their holds are released (reason `released`, actor null); pizzas they added to open orders are removed (they can no longer collect), those in placed orders stay; account deletion anonymises them like any personal data.
- **Recommendation: A.**

### E6. The pizzeria does not answer, or is closed?
- **A.** The holder (or crew) cancels with a reason ("the pizzeria is closed today"); everyone in it is told (D12) and can add to another order.
- **B.** Switch the order to another pizzeria.
- **Recommendation: A.** Menus differ, so B would turn every row into "Other"; the legacy refused a pizzeria change once pizzas were in (409 `has_pizzas`).

### E7. The menu changes during an order?
- **A.** Rows keep their snapshot (D15); a removed item stays in open orders and is hidden from new picks.
- **Recommendation: A.**

### E8. Midnight and daylight saving?
- **A.** Times stored in UTC, shown in the event's time zone; the day for `seq` and the record turns at 06:00 local (D4); the legacy's DST tests carried over.
- **Recommendation: A.**

### E9. An empty order at its close time?
- **A.** Cancelled by the scheduler (reason `cancelled`, actor null), and Moments' preset 10 ends with it.
- **B.** Closed like any other.
- **Recommendation: A.** No one calls a pizzeria for nothing.

### E10. An order left open from an earlier day?
- **A.** With auto-close it cannot happen; with auto-close off, any member may cancel it as stale (the legacy rule), and it blocks nothing (D1).
- **Recommendation: A.**

### E11. The event is archived with orders open?
- **A.** Open and closed orders are cancelled (reason `cancelled`, actor null); due reminders are dropped.
- **Recommendation: A.**

### E12. The bus is down when an order changes?
- **A.** The kit's outbox: the event is stored in the write's transaction and sent once it commits; nothing is lost or sent twice.
- **Recommendation: A.**

### E13. A person without a Discord id in the payloads?
- **A.** `discord_user_id` null, as the Person shape allows; the bot (step 6) falls back to the name.
- **Recommendation: A.**

### E14. Pranks and spam?
- **A.** A person holds at most one open order; at most N open orders per event (O5); at most N pizzas per person per order (U18); the crew cancels with a reason.
- **Recommendation: A.**

### E15. A person who is not a member?
- **A.** Signed in but not a member: "Join Demo Event to order", linking to the tenants module's join flow ([mockup 16](16-edge-states.svg)).
- **Recommendation: A.**

### E16. Offline for a moment?
- **A.** The page keeps the last state with a "Reconnecting…" banner; a write is retried with the same idempotency key, and the person sees whether it landed.
- **Recommendation: A.**

## O · Operations and scale

### O1. Load at a large event?
- **A.** Plan for 2,000 members and a dinner spike of a few hundred joins in ten minutes: short transactions, one stream per open page with server-side filtering, counts carried by events (`revision`), no polling anywhere.
- **Recommendation: A.** The load harness is in the backlog (0022); the race tests stand in for it.

### O2. The scheduler?
- **A.** Inside the pizza container: due steps as rows in Postgres, a tick every 30 s, each due row taken with a row lock (`FOR UPDATE SKIP LOCKED`), marked sent only after delivery (the legacy rule), so a restart or a second replica never loses or doubles one.
- **Recommendation: A.** No cron in a container (#118).

### O3. Turning ordering off?
- **A.** The existing setting `ordering_open` (the demo profile already sets it) plus a note shown on the Food page.
- **Recommendation: A** ([mockup 03](03-open-orders.svg)).

### O4. Where do pizzerias come from?
- **A.** The event profile at load, then the Food page; clone-the-last-event copies them (tenants.md already lists pizzerias in clone).
- **Recommendation: A.**

### O5. How many open orders at once?
- **A.** A setting, 3 by default.
- **Recommendation: A.**

### O6. Retention and privacy?
- **A.** Orders, rows, comments, ticks and the payer are `personal` data: in the privacy export, deleted or anonymised on request and 12 months after archiving; totals and counts stay (0027). No `presence` data.
- **Recommendation: A.** **Contract** (pizza.md names its data classes).

### O7. When is an order done without hand-out ticks?
- **A.** 2 h after arrival (a setting); open or placed orders are covered by U3 and U11.
- **Recommendation: A.**

### O8. Health?
- **A.** The module's `/health` reports the scheduler's lag (the oldest due step not yet run); admin's Health page shows it.
- **Recommendation: A.**

### O9. Two events at one venue at once?
- **A.** Nothing special: each event has its own pizzerias, orders and numbers (per tenant, RLS).
- **Recommendation: A.**

### O10. The after-event record?
- **A.** The CSV as the legacy (BOM, `;`, decimal comma, placed orders only, one row per participant), per day and for the whole event, read with `pizza.record.read`; in the tenant's export (TH3).
- **Recommendation: A** ([mockup 12](12-daily-record.svg)).

## P · Plan and scope

### P1. The direction?
- **A.** The group order, as it was (a faithful port).
- **B.** The food desk (crew-run).
- **C.** Group order, effortless (the legacy model with its edges fixed).
- **Recommendation: C** ([mockup 01](01-directions.svg), the brief's argument).

### P2. The issue set?
- **A.** Keep #117, #118 and #119, rewritten as the brief proposes, and add one issue for Screen's food box and Notify's food triggers.
- **B.** Keep the three as they are.
- **Recommendation: A** (the brief's [Proposed issue changes](../step-5-pizza.md#proposed-issue-changes)).

### P3. The exit criterion?
The roadmap's OC2 proposed moving "shows on the screen" to step 9, because Screen consumed no pizza events then. Step 4 since built Moments' pizza rule and three pizza stories, and Screen draws `food_status`.
- **A.** Keep "an order runs end to end and shows on the screen": the stories light up with step 5's events, and the new issue feeds the food box.
- **B.** OC2's split: step 5 "publishes `pizza.order.*`", step 9 "shows on the screen".
- **Recommendation: A** ([mockup 14](14-screen-and-moments.svg)).

### P4. The order of the work?
- **A.** #117 first (contract, lifecycle, rights); then #118 and #119 in parallel; the new screen and notify issue after #117 (it needs the events only).
- **Recommendation: A** (the brief's [order sketch](../step-5-pizza.md#order-a-sketch-for-the-planner)).

### P5. Risk classes?
- **A.** #117 high (personal data, sign-in identity, rights, and the bill if D8 is A), and it defines and tests every `pizza.*` right, so #118 and #119 only use them and stay normal; the new issue normal.
- **B.** As the issues say today (#118 normal while it defines rights).
- **Recommendation: A.** Rights code is high by the merge rules; putting all of it in #117 keeps one accept for the step.

### P6. What stays out of step 5?
- **A.** The bot's posts and `/pizza` commands (step 6); payments, prices and a service-order engine (0022); reading menus from photos (D10); sizes; any pizzeria's own online-ordering integration.
- **Recommendation: A.**

### P7. Pizza or Food?
- **A.** The module and its contract stay `pizza`; what people see says "Food" (the hub's card, the page, the screen box, the topic's title is already "Food"), since any restaurant with a menu fits.
- **B.** "Pizza" everywhere.
- **Recommendation: A.** No rename of anything in a contract; only words people read.

### P8. The roadmap's text?
The step's "In it" says "ported as it is"; [0022](../../decisions/0022-product-vision.md) says "the pizza flow is ported as it is" in the sense "no service-order engine".
- **A.** A roadmap note: the step keeps the legacy model and builds no engine, and polishes its edges (several orders, a close time, hand-out, crew tools).
- **Recommendation: A** (a `Roadmap note:` in this PR; the lead updates the text after the session).
