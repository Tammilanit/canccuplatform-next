# Admin as the control room: question bank

The open questions of the [admin control-room pack](../admin-control-room.md), for the session between the product owner and the lead. Each has its options and a recommendation; the IDs are used in the pack and in the sheets' captions. Where the base agreed on 2026-11-22 already answers a question, the recommendation says so and the question only checks it. **Decide first:** [P1](#p1-the-direction), [U1](#u1-two-homes), [U4](#u4-which-modules-can-be-switched-off), [U5](#u5-who-may-change-a-modules-settings), [D2](#d2-the-switch-in-the-contract).

Six themes: the pack itself (P), who uses it and how (U), look and feel (L), data and integrations (D), edge cases and failure (E), operations and scale (O). 40 questions.

Words used here: a **part** is one module as people meet it (Food is the pizza module, Screens the screen module); a **tile** is a part's box on the control center; an **item** is one entry of the run of show.

## The pack (P)

### P1. The direction
- **A. Settings, tidied:** friendlier forms, a module list with switches, a links page as the home.
- **B. The control room:** two homes (control center, crew desk), settings in their modules, admin keeps the event basics, modules, people and the profile.
- **C. One live board:** one dense board for everyone and a command bar.
- **Recommendation: B**, the base agreed on 2026-11-22. See [Three directions](../admin-control-room.md#three-directions).

### P2. The issue set
- **A.** One issue for all of admin.
- **B.** As proposed: keep #731 and #732, add the two homes, the module switch, Food's settings move (step 5 polish), event basics, People, and a small profile issue.
- **C.** B, with the other modules' settings moves as one issue instead of one per module.
- **Recommendation: B.** Each is a whole capability with its own risk class; each module's move goes with its own polish, so a module's page and its tab change together.

### P3. When it is built
- **A.** All before the step 5 gate.
- **B.** The design before the step 5 gate (this pack and its plan); Food's move and switch in step 5's polish; the homes, the switch and event basics as their own packages right after; People when the bot's presence read exists.
- **C.** All after step 8.
- **Recommendation: B.** The PO asked for the design before the gate; building every part before it would hold the gate on pages it does not need.

## Who uses it and how (U)

### U1. Two homes
- **A.** Two homes: the control center for owner and organisers, the crew desk for crew.
- **B.** One home whose content follows the person's rights.
- **C.** One home for all, the crew desk a tab of it.
- **Recommendation: A**, as agreed. A crew member needs today's schedule and its buttons, not a page of tiles; an organiser needs the whole event. Organisers can open the crew desk from the menu.

### U2. What crew see on the desk
- **A.** All of today's items; controls only on the items their rights cover.
- **B.** Only the items of the parts they crew.
- **C.** All items with all controls.
- **Recommendation: A.** Crew need to know what else is happening (the raffle at 21:00 matters to Food crew too), but act only on their own.

### U3. Who lands where
- **A.** By role: event admins on the control center, everyone with any crew right on the crew desk, no rights on "No role yet".
- **B.** A setting per person.
- **C.** Everyone on the control center.
- **Recommendation: A.** No setting to learn; a person can still open the other home from the menu if their rights allow.

### U4. Which modules can be switched off
- **A.** Every part except the run of show, admin, the tenants core and theming (the look always exists).
- **B.** Every part, the run of show too.
- **C.** Only the optional parts (Food, Tournament, Finals, Games, Moments, Voices, Cast); Screens, Notifications and the bot always on.
- **Recommendation: A.** The run of show is the event's one schedule (base item 2), so it cannot go; every other part is something an event may not use (an event with no screens, an online event with no food).

### U5. Who may change a module's settings
- **A.** Organisers only, as today (`admin.settings.write`).
- **B.** Organisers, and a part's crew lead through a new right per module (`<module>.settings.write`, additive).
- **C.** Anyone with any right in the part.
- **Recommendation: A for now.** The move changes the page, not who may write. B is a small additive change later, if a crew lead asks.

### U6. Roles in one tap
- **A.** The role is a dropdown in the row: Attendee, Crew, Tournament crew, Food crew, Screen crew, Organiser; one tap grants the preset, another takes it away.
- **B.** A person's page with checkboxes per right.
- **C.** Both: the dropdown for presets, the page for single rights.
- **Recommendation: C.** The dropdown does the everyday thing in one tap; single rights stay possible in the person panel for the rare case.

### U7. Several crew roles at once
- **A.** A person can hold several presets (Food crew and Screen crew); the row shows the first and "+1".
- **B.** One preset per person.
- **Recommendation: A.** Small events have few crew who do several jobs.

### U8. The event profile
- **A.** As built (Save, Load, export), plus a "what it replaces" step before a load, a copy of the current setup saved automatically before it, and "Start from the demo event".
- **B.** As built.
- **C.** Merge it into Event basics.
- **Recommendation: A**, on its own page: loading a profile is rare and replaces much, so it keeps its own page and its confirm step.

### U9. Organisers on a phone
- **A.** Every admin page works in full on a phone (amendment 5); the control center stacks, tables become rows of cards.
- **B.** The control center and crew desk on a phone, the rest desk only.
- **Recommendation: A.** Amendment 5 binds every page crew use.

## Look and feel (L)

### L1. The control center's order
- **A.** Quick actions, now and next, needs you, the tiles, then modules and basics.
- **B.** Needs you first, then now and next, the tiles, quick actions last.
- **Recommendation: A**, the amendment 3 order (crew actions, then summary, then the collection, then related panels); needs you sits right under the clock so it is above the fold at both widths.

### L2. Live controls on an item
- **A.** Preset chips per item kind: +5, +15, +30 and Done for every item; the kind's own action (Close now and Reopen for a food order, Fire now for a raffle, Start for a session).
- **B.** One "Edit" per item opening a form.
- **Recommendation: A.** No typed numbers where a control fits; an edit form stays one tap further.

### L3. The control for each type
- **A.** #732's list: dropdown for a choice from a long list, chips for a few, switch for on/off, stepper with unit and range for a count, preset chips plus "Other" for a duration, swatch for a colour, URL field with a preview for a link; free text only for free text.
- **B.** Dropdowns for every choice.
- **Recommendation: A.** Chips show every option at once when there are few; a dropdown hides them.

### L4. Help lines
- **A.** One line under every field: what it does for people, in their words; the default shown as "Default: …"; an example as the placeholder.
- **B.** A help icon with a tooltip.
- **Recommendation: A.** A tooltip is invisible on a phone and easy to miss on a desk.

### L5. Access in words
- **A.** Three plain questions: "Who can read the event's info pages?" (Everyone, People at the venue, Only people who sign in), "How do people join?" (At the venue or with the event's link, Closed), "Where can admin be opened?" (At the venue or over the crew network, Anywhere).
- **B.** The contract's names in a dropdown.
- **Recommendation: A.** No internal words on screens.

### L6. Find a setting
- **A.** A search in the header that finds any setting, part or person and jumps there.
- **B.** No search; the menu and the tabs are enough.
- **C.** Later, after the move.
- **Recommendation: C.** Worth it once settings are spread over modules, but not needed to ship the move; a `Roadmap note:` for step 10.

### L7. The side menu
- **A.** Control center and Crew desk at the top; then the parts the event has switched on (Run of show, Food, Tournament, Moments, Notifications, Screen studio, Theme studio); then Event (People, Modules, Event basics, Event profile, Health, Integrations).
- **B.** As today, with Settings removed.
- **Recommendation: A.** The homes first; off parts leave the menu.

### L8. Tiles in the control center
- **A.** A small card grid of like items (one per part), each with one number, one line and a status dot.
- **B.** A table of parts.
- **Recommendation: A.** The parts are like items people scan at a glance; this is the one card grid on the page (amendment 3: cards for collections).

### L9. Light and dark
- **A.** The dark organiser shell, as every organiser page today; the theme's light mode where the event sets it.
- **B.** A light admin.
- **Recommendation: A.** One shell for every organiser page.

## Data and integrations (D)

### D1. Where a tile's status comes from
- **A.** Each part answers one small read (`GET /api/<module>/status` or similar: a number, a line, a state), added to its contract with the tile that uses it.
- **B.** Admin reads each part's existing APIs and computes the line.
- **C.** From the bus: admin keeps counts from events.
- **Recommendation: A.** Each part knows best what its one line is; additive, one endpoint per module, shipped with the code (0029).

### D2. The switch in the contract
- **A.** One feature flag per module, `<module>.enabled`, declared in `flags.yaml` (default on), read and written through the tenants module's flags API; switching emits `tenants.flags.changed`, which modules already follow.
- **B.** A new "modules" list on the tenant.
- **Recommendation: A.** The flags already exist, are per tenant, versioned and audited; adding flags is additive.

### D3. The move without a contract change
- **A.** The settings stay in admin's store and API; each module's Settings tab draws the kit's settings form against `GET`/`PUT /api/admin/settings/{module}`.
- **B.** Each module stores its own settings.
- **Recommendation: A.** No data moves, no contract changes, profiles keep working; only the page moves.

### D4. One page, several owners
Event basics writes the name and dates (tenants), the time zone and language (admin's settings), the venue (tenants' venues), the look (theming) and access (tenants).
- **A.** One page, one save bar, each part written through its own API in turn; a part that fails says which.
- **B.** One section per owner, each with its own save.
- **Recommendation: B.** Honest about what was saved; no half-saved page that looks whole.

### D5. Presence for the People page
"Who plays what is never on the bus" ([events.md](../../../contracts/events.md)).
- **A.** A per-person read from the bot (here, voice room, game), for organisers only, respecting `presence_opt_out`.
- **B.** No game and voice room; only check-in.
- **Recommendation: A**, once the bot has the read; until then the columns show "—".

### D6. Here or not
- **A.** "Here" means checked in today (Notify's rotating QR) or seen at the venue's addresses in the last hour.
- **B.** Checked in only.
- **Recommendation: B** first; A needs presence by address, which no module keeps.

### D7. The time zone list
- **A.** The IANA list grouped by region, the venue's zone first, searchable.
- **B.** A short list of common zones.
- **Recommendation: A**, as #732.

### D8. Profiles and the switch
- **A.** A saved profile carries the module flags; loading it sets them.
- **B.** Flags stay out of profiles.
- **Recommendation: A.** A profile is "the event as set up"; which parts it uses is part of that.

## Edge cases and failure (E)

### E1. Switching off with live work
- **A.** The dialog names the live work ("2 orders open"); switching off leaves it as it is, hidden, and it is there when the part comes back.
- **B.** Refuse while there is live work.
- **Recommendation: A.** The organiser may have a good reason; nothing is lost either way.

### E2. A part that does not answer
- **A.** Its tile says "No answer" with the time of its last answer; the rest of the page works.
- **B.** The page waits.
- **Recommendation: A.**

### E3. Two organisers change the same settings
- **A.** As today: the save meets a version conflict and the page says who changed what and offers to reload with their change kept.
- **B.** Last write wins.
- **Recommendation: A.** The contract already has optimistic concurrency.

### E4. Privacy and presence opt-out
- **A.** A person who opted out shows "Presence hidden" in the here, room and game columns, still listed with their role.
- **B.** Not listed.
- **Recommendation: A.** Organisers still need to give them a role.

### E5. A part switched off during a moment
- **A.** A scheduled moment of a part switched off is skipped and the run of show item says "Skipped: Moments is off".
- **B.** Fires anyway.
- **Recommendation: A.**

### E6. No event yet
- **A.** First run ends on Event basics, then the control center with an empty run of show and a "Set up the run of show" action.
- **B.** A setup checklist as the home until done.
- **Recommendation: A.** The empty states teach; a checklist home is a second home to maintain.

## Operations and scale (O)

### O1. How live is the control center
- **A.** Tiles refresh every 10 seconds, like Health; needs you as it changes.
- **B.** On reload only.
- **Recommendation: A.**

### O2. A big event
- **A.** People pages by 50, the search on the server; the crew desk shows today only.
- **Recommendation: A.**

### O3. Audit
- **A.** Switching a module, granting a role and changing a basic are audited, as the tenants and admin contracts require.
- **Recommendation: A.**

### O4. Old links
- **A.** `/admin/settings/<module>` redirects to the module's Settings tab for as long as anyone may have bookmarked it (one platform version).
- **Recommendation: A.**

### O5. Screenshots
- **A.** Each new page adds its 390 px and 1280 px shots to the admin group of the demo screenshots.
- **Recommendation: A.**
