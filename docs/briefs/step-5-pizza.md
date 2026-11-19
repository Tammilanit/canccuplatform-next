# Step 5 brief: Pizza (research pack)

The research pack for the product owner's brainstorming session on [step 5, Pizza](../roadmap.md#5-pizza) (epic #59), issue #116. It follows the [outline of a research pack](README.md#outline-of-a-research-pack) and the lead's comments on #116 (2026-11-07: the step 2 notes; 2026-11-08: a research pack with every key screen mocked up, a full question bank, and the issues as input). After this merges, the lead runs the session over as many rounds as it takes, writes the final plan into this brief (`## Plan`) and rewrites the step's issues; the product owner accepts the plan before any build starts.

**In this pack**
- This file: goal, what was read, what earlier steps already built, how others solve it, three directions and the recommended one, the key flows, port / drop / invent, the lead's notes, proposed issue changes and exit criteria.
- [step-5-pizza/questions.md](step-5-pizza/questions.md): the question bank, 79 questions in six themes, each with options and a recommendation. IDs (U3, D1, …) are used throughout.
- [step-5-pizza/](step-5-pizza/): 17 SVG mockups, drawn new, with the demo event only. GitHub shows them inline below. Attendee and holder pages are drawn in the demo theme's "Demo night" colours, as the hub takes the event's theme; organiser pages in the admin look.

