# Step 6 question bank

Every open question the research for [the step 6 brief](../step-6-bot.md) found, grouped by theme, each with its options and a recommendation, for the product owner's brainstorming session (#120). IDs are stable, so the session can answer "D3: A" and the mockups can point here.

The themes: **U** who uses it and how · **L** look and feel · **D** data and integrations · **E** edge cases and failure · **O** operations and scale · **P** plan and scope.

**Decide first** (they change the most): P1 (the direction), D3 (where rights from Discord roles live), D2 (how a command acts for its person), D7 (counts, not people), L1 (living messages), P3 (the tournament side), P4 (the Games catalogue), D9 (what the legacy import moves).

**Already decided, so not asked again:**
- One bot module with a pool of clients; the shared bot by default, an own application on request; secrets encrypted, write-only; binding through Discord's install flow with Manage Server; commands per guild from feature flags; clone moves the connection and the binding ([bot.md](../../../contracts/bot.md), [0013](../../decisions/0013-multi-tenant-core.md) items 12, 14–16, 29).
- Polls are dropped ([0010](../../decisions/0010-scope.md)). The ticker is manual and its windows are Screen's ([0018](../../decisions/0018-ticker-manual.md)).
- The bus carries presence as counts only; names are read live through the bot's API, for members, never for guests ([events.md](../../../contracts/events.md#bot), bot.md Who plays what).
- Opted out means absent: never listed, never counted ([tenants.md](../../../contracts/tenants.md#privacy-and-retention)). Raw presence data goes 30 days after archiving at the latest; other personal data is anonymised at 12 months ([0027](../../decisions/0027-product-decisions-2026-11-07-08.md)).
- Games owns the catalogue, matching and surges; the bot only reports activity counts (`bot.activities.counted`, [games.md](../../../contracts/games.md#surges)).
- The run-of-show posts on the agenda's `discord_channel` are the bot's ([bot.md](../../../contracts/bot.md#run-of-show-posts)). Discord DMs go through Notify (`notify.dm.requested`).
- The announcement's Discord channel is carried in Moments' events; the bot posts, edits and marks withdrawn posts (step 4 plan D12, [moments.md](../../../contracts/moments.md#announcements-115)).
- The alert relay and `/platform status` are step 8's (order change OC4).

A question marked **contract** needs a contract change if the recommendation is taken. Every such change here is additive, so it ships in the package whose code uses it ([0029](../../decisions/0029-additive-contracts-ship-with-consumers.md)). None of the recommendations removes or renames anything.

## U · Who uses it and how

### U1. What does an attendee do in Discord?
- **A.** A few door commands that answer privately and link to the page: `/food`, `/now`, `/hub`, `/privacy` (and later `/tournament`, `/finals`) ([mockup 07](07-attendee-commands.svg)).
- **B.** Whole flows in Discord: pick a pizza, register a team, follow a game, with menus and buttons (direction B).
- **C.** No attendee commands; the bot only posts.
- **Recommendation: A.** The pages are built once, phone-first, and kept right; B builds each of them a second time inside Discord's limits (five buttons a row, 25 options a menu, a 3-second answer). A keeps Discord a quick way in, and every answer is one tap from the page that does the job.

### U2. Which crew commands?
- **A.** `/announce`, the `/ticker` commands and the two photo menus; the tournament's crew commands come with step 7.
- **B.** A, plus food crew actions (release, cancel an order) and Screen pushes.
- **C.** None: the crew use the phone pages.
- **Recommendation: A.** These three are what the crew did from Discord at real events (the legacy's most used admin commands) and they are fast in chat. Food and Screen have phone pages built for the job (step 5's crew Food page, the Screen studio on a phone).

### U3. `/announce`: a form in Discord, or a link to the composer?
- **A.** A form (title, text, template) then a private preview with level and where, and Send; "Open the composer" for zones, a schedule or a run-of-show item ([mockup 08](08-announce.svg)).
- **B.** Only a link to the composer.
- **C.** The whole composer in Discord.
- **Recommendation: A.** The common case (now, every zone, the event's channels) takes three taps without leaving Discord; the rare case opens the page that already does it all. Every send goes through Moments' API (`POST /api/moments/announcements/preview` and then `POST /api/moments/announcements`), so the one announce action stays one.

### U4. Command names: the legacy's or new?
- **A.** New, short and plain: `/announce`, `/ticker`, `/food`, `/now`, `/hub`, `/privacy`.
- **B.** The legacy names (`/signage-announce`, `/pizza order`, `/pizza claim`).
- **C.** Both.
- **Recommendation: A.** The legacy names describe old systems (signage, tokens). Discord has no aliases, so C doubles the list everyone sees. The cut-over is one event; a line in the first announcement covers it.

### U5. Which languages do the commands speak?
- **A.** Every command's name, options and answers in the event's languages through Discord's localisations (Finnish and English first); each person sees their Discord client's language.
- **B.** English only.
- **Recommendation: A.** Discord supports localised names and descriptions per command, and the platform already plans Finnish as the first language pack (roadmap step 10). Cheap now, costly to retrofit.

### U6. Must a person have a platform account to use crew commands?
- **A.** Yes: someone without one gets "Sign in to Demo Event once to use /announce" with a link; after sign-in and joining, their Discord roles bring the rights ([mockup 07](07-attendee-commands.svg)).
- **B.** No: the bot creates a platform user from the interaction, since Discord vouches for the user id.
- **Recommendation: A.** Users are created by the central sign-in only ([tenants.md](../../../contracts/tenants.md#users-roles-and-membership)), with the person's consent and the privacy flags in front of them. A crew member signs in once per series.

### U7. Does a mapped Discord role make someone a member of the event?
- **A.** No: a role grants rights only to people who have joined (by venue, link or QR, [0027](../../decisions/0027-product-decisions-2026-11-07-08.md)); the Roles page shows how many holders have not ([mockup 05](05-roles-and-rights.svg)).
- **B.** A role can be marked "joins the event", so holding it counts as joining at sign-in.
- **C.** Every member of the server is a member of the event.
- **Recommendation: A.** A community server holds many people who are not at this event, and 0027 decided how people join. B is a fair later idea for events that hand out a ticket role; a `Roadmap note:` if wanted.

### U8. Who maps roles to rights?
- **A.** The event-admin role itself, as for the connection and the binding.
- **B.** Anyone with `admin.rights.write`.
- **Recommendation: A.** A mapping hands rights to a whole group at once, and whoever controls the server's roles controls who gets them. It belongs with the other "who speaks for this event" decisions.

### U9. What may a role grant?
- **A.** Any right that can be granted one by one, chosen through the presets; never the event-admin role or the role-only rights ([mockup 05](05-roles-and-rights.svg)).
- **B.** Presets only.
- **Recommendation: A, shown as presets.** The rule mirrors admin's granting rules, so a mapping can never do more than a hand grant. **Contract:** new presets for the crew jobs the commands need (for example `announce`, `food_crew`) beside today's `screen_crew` (additive, [admin.md](../../../contracts/admin.md#granting-rights)).

### U10. Where does the Discord page live?
- **A.** A "Discord" item in the organiser menu under Admin, shown with `bot.connection.read`; the bot module serves the page in the shared shell (tabs Overview, Channels, Roles and rights, Commands, Check) ([mockups 02–06, 13](02-setup-connect.svg)).
- **B.** A section of Settings.
- **C.** Inside the event profile.
- **Recommendation: A.** Setup, health and rights are visited at different times by different people; a page of its own also gives the crew one place to look when Discord misbehaves. Not a contract change: a new entry in the shell's menu (`packages/ui/src/menu.json`).

### U11. What do venue staff get?
- **A.** Nothing new in Discord: staff who help run the night are crew (the crew channel, DMs they chose); the rest never needs the server.
- **B.** A venue role and a venue channel.
- **Recommendation: A.** The guild belongs to the organiser's community, not the venue (the [legacy inventory](../../legacy-inventory/canccubot.md#data)); venue staff meet the platform on the screen and the crew phone.

### U12. Who may send a photo to the screen?
- **A.** Crew with `screen.photos.write`, through the message menu (as in the legacy).
- **B.** Any member: their photos go to a queue the crew approves.
- **Recommendation: A for step 6.** B is a moderation product of its own (a queue, notifications, rules); write it as a `Roadmap note:` if wanted.

### U13. Do photos posted in the photos channel go to the wall by themselves?
- **A.** No: the crew sends each one.
- **B.** Yes, with "Remove" for the crew.
- **Recommendation: A.** An unmoderated picture on a hall screen is the one mistake an event cannot take back in time; the legacy kept it manual for that reason.

## L · Look and feel

### L1. New posts for each change, or living messages?
- **A.** Living messages: one message per thing (the now-and-next board, each food order, each announcement), edited in place and pinned where it helps ([mockup 10](10-living-messages.svg)).
- **B.** A new post per change, as the legacy did.
- **Recommendation: A.** A channel that reads as a log is skimmed and muted; a board that is always true is read. It also costs fewer requests on a busy night (edits coalesce, E4).

### L2. Which living messages in step 6?
- **A.** The now-and-next board (the run of show's now and next, plus a food line) and one message per food order.
- **B.** A, plus a tournament board (step 7) and a "now playing" board.
- **Recommendation: A.** The tournament board comes with step 7 (P3). A "now playing" board in Discord would name people in a channel anyone in the server reads, including people who are not at the event; it stays on the hub and the screens.

### L3. Does an urgent announcement ping anyone?
- **A.** Info never pings; urgent mentions one role the event picks (none by default).
- **B.** Urgent pings @here.
- **C.** Never.
- **Recommendation: A.** Pings are the fastest way to get a server muted; the organiser decides whom an urgent one may wake. Never `@everyone`.

### L4. How does a withdrawn announcement look?
- **A.** The post is edited to "Withdrawn", with the time ([mockup 08](08-announce.svg)).
- **B.** The post is deleted.
- **Recommendation: A.** It follows step 4's D12 ("marks withdrawn posts") and tells people who saw it that it no longer holds.

### L5. Does the post say who announced?
- **A.** "From the crew", as the screen says.
- **B.** The sender's name.
- **Recommendation: A.** One voice on every surface (step 4's rule); Moments' history keeps who.

### L6. What is the shared bot called in an event's server?
- **A.** Its nickname in each server is the event's name ("Demo Event"), and its picture the event's logo where Discord allows a per-server one.
- **B.** The platform's name everywhere.
- **Recommendation: A.** Attendees know the event, not the platform; Discord lets a bot set its own nickname per server.

### L7. Run-of-show posts: where, when and how?
The contract left it to the port ([bot.md](../../../contracts/bot.md#not-in-this-contract)).
- **A.** In the channel bound for Announcements; a reminder posts at the item's shortest lead time (the "starts in 10 minutes" one); a post is an embed with the title, the start time in the event's time zone and the place.
- **B.** At the longest lead time.
- **C.** A channel of their own.
- **Recommendation: A.** The now-and-next board already shows what is coming; a channel post is the "go now" nudge. One channel keeps the server simple.

### L8. Embeds in the event's colour?
- **A.** Embeds, their side bar in the event's primary colour from the theme, the event's logo as the author icon.
- **B.** Plain text.
- **Recommendation: A.** The theme is the event's look everywhere else (brand kit); Discord shows a colour bar for free.

### L9. Who is named in the food channel?
- **A.** Counts and the holder only, as step 5's D9 for anyone else; "It's here" reaches the people with a pizza through Notify, never by a ping in the channel ([mockup 10](10-living-messages.svg)).
- **B.** Everyone in the order.
- **Recommendation: A.** The server is wider than the event; step 5 already decided who sees whom.

## D · Data and integrations

### D1. Do commands publish events or call the owning module?
#123's title says "through events"; the catalog says a command that changes another module's data is a call to that module's API with the person's rights ([events.md](../../../contracts/events.md#bot)).
- **A.** Commands call the owning module's API with the person's rights; posts consume events.
- **B.** Commands publish events that the owning modules act on.
- **Recommendation: A.** The person gets the real answer (refused, done, conflict) at once, the owner checks the rights it owns, and the owner emits the event that every surface follows. The issue's title changes (Proposed issue changes).

### D2. How does a command act for its person?
- **A.** The bot asks admin for a short-lived token for (event, user) and calls the module with it, as the person's own session would; the module checks rights as for any session.
- **B.** The bot calls the module's internal path with the acting user's id, and the module trusts the bot.
- **C.** The bot checks the rights itself and calls with its own identity.
- **Recommendation: A.** Every module keeps checking its own rights in one place; the bot never gains rights of its own; the audit names the person. **Contract:** an internal endpoint in admin that mints the token (additive), with a lifetime of a minute and the bot as its only caller. It is the high-risk heart of #121.

### D3. Where do rights from Discord roles live?
- **A.** In admin, as a second source beside the hand-granted list: the bot sends each member's role-derived rights to an internal endpoint; a session's rights are the role's, the granted ones and the ones from Discord roles; People shows where each comes from ([mockup 05](05-roles-and-rights.svg)).
- **B.** The bot writes them into admin's granted list.
- **C.** They apply only to Discord commands, not to the web pages.
- **Recommendation: A.** B mixes the two: losing a Discord role would take away a right someone granted by hand, and a hand edit would fight the sync. C splits one person's rights by surface. **Contract:** admin's internal endpoint and the `source` of a right in its reads (additive); `admin.rights.changed` gains a `source` field.

### D4. How fast does a role change take effect?
- **A.** Within a minute: on Discord's member-update events, at sign-in, and in a reconcile every 10 minutes.
- **B.** At the next sign-in only.
- **Recommendation: A.** Taking a role away is how a server removes a misbehaving crew member; it must hold now. The members intent is needed for the counts anyway (D5).

### D5. Which privileged intents does the shared application hold?
- **A.** Presence and members; never message content.
- **B.** Presence only.
- **Recommendation: A.** Presence feeds the counts and who plays what; members feeds the member count and the role sync. Nothing the platform does reads message text (the legacy asked for it and never used it).

### D6. Message counts and the top chatters?
- **A.** Drop them.
- **B.** Messages per hour, counts only, for an activity graph.
- **C.** Port them per person, as the legacy did.
- **Recommendation: A.** They were per-person data kept forever, for a board nobody missed; the screen's graph already has online and voice. B is cheap if the session wants a "chat activity" line.

### D7. What does the bot store about presence?
- **A.** Counts, never people: per-minute counts folded into hourly ones in Postgres (online, idle, in voice, players per activity, player-minutes per game); who plays what and who is in which room only live, in Valkey ([mockup 11](11-presence-and-privacy.svg)).
- **B.** The legacy's snapshots, per person, on Postgres, deleted 30 days after archiving.
- **Recommendation: A.** It answers every question #122 asks (now, over 24 hours, top games by player-hours, peaks) without storing a person, so the retention rule holds by design and a restart loses nothing. **Contract:** `GET /api/bot/stats` for the hourly series and top games (additive).

### D8. Voice rooms on the screen: an event or a read?
Screen's `voice_rooms` widget waits for "per-room counts" ([screen.md](../../../contracts/screen.md#widgets)).
- **A.** A new event `bot.voice.counted` with the public rooms and their counts, every interval.
- **B.** Screen reads `GET /api/bot/presence/voice` every 30 s.
- **Recommendation: A.** Push, like the other counts; the event carries room names and counts only, never who. **Contract:** the event (additive).

### D9. What does the legacy import move? (OC6, TE6)
- **A.** Only what the legacy bot holds: its token, its server, its channel ids, its admin role, its settings and its finals state file ([mockup 14](14-legacy-import.svg)).
- **B.** A, plus the signup site's snapshots and stats history.
- **Recommendation: A.** The site's rows are counts of past events with no use on the new screens, and 0004 and 0005 leave the site's data behind. B would need a copy of the site's database in step 6.

### D10. How is the import run?
- **A.** A command in the bot module, run by the operator, with `--dry-run` and a report.
- **B.** A page for the superadmin.
- **Recommendation: A.** It runs once per legacy bot, at the switch, by the person holding the legacy files; a page would be built for one use.

### D11. Does the import bind the server itself?
- **A.** No: it imports the token into the event's own application (checked and encrypted as any own token) and proposes the channels and roles; the server is bound through the guided setup with Manage Server.
- **B.** Yes, directly, audited as the operator's act.
- **Recommendation: A.** Binding without Manage Server is a hole every later reviewer would have to reason about; the setup takes a minute.

### D12. Can the bot DM people on its own?
- **A.** No: every DM is a Notify delivery (`notify.dm.requested`) the person chose.
- **B.** Yes, for its own reminders.
- **Recommendation: A.** One place decides who gets what, honouring quiet hours and choices; the legacy's tournament DMs become Notify topics in step 7.

### D13. The hot game and its covers
- **A.** The bot only counts; Games detects surges and owns covers, including the Steam fallback ([games.md](../../../contracts/games.md)).
- **B.** As #122 says: the bot detects hot games and finds covers.
- **Recommendation: A.** The contracts already decided it; #122's criterion moves to the Games track (Proposed issue changes).

### D14. Ticker windows from Discord
The legacy's `/ticker schedule add` takes a date and times; Screen's ticker windows repeat weekly. The roadmap keeps the command names.
- **A.** `/ticker schedule add` with the days and the times, weekly, as Screen keeps them; `list` and `remove` as they were ([mockup 09](09-ticker-and-photos.svg)).
- **B.** Add one-off dated windows to Screen, so the command keeps its date.
- **Recommendation: A.** An event is a weekend: "Saturday 09:00–11:00" is what people type, and the event ends before the window comes round again (a clone copies it for the next one, on purpose). **Contract:** none.

### D15. Whose name goes on a photo from Discord?
- **A.** The author's platform name when they have one; otherwise no name.
- **B.** Their Discord display name.
- **Recommendation: A.** Screens show platform names only (bot.md: "Only platform users are named"); a Discord name is free text the event never moderated.

### D16. Bus delivery and retries
#121 asks for "retries and a dead-letter log instead of best-effort HTTP".
- **A.** Use the kit's bus consumer; where it lacks dead-lettering, add it to the kit in #121's package, for every module.
- **B.** A retry loop inside the bot.
- **Recommendation: A.** Delivery rules belong to the kit, once.

## E · Edge cases and failure

### E1. Discord down or the client not ready
- **A.** One-off posts are not kept (the contract's rule); living messages are brought up to date when the client is ready again.
- **B.** Queue every post until Discord is back.
- **Recommendation: A.** A queued "last call" an hour late is wrong; a board edited to the present is right.

### E2. Someone deletes or unpins a living message
- **A.** The bot posts a new one at the next change and pins it; the check notes it.
- **B.** The check shows a gap until an admin acts.
- **Recommendation: A.**

### E3. A bound channel or role is deleted in Discord
- **A.** Its purpose shows "Missing" on Channels and in the check; posts for it are dropped; a mapped role that is gone grants nothing.
- **Recommendation: A.**

### E4. A burst (30 "it's here" DMs, many order edits)
- **A.** Per-event queue as the contract says; edits of one message coalesce to the latest state; DMs keep their order.
- **Recommendation: A.**

### E5. The 3-second answer limit
Discord needs an answer to an interaction within 3 seconds.
- **A.** Every command that calls a module defers at once ("thinking…") and answers within 10 seconds, or says "Demo Event did not answer in time. Nothing was sent." ([mockup 07](07-attendee-commands.svg)), and makes sure nothing was sent: the call carries an idempotency key.
- **Recommendation: A.**

### E6. "Create what is missing" when the bot's role is too low
Discord lets a bot manage only roles below its own.
- **A.** The check names it ("Move the bot's role above Crew"), and setup creates only channels until it is fixed.
- **Recommendation: A.**

### E7. Someone hides their activity mid-event
- **A.** They leave every live list and count at the next read; the counts already kept stay, as they name nobody.
- **Recommendation: A.**

### E8. A member who never signed in to the platform
Already decided: counted, never named. **Question:** should the Roles page list them? **Recommendation:** a count only ("1 not signed in", [mockup 05](05-roles-and-rights.svg)), never their Discord names.

## O · Operations and scale

### O1. A large event (2,000 members)
- **A.** Presence kept in memory per guild and flushed to Valkey every few seconds; counts every minute; a soak test with a fake gateway at 2,000 members and a burst of 500 updates a second.
- **Recommendation: A.**

### O2. More than one bot container
- **A.** One container in step 6, with the lease the contract asks for already in place; sharding when the shared bot nears Discord's limit for one connection.
- **Recommendation: A.**

### O3. Testing against Discord
- **A.** A fake Discord (REST and gateway) in the kit's test tools, used by every bot issue's tests and the stack test; the exit check by hand on a real test server.
- **B.** Tests against a real test server in CI.
- **Recommendation: A.** CI must not hold a bot token or depend on Discord's uptime; #124 already asks for a fake API.

### O4. Command registration on a new platform version
- **A.** The bot keeps a hash of each server's registered set and writes only when it changes, so a deploy across many servers stays within Discord's daily command limits.
- **Recommendation: A.**

### O5. The switch's runbook
- **A.** The import's README holds the cut-over steps (stop the legacy bot, dry run, import, finish the bind in setup, check); step 11 follows it.
- **Recommendation: A.**

### O6. Who watches the bot on the night?
- **A.** The Overview tab and the Health page for the crew ([mockup 13](13-bot-health.svg)); the stack's health shows the shared client; alerts reach Discord with step 8.
- **Recommendation: A.**

## P · Plan and scope

### P1. The direction
- **A.** The old bot, for many events.
- **B.** Discord first.
- **C.** The living server.
- **Recommendation: C** (the brief's [Recommended direction](../step-6-bot.md#recommended-direction-the-living-server)).

### P2. The issue set
- **Recommendation:** as the brief's [Proposed issue changes](../step-6-bot.md#proposed-issue-changes): #121, #122, #123, #124 and #125 kept and rewritten; the tournament side moved to step 7 (P3); crew alert DMs moved to step 8 (P5); the hot game moved to the Games track (D13).

### P3. The tournament side (OC8)
- **A.** Build it in step 6 against the catalog with contract tests, live with step 7 (today's #123 criterion).
- **B.** Move it to step 7, built with the tournament module's events and commands.
- **C.** Port only the pure parts (channel naming, create once, dwell) in step 6, with no command.
- **Recommendation: B.** Step 7 rewrites the tournament contract; building against provisional events means writing it twice. The legacy's pure parts wait well, with their tests.

### P4. The Games catalogue and surges
The screens' "now playing" names and the hot game need Games' catalogue and surges, which no module builds yet.
- **A.** Run the Games track's first package (catalogue, matching, surges) beside step 6, so both meet at step 6's gate.
- **B.** Step 6's exit shows counts only; the hot game waits for the Games track.
- **Recommendation: A** if the Games track's plan is accepted in time; otherwise B, and step 6's exit says so.

### P5. Crew alert DMs with an Acknowledge button
- **A.** Move them to step 8, with the alert relay (OC4).
- **B.** Build the DM-with-a-button now, in Notify.
- **Recommendation: A.** Nothing in step 6 raises a crew alert that needs an acknowledgement; step 8 does.

### P6. Risk classes
- **Recommendation:** #121 high (tokens, rights, the acting token); #122 high (presence and the opt-out filter, even with counts only); #123 normal; #124 normal (the mappings are enforced in #121); #125 high (a token import). The Discord page's role mapping screen sits in #124 and calls #121's API.

### P7. The exit criteria
- **Recommendation:** as the brief's [Proposed exit criteria](../step-6-bot.md#proposed-exit-criteria).

### P8. `/finals`
- **A.** The Finals track registers `/finals` under its own flag, on #121's command framework.
- **Recommendation: A.**

### P9. Contract parts and their order
- **Recommendation:** each contract part travels with the package whose code first uses it ([0029](../../decisions/0029-additive-contracts-ship-with-consumers.md)): bot.md's commands, flags and events, admin's role-derived rights and acting token, and the menu item with #121; `GET /api/bot/stats` and `bot.voice.counted` with #122; Screen's `voice_rooms` source with #122 too (it is its first user); nothing new in #123 beyond the commands' flags; the setup endpoints with #124. All additive.