## Goal
Players order food together and the crew hands it out, end to end ([roadmap](../roadmap.md#5-pizza)). The roadmap's "In it": the ordering flow, ported as it is (no general service-order engine, [0022](../decisions/0022-product-vision.md)), built on the legacy pizza router and its tests; events `pizza.order.*`; a transaction for claims; a scheduler for reminders. Exit: an order runs end to end and shows on the screen.

The step's three build issues: #117 (the contract and the group-order lifecycle), #118 (reminders, the holder's workflow and crew tools), #119 (the attendee's ordering pages, mobile-first). This pack treats them as input ([P2](step-5-pizza/questions.md#p2-the-issue-set)).

## What was read
- **Decisions:** [0022](../decisions/0022-product-vision.md) (the vision: no payments, "a service-order engine" not planned, "the pizza flow is ported as it is"; the large event of 1,000–2,000), [0027](../decisions/0027-product-decisions-2026-11-07-08.md) (joining by venue, link or QR; every account a Discord account; 12-month anonymisation), [0020](../decisions/0020-best-of-old-freely-new.md) (the best of the old, freely new), [0013](../decisions/0013-multi-tenant-core.md) (every singleton per tenant), [0010](../decisions/0010-scope.md) (no tokens in URLs), [0003](../decisions/0003-event-content-scrubbed.md) (menus are event content), [0026](../decisions/0026-briefs-are-research-packs.md) and [0029](../decisions/0029-additive-contracts-ship-with-consumers.md).
- **The roadmap:** [step 5](../roadmap.md#5-pizza), and order change OC2 ("shows on the screen" needs Screen's pizza consumer, step 9) under [Changes of order](../roadmap.md#building-on-the-legacy).
- **Legacy inventories:** the [signup site](../legacy-inventory/signup-site.md) (P1–P13, the pizza API table, the order log's entry kinds, the reminder cron, the tests, known problems 9, 14, 15 and 16), the [summary](../legacy-inventory/README.md) (the port rows, TA3, TB1, TG12, TH3, DR3, DR11, N6, N7, N8, flow 1, OC2), [canccusignage](../legacy-inventory/canccusignage.md) (the pizza ticker and cues), [canccubot](../legacy-inventory/canccubot.md) (`/pizza order`, `/pizza claim`).
- **The legacy itself** (read-only): the signup site's pizza context, its v1 plan and design rules (one open order, the holder, the note versus the comment, menu numbers, one size, no prices, the bill system's CSV), `src/lib/pizza/` (router, validate, menu filter, summary, reminders, report), the orderer page's checklist, and the tests' names and coverage.
- **Contracts it builds on:** [events.md](../../contracts/events.md#pizza) (the provisional Order and `pizza.*` events, Person, personal events), [moments.md](../../contracts/moments.md) (the `pizza` rule, presets 10, 20 and 21, domain triggers), [screen.md](../../contracts/screen.md#widgets) (`food_status`, names on a screen), [notify.md](../../contracts/notify.md) (the `food` topic; "Your order" in the hub), [tenants.md](../../contracts/tenants.md) (members, guests, info-page mode, rights, clone, privacy and retention, audit), [admin.md](../../contracts/admin.md#settings) (settings), [profile.md](../../contracts/profile.md) (the event profile), [bot.md](../../contracts/bot.md) (commands under a module's flag).
- **Briefs and design:** step 4's plan and its [storyboards](step-4-moments/storyboards.md) (the pizza presets and "one happening has one owner"), the [App track pack](track-app.md) (D2 module pages in the hub's frame, L2 no Food tab, D18 `me/summary`), the [design guideline](../design/README.md) (sheet 7 for attendee pages, [widgets.md](../design/widgets.md) `food_status`).
- **The epic and its issues:** #59, #116 with the lead's two comments, #117, #118, #119.

## What earlier steps already built
More of step 5 is waiting for it than the roadmap's text suggests.
- **Moments (step 4)** has the built-in `pizza` rule (a rail card and the `pizza.placed` cue on `pizza.order.placed`) and three stories that fire on pizza events: preset 10 "Pizza order open" (with a QR to the hub), preset 20 "Pizza last call" (waits for `pizza.order.closing`, which the catalog added for it) and preset 21 "Pizza orders ready" (on `pizza.order.arrived`). They are on by default and idle until the pizza module emits.
- **Screen (step 3)** has the `food_status` widget's template, its slot in the layouts and its view-model in the contract, but nothing feeds it yet.
- **Notify (step 3)** registers the `food` topic: its event part on `pizza.order.opened` and `.closed`, its personal part on `.arrived`.
- **The catalog** has the provisional Order, ten `pizza.order.*` events, two `pizza.item.*` events and `pizza.reminder.triggered`, with examples on the demo event.
- **The kit** has the outbox (events sent only after the write commits), the settings client, the rights check and tenant transactions. **The tenants contract** already lists pizzerias among what clone-the-last-event copies. **The demo profile** turns the pizza module on and has an `ordering_open` setting.
- **Not built:** the pizza module itself (an empty folder), its contract, the central sign-in's PWA round trip (#52) and joining (#150), and the bot (step 6).

So the step's exit, "an order shows on the screen", is in reach in step 5 itself ([P3](step-5-pizza/questions.md#p3-the-exit-criterion)).

## How comparable products solve it
| Field | What they do | What we take |
|---|---|---|
| **Group ordering in delivery apps** (a shared cart one person opens) | A host starts a cart and shares a link; each person adds their own items; the host locks the cart and checks out; a deadline shows on the cart | The legacy already had this shape: an opener who holds, people add their own rows, a close. We add the deadline that holds (U3), the lock with a last call, and "the same again" (U6) |
| **Office lunch tools and chat bots** (daily lunch rounds) | Fixed rounds ("orders close at 11:00"), a summary for whoever calls, reminders to latecomers | The summary for the call is the legacy's best part (call mode, L7); fixed rounds become a setting, not the default (U2) |
| **Delivery tracking** | A status timeline with an estimate: confirmed, preparing, on the way, delivered; a push at each step that matters | Four plain steps and "about 19:31" (U8), pushes only for last call and arrival (D12) ([mockup 05](step-5-pizza/05-my-order.svg)) |
| **Order-ready boards and pagers** (food courts, cafés) | A number on a board and a buzz when it is ready; collection at one counter | "Pizza is here: order 2" on the screens (preset 21, built) and a pickup place in the push ([mockup 09](step-5-pizza/09-hand-out.svg)) |
| **Bill-splitting apps** | Who paid, who owes whom, settle up | Only the smallest part: the payer and a "paid me" tick, no amounts or settling (0022, U12) |
| **Stadium in-seat ordering** | Order from a seat through a QR, pay in the app, collect | The QR to a page that works at once; not the payment or the shop (0022) |

The lesson across them: the good ones make **one person's job easy** (the host's cart, the caller's summary), **say when it ends** (a deadline that holds), and **close the loop** (an estimate, "it's here", collected). The legacy did the first well and stopped before the other two.

## Three directions
The same moment in each: 18:10 on Saturday, two groups want food from two pizzerias, and order 1 has just arrived at the door.

![Three directions side by side](step-5-pizza/01-directions.svg)

### A · The group order, as it was
A faithful port of the legacy, restyled: one open order per event, an attendee who holds it, the legacy pages phone-first in the hub's frame, sign-in instead of token links, events instead of webhooks and polling.
- **Attendees:** the familiar flow; when a second group wants another pizzeria, they wait until the first order is called in. Nobody learns when food arrives except by watching the door.
- **Organisers and crew:** pizzerias and menus, the daily record and CSV, force release and cancel.
- **Venue staff:** nothing changes; a delivery at the door asks for "whoever ordered".
- **Trade-offs:** the cheapest, and the legacy tests are the spec nearly line for line. But it keeps the legacy's weak spots that were not bugs: the one-at-a-time queue, no estimate, no hand-out, and the holder chasing payments from memory.
- **Cost: S–M.**

### B · The food desk
The crew runs food like a counter: food rounds are planned in the run of show ("Dinner: order by 17:30"), a crew member holds every order, calls it, receives it and hands it out by number; attendees only pick.
- **Attendees:** predictable times and one place to collect; no one has to be the volunteer.
- **Organisers and crew:** full control, and all the work, at the hours they are busiest.
- **Venue staff:** a counter view of which bag is whose.
- **Trade-offs:** loses the legacy's "decided on the spot", which worked at real events; moves the load onto the crew; drifts toward the service-order engine 0022 rules out (rounds, a counter, a queue).
- **Cost: L.**

### C · Group order, effortless
The legacy model, kept where it worked and fixed at its edges. Anyone who joined opens an order; a holder calls it; the app does the rest of the work.
- **Attendees:** from the screen's QR to a pizza in the order in under a minute; several orders at once (one per pizzeria); a close time that holds, with a last call; live status with an estimate; "pizza is here" on the phone and the screens.
- **Holder:** a checklist from prepare to hand-out, call mode in large type, an estimate at call-in, a hand-out list with "paid me" ticks, a nudge to latecomers. Reminders reach them first, then the crew.
- **Organisers and crew:** one Food page for the day: what needs them, stepping in (audited), pizzerias and menus, the record and CSV, settings. "Crew only" opening for events that want fixed rounds.
- **Venue staff:** the crew phone's door helper: the delivery says the pizzeria, the order and its holder appear, and the crew marks it arrived.
- **Trade-offs:** more states and tests than A (several orders, a timer, hand-out, an estimate); one catalog sentence changes ([D1](step-5-pizza/questions.md#d1-one-open-order-per-event-or-several)). It builds no engine: still one kind of thing, a group food order with one holder.
- **Cost: M.**

## Recommended direction: group order, effortless
**C.** The legacy flow was proven at real events and #117 calls it "adequate for our kind of event"; what hurt was never its shape but its edges: one order at a time, a deadline nobody kept, nobody knowing when the food came, payments chased from memory, tokens in links, comments shown to anyone, and transitions that could run twice. C fixes exactly those and nothing else. A would ship the edges again with a new coat of paint; B would solve problems the legacy did not have by giving the crew a job they never wanted.

C also costs less than it looks, because the platform has done half of it already: Moments' three pizza stories and its `pizza` rule, Notify's food topic and Screen's food box exist and wait for events. Step 5 builds the module that emits them, and the venue lights up.

**Design principles**
1. **Under a minute from the QR to a pizza in the order** (#119's goal): one list, one menu, one tap; sign-in once per phone, never a token.
2. **The holder is a volunteer; the app does the work.** Counting (the summary), reading (call mode), reminding (the scheduler), chasing (hand-out and paid ticks).
3. **A time that holds.** The close time is a promise, with a last call before it; nothing stays open by accident (U3).
4. **Close the loop.** Every order ends: called in, on the way, here, collected, done; and a forgotten one is asked about (U11).
5. **One truth, many surfaces.** The pages, the screen, Notify and (in step 6) Discord read the same events; nothing polls; one happening has one voice on the screen (step 4's rule).
6. **Private by default.** Who had what is for the person, the holder and the crew; everyone else sees counts and kinds (D9).
7. **Safe under load.** Every step is one conditional update in a transaction, with an idempotency key and an event through the outbox (E1, E2, E12).
8. **No money, no engine.** A payer and a "paid me" tick, never amounts settled in the app; one kind of order, never a generic service flow (0022).

## Key flows
Each flow names its users and its mockup. The mockups use the demo event's names only (Demo Pizzeria, Demo Trattoria, Demo Corner Grill, Demo Player, Player Two …).

### From the screen to a pizza in the order (attendee)
Moments' "Pizza order open" story shows the QR; the Food page lists the open orders; the menu filters by name or ingredient; "Added" shows the steps ahead ([L6](step-5-pizza/questions.md#l6-where-does-the-screens-qr-land), [D9](step-5-pizza/questions.md#d9-who-sees-what-in-an-order)).

![From the screen to a pizza](step-5-pizza/02-flow-qr-to-order.svg)

### Food: the open orders (attendee, guest)
Two open orders, nothing open, a guest, and ordering turned off ([U2](step-5-pizza/questions.md#u2-who-may-start-an-order), [U15](step-5-pizza/questions.md#u15-what-does-a-guest-see), [O3](step-5-pizza/questions.md#o3-turning-ordering-off)).

![The Food page](step-5-pizza/03-open-orders.svg)

### Picking a pizza (attendee)
The menu, own pizza (a base and 1–4 toppings), other (free text), and the same again ([U6](step-5-pizza/questions.md#u6-the-same-again)).

![Picking a pizza](step-5-pizza/04-menu-and-add.svg)

### My order (attendee)
Closed and being called, on the way with the estimate, here with the pickup place, and the two pushes ([U8](step-5-pizza/questions.md#u8-the-pizzerias-estimate-at-call-in), [D12](step-5-pizza/questions.md#d12-which-pushes-does-food-send)).

![My order](step-5-pizza/05-my-order.svg)

### Starting an order (attendee becomes the holder)
Pick a pizzeria (one with an open order offers "join it instead"), a close time, a pickup place ([D1](step-5-pizza/questions.md#d1-one-open-order-per-event-or-several), [U3](step-5-pizza/questions.md#u3-what-does-an-orders-time-mean), [D6](step-5-pizza/questions.md#d6-delivery-or-takeaway)).

![Starting an order](step-5-pizza/06-start-order.svg)

### Holding an order (holder)
The checklist from prepare to hand-out; release, take-over and a lost race ([E1](step-5-pizza/questions.md#e1-two-people-claim-or-take-over-at-once)).

![The holder's checklist](step-5-pizza/07-holder-checklist.svg)

### Call mode (holder)
The legacy summary in large type, tick as you read, then "called in" with the estimate and the payer ([L7](step-5-pizza/questions.md#l7-call-mode), [U13](step-5-pizza/questions.md#u13-who-paid-the-pizzeria-the-payer)).

![Call mode](step-5-pizza/08-call-mode.svg)

### It's here: hand-out (holder)
Everyone told; the holder ticks people off and who paid them; a nudge to latecomers; done ([U4](step-5-pizza/questions.md#u4-hand-out-who-and-when-is-an-order-done), [U12](step-5-pizza/questions.md#u12-who-sees-the-paid-the-holder-tick), [D3](step-5-pizza/questions.md#d3-a-done-state)).

![Hand-out](step-5-pizza/09-hand-out.svg)

### The crew's Food page (organiser, crew, venue staff)
Every order of the day, what needs the crew, stepping in with a reason, the order's history; the same page on a crew phone with the door helper ([U5](step-5-pizza/questions.md#u5-what-do-venue-staff-get), [D5](step-5-pizza/questions.md#d5-which-rights), [D16](step-5-pizza/questions.md#d16-history-of-an-order)).

![The crew's Food page](step-5-pizza/10-crew-food-page.svg)

### Pizzerias and menus (organiser)
Loaded from the profile, edited as text with a preview; rows keep what was ordered ([D11](step-5-pizza/questions.md#d11-pizzerias-in-the-event-profile), [D15](step-5-pizza/questions.md#d15-snapshots-of-menu-items)).

![Pizzerias and menus](step-5-pizza/11-pizzerias-and-menus.svg)

### The daily record (organiser)
Orders by day with flags, who had what, and the CSV for the after-event bill system ([D8](step-5-pizza/questions.md#d8-the-bill-total), [O10](step-5-pizza/questions.md#o10-the-after-event-record)).

![The daily record](step-5-pizza/12-daily-record.svg)

### The lifecycle (everyone, implicitly)
The states, the holder beside them, who may do what, and what each step emits.

![The lifecycle](step-5-pizza/13-lifecycle.svg)

### Food on the venue screen (attendees in the hall)
The steady food box with two orders and the moments step 4 built, each happening with one owner ([D2](step-5-pizza/questions.md#d2-the-screens-food_status-with-several-orders), [L3](step-5-pizza/questions.md#l3-the-screens-food-box-when-nothing-is-happening), [P3](step-5-pizza/questions.md#p3-the-exit-criterion)).

![Food on the screen](step-5-pizza/14-screen-and-moments.svg)

### Reminders, last call and auto-release (holder, crew)
Four orders on a time line: on time, a stalling holder, auto-close off, and a called-in order that never arrives ([U10](step-5-pizza/questions.md#u10-who-hears-a-reminder), [U11](step-5-pizza/questions.md#u11-a-called-in-order-that-never-arrives), [O2](step-5-pizza/questions.md#o2-the-scheduler)).

![Reminders](step-5-pizza/15-reminders.svg)

### Edge states (attendee, holder)
Closed while you chose, offline, cancelled, left from an earlier day, not a member, released by the timer ([E3](step-5-pizza/questions.md#e3-the-order-closes-while-someone-is-choosing)–[E16](step-5-pizza/questions.md#e16-offline-for-a-moment)).

![Edge states](step-5-pizza/16-edge-states.svg)

### Food settings (organiser)
Every time and rule per event, with the legacy values as defaults ([O5](step-5-pizza/questions.md#o5-how-many-open-orders-at-once), [L8](step-5-pizza/questions.md#l8-holder-names-on-the-venue-screen)).

![Food settings](step-5-pizza/17-food-settings.svg)

### Every mockup
| File | What it shows | For whom |
|---|---|---|
| [01-directions.svg](step-5-pizza/01-directions.svg) | The three directions side by side | the session |
| [02-flow-qr-to-order.svg](step-5-pizza/02-flow-qr-to-order.svg) | Screen QR → Food → menu → added | attendee |
| [03-open-orders.svg](step-5-pizza/03-open-orders.svg) | The Food page: two open, none open, guest, ordering off | attendee, guest |
| [04-menu-and-add.svg](step-5-pizza/04-menu-and-add.svg) | Own pizza, other, the menu with "last time" | attendee |
| [05-my-order.svg](step-5-pizza/05-my-order.svg) | My order: closed, on the way, here; the pushes | attendee |
| [06-start-order.svg](step-5-pizza/06-start-order.svg) | Starting an order; the holder's first screen | attendee, holder |
| [07-holder-checklist.svg](step-5-pizza/07-holder-checklist.svg) | The checklist; release and take-over; a lost race | holder |
| [08-call-mode.svg](step-5-pizza/08-call-mode.svg) | Call mode; called in with the estimate and the payer | holder |
| [09-hand-out.svg](step-5-pizza/09-hand-out.svg) | Hand-out and paid ticks; done | holder |
| [10-crew-food-page.svg](step-5-pizza/10-crew-food-page.svg) | The crew's orders of the day, stepping in, history; the crew phone and the door helper | organiser, crew, venue staff |
| [11-pizzerias-and-menus.svg](step-5-pizza/11-pizzerias-and-menus.svg) | Pizzerias and the menu editor with a preview | organiser |
| [12-daily-record.svg](step-5-pizza/12-daily-record.svg) | The daily record, who had what, the CSV | organiser |
| [13-lifecycle.svg](step-5-pizza/13-lifecycle.svg) | States, holder, who may, events | everyone |
| [14-screen-and-moments.svg](step-5-pizza/14-screen-and-moments.svg) | The food box and the pizza moments on the venue screen | attendees in the hall |
| [15-reminders.svg](step-5-pizza/15-reminders.svg) | Last call, reminders, auto-release on a time line | holder, crew |
| [16-edge-states.svg](step-5-pizza/16-edge-states.svg) | Six edge states | attendee, holder |
| [17-food-settings.svg](step-5-pizza/17-food-settings.svg) | Food settings and rights | organiser |

## Port, drop or invent
Each with its reason ([0020](../decisions/0020-best-of-old-freely-new.md)).

### Port as is (code and its tests, with clock, zone and storage injected)
| Legacy | Where it goes | Why |
|---|---|---|
| `validate.ts` (kinds menu, custom, text; 1–4 toppings; text limits) and `pizza-validate` | the pizza API's input checks | Pure rules, tested, still right |
| `menu-filter.ts` (name or ingredient, case-insensitive) and its test | the menu page's filter | Pure, tested |
| `summary.ts` (grouped lines, counts, notes, "copy as text", no comments) and `pizza-summary` | call mode | The legacy's best part; call mode only draws it larger |
| `report.ts` (the daily record, the CSV's bytes: BOM, `;`, decimal comma, placed orders, one row per participant) and `pizza-report` | the daily record | The after-event bill system reads exactly this |
| The router's rules and status codes (`another_open`, `claimed` with holder and since, `closed`, `not_owner`, `has_pizzas`, `not_placed`) and `pizza-orders`, `pizza-routes`, `pizza-db` | the lifecycle's spec | Proven behaviour; the tests become the spec of #117, adapted to sign-in and tenants |
| `reminders.ts` (+30 and +60; latest step only; a 30-minute send window; logged only after delivery; auto-release after 2 h clears the holder only) and `pizza-reminders` | the scheduler | The rules held at real events |

### Port with changes
| Legacy | Becomes | Why |
|---|---|---|
| One open order site-wide (a partial unique index) | One open order per pizzeria per event (D1) | TB1 makes it per tenant; two pizzerias should not queue |
| `target_at`, a "calling around" hint | `closes_at`, a close time with a last call and auto-close (U3) | A time people can trust; Moments' last call already waits for it |
| The registration token in `?token=` links (P2, P3) | The central sign-in and membership (0027) | Tokens in URLs are dropped (0010); identity is the person |
| Comments and notes returned to anyone; orders enumerable by id (problem 9) | D9's visibility, checked on every read; ids not guessable | #117: comments only for the order's members and crew (narrowed to the holder and crew) |
| Read-then-write transitions; only open and claim atomic (problem 15) | Every transition one conditional update in a transaction, with an idempotency key | #117; a double "placed" posted twice |
| The admin's hard delete in three statements, unaudited | No hard delete (D17); crew overrides audited (D16) | N6 |
| The order log (`pizza_order_log`, 19 entry kinds) | The order's history, and the seeds of `pizza.order.*` | The entry kinds map to the events almost one to one |
| Discord webhook posts (P6) | `pizza.order.*` events; the bot posts them in step 6 | One bus; the webhook goes |
| The cron every 5 minutes | A scheduler in the container, due rows in Postgres (O2) | No cron in a container; survives restarts and replicas |
| The pizza block and status URL polled by the display and signage (P11, P12) | Screen's `food_status` fed by events; Moments' stories (built) | Nothing polls |
| The admin pages behind one password (P8, P9) | The crew's Food page behind `pizza.*` rights | Rights from sign-in |
| History labels that follow live menu data (problem 16) | Rows that keep what was ordered (D15) | A menu edit must not rewrite the record |
| A forced release that names the holder; an admin "placed" that leaves the payer empty (problem 16) | Crew actions say "the crew"; the payer is always set (U13) | Small bugs, fixed in passing |
| One local date per order, one fixed time zone in code | `seq` per event day turning at 06:00; the event's time zone (D4, E8) | TA1, TA3 |
| Pizzerias and menus as global rows | Per event, from the profile, copied by clone (D11) | TG12, DR11 |

### Drop
| Legacy | Why |
|---|---|
| Registration tokens and the `/pizza order` and `/pizza claim` link commands as they were | Sign-in replaces tokens; the bot's commands are rebuilt in step 6 to link to the Food page |
| The retired per-day pages and their redirect (P13), and the spreadsheet fallback | Gone already in the legacy; the spreadsheet links were secrets to rotate |
| The pizza line in the ticker lane | DR3: the ticker is manual (0018); food has its own box and moments |
| The legacy pizza theme (mascot, banner, fonts) | An event's brand belongs in its theme, not in the module (L1) |
| `GET /api/pizza/status` with `CORS *` | Public facts travel as events; pages read the module's API with the caller's session |

### Invent
| New | Why |
|---|---|
| Several open orders, one per pizzeria (D1) | Two groups, two pizzerias, no queue |
| A close time that holds, with a last call and auto-close (U3) | The deadline people can trust; the screen's last call needs it |
| An estimate at call-in, "about 19:31" (U8) | The question everyone asks the holder |
| "It's here" with a pickup place, and the hand-out list (U4) | The roadmap's "the crew hands it out"; the legacy stopped at "placed" |
| "Paid me" ticks for the holder (U12, #118) | Replaces chasing from memory; no money handled |
| `done` (D3) | Every order ends; the screen and the hub can let go |
| Call mode with ticks (L7) | The summary, readable in a noisy hall |
| The same again (U6) | Most people order the same thing twice |
| The crew's door helper (U5) | Venue staff meet food at the door |
| Escalation to the crew and "has it arrived?" (U10, U11) | The volunteer is not alone; nothing is forgotten |
| A per-person cap and one held order per person (U18, E14) | Pranks cost a phone call |
| Snapshots of ordered items (D15) | Records that do not change under you |
| Live pages by server-sent events (D13) | #119's push without polling |
| The caller's own orders and a For you card (D14) | The lead's step 2 note; the App track's For you |

## The product owner's notes (2026-11-19)
Given while reading the pack. They change the money questions and come before the recommendations where the two differ.

- **How a pizza is paid for today.** The holder, who calls the order in, pays the pizzeria. They pay either when ordering (for example a Wolt order) or when the pizza arrives.
- **Settling up, the default.** The money goes through the organiser. After the event, the cost of each order is divided evenly among the people who ordered in it.
- **Settling up, an organiser option.** The organiser can instead let attendees pay the holder directly.
- **Exact prices.** There must be a way to record each person's exact price in an order, instead of an even share.
- **Receipts.** The holder or the crew can add photos of an order's receipts to the order. A receipt can also be the source for entering the real cost per attendee later.

**What this changes in the pack.**
- Principle 8 ("no money, no engine") becomes: the app keeps what each order cost and what each person owes. No money moves through the app, and there is still no generic service engine.
- [D8](step-5-pizza/questions.md#d8-the-bill-total) is answered A: settling food after the event is still done, through the organiser.
- [D7](step-5-pizza/questions.md#d7-prices-on-the-menu) (prices on the menu), [U12](step-5-pizza/questions.md#u12-who-sees-the-paid-the-holder-tick) (the "paid the holder" tick) and [U13](step-5-pizza/questions.md#u13-who-paid-the-pizzeria-the-payer) (the payer) are reopened for the session, in the light of these notes.
- New for the session:
  - the settle-up setting (through the organiser, or directly to the holder);
  - an even share or exact prices per person;
  - receipt photos: who adds them, who sees them, how long they are kept;
  - what each person owes, and to whom, in the record and the CSV.
- [Decision 0022](../decisions/0022-product-vision.md) says "no payments". The plan records how these notes refine it: amounts are tracked, and no payment is taken in the app.

## The lead's step 2 notes
- **"The pizza contract gives the phone hub a read of the caller's own orders":** `GET /api/pizza/me/orders`, and `me/summary` cards if the App track takes its D18 ([D14](step-5-pizza/questions.md#d14-the-callers-own-orders-the-leads-step-2-note)); proposed for #117.
- **"Add a demo pizzeria and orders to `events/demo/`":** two placeholder pizzerias in the demo profile, and demo orders made by the stack's screenshot script through the API ([D18](step-5-pizza/questions.md#d18-demo-data)); proposed for #117 (the pizzerias) and #119 (the orders in CI).

## Proposed issue changes
The lead applies these after the session; the pack's author creates and edits no issues. Every contract item below is additive and ships with the code that uses it ([0029](../decisions/0029-additive-contracts-ship-with-consumers.md)); D1's sentence is discussed there. Risk follows [P5](step-5-pizza/questions.md#p5-risk-classes).

### #117 · the contract, the lifecycle and the rights (keep, rewrite; high)
Proposed title: `feat(pizza): the pizza contract, the group-order lifecycle and its rights`.
- [ ] `contracts/pizza.md` and `pizza.openapi.yaml`, written from the legacy API and its status codes, adapted to the conventions (problem bodies, sign-in, tenant); the catalog's pizza events adopted, with additive `closes_at`, `estimate_at`, `pickup` on the Order, the `done` state and `pizza.order.done` (D3); the catalog's "one open order per event" becomes "one open order per pizzeria" (D1)
- [ ] The lifecycle (open → closed → placed → arrived → done; cancel; reopen and undo; claim, take-over and release) with every transition one conditional update in a transaction, idempotency keys, events through the outbox; race tests for concurrent joins, claims and each transition (E1, E2)
- [ ] Several open orders, one per pizzeria; at most N open per event and one held per person; at most N pizzas per person per order (D1, O5, E14, U18)
- [ ] Members only (central sign-in #52, membership #150); no tokens in URLs; visibility as D9, tested; guests per the info-page mode (U15)
- [ ] Pizzerias and menus per event with the legacy validators and menu filter; delivery or takeaway (D6); rows snapshot what was ordered (D15); a `pizza` section in the profile (D11); clone with the event; two placeholder pizzerias in `events/demo/`
- [ ] Rights `pizza.order.open`, `pizza.order.manage`, `pizza.menu.write`, `pizza.record.read`, defined and tested here for every action of #118 and #119 (D5, P5); crew overrides audited with before and after (D16); no hard delete (D17)
- [ ] `GET /api/pizza/me/orders` (and `me/summary` if the App track takes D18) (D14)
- [ ] Data classes, privacy export and delete, and 12-month anonymisation (O6)
- [ ] The legacy pizza tests ported as the spec (`pizza-db`, `pizza-routes`, `pizza-orders`, `pizza-validate`, `pizza-menu-filter`, `pizza-summary`)

Out of scope: the scheduler and the pages (#118, #119); the bot (step 6); payments.

### #118 · the scheduler, the holder's tools and the crew's Food page (keep, rewrite; normal)
Proposed title: `feat(pizza): the scheduler, the holder's tools and the crew's Food page`.
- [ ] The module's scheduler (O2): last call (`pizza.order.closing`) and auto-close (U3), reminders +30 and +60 with the legacy rules, escalation to the crew (U10), auto-release after 2 h, "has it arrived?" (U11), done after arrival (O7); all per-event settings with the legacy defaults; a restart and a second replica tested; its lag in `/health` (O8); `pizza.reminder.triggered` gains the holder's `user_id` (D12, additive)
- [ ] The holder's pages: the checklist, call mode (the ported summary), called in with the estimate and the payer, it's here with the pickup place, the hand-out list with paid ticks and the nudge, release, take-over, cancel with a reason, undo ([mockups 07–09](step-5-pizza/07-holder-checklist.svg))
- [ ] The crew's Food page, desktop and phone: the day's orders with what needs the crew, stepping in with a reason, the order's history, the door helper (U5); pizzerias and menus with a preview; the daily record and CSV (the ported report); Food settings through admin's settings ([mockups 10–12, 17](step-5-pizza/10-crew-food-page.svg))
- [ ] Finnish and English; CI screenshots of each page next to its mockup; Playwright for the holder's and the crew's flows

Out of scope: defining rights (#117); the bot's posts (step 6); payments.

### #119 · the attendee's Food pages (keep, rewrite; normal)
Proposed title: `feat(pizza): the attendee's Food pages, mobile-first`.
- [ ] The Food page (open orders, nothing open, guest, not a member, ordering off), the menu with its filter, own pizza, other and the same again; add and edit until close; my order's steps with the estimate and the pickup place; "I've got mine" (U9) ([mockups 02–06, 16](step-5-pizza/02-flow-qr-to-order.svg))
- [ ] Live by server-sent events from `pizza.order.*`, no polling; reconnect and catch up (D13, E16)
- [ ] Drawn in the hub's frame from `packages/ui` with the event's theme, if the App track takes its D2; phone first, then desktop; Finnish and English
- [ ] Playwright for the whole attendee flow; CI screenshots named as the tests, with demo orders made by the stack's script (D18)
- [ ] The step's exit check (see below), run on the demo stack

Out of scope: the hub's shell and push permission (App track); the screen's box (the new issue).

### New · food on the screens and in alerts (normal)
Proposed title: `feat(screen,notify): food on the screens and in alerts`.
- [ ] Screen feeds `food_status` from `pizza.order.*` and `pizza.item.*`, with additive `orders` for several orders (D2); hidden when nothing is open or on the way (L3); a placed order leaves after 3 h (U11); CI screenshots
- [ ] Notify's `food` topic: `pizza.order.closing` in the event part; `pizza.order.cancelled`, the holder's reminders and the hand-out nudge in the personal part (D12)
- [ ] Moments' "Pizza orders ready" (preset 21) may also end on `pizza.order.done`
- [ ] A stack test: an order's events show on a screen's box and reach a subscribed member

Out of scope: the bot's posts (step 6); new sounds.

### Out of step 5 (proposed)
The bot's channel posts and the rebuilt `/pizza` commands (step 6, consuming the events); prices, sizes, payments and settling (0022, D7); reading menus from photos (D10); any pizzeria's own ordering integration.

### Order (a sketch for the planner)
1. **#117** first, alone: high risk, one accept; its contract and rights unblock the rest.
2. Then, in parallel: **#119 with the new screen and notify issue** (the attendee's side and what the hall sees; they share the demo script and the exit check), and **#118** (the holder's and the crew's side). Both use only #117's API and rights. If #118 and #119 share too many page files, the planner bundles them in order instead.

## Proposed exit criteria
The roadmap's "an order runs end to end and shows on the screen", made checkable ([P3](step-5-pizza/questions.md#p3-the-exit-criterion)):
- On the demo stack, an order is opened, joined by several members, closed, called in, marked arrived, handed out and done; every step publishes its `pizza.order.*` event (contract-tested).
- The venue screen shows it: Moments' "Pizza order open" and "Pizza orders ready" stories and Screen's food box, with CI screenshots.
- The people in the order get "pizza is here" through Notify.
- The race tests and the scheduler's restart test pass; the ported legacy tests pass.

## Open questions
The [question bank](step-5-pizza/questions.md) holds every open question found: 79 in six themes, each with options and a recommendation. **Decide first:** P1 (the direction), D1 (several open orders), U3 (a close time that closes), U4 (hand-out and done), D8 (the bill total), D9 (who sees what), P2 (the issue set), P3 (the exit criterion).
