# Plan: issue #122 — the living server: counts, commands, living messages and DMs

Package `bot-living-server`, branch `122-feat-bot-the-living`. Step 6, package 2 of the step's order ([step-6-bot.md](../briefs/step-6-bot.md#order-packages-by-dependency-chain)). Sources: the accepted step 6 plan ([step-6-bot.md](../briefs/step-6-bot.md#plan), [Chat activity](../briefs/step-6-bot.md#chat-activity-d6-b), [decisions.md](../briefs/step-6-bot/decisions.md), the [question bank](../briefs/step-6-bot/questions.md)), mockups [07](../briefs/step-6-bot/07-attendee-commands.svg)–[12](../briefs/step-6-bot/12-on-the-screen.svg) and [16](../briefs/step-6-bot/16-chat-activity.svg), [bot.md](../../contracts/bot.md), [events.md](../../contracts/events.md#bot), [screen.md](../../contracts/screen.md), [tenants.md](../../contracts/tenants.md#privacy-and-retention), [admin.md](../../contracts/admin.md), the lead's comment on the issue (reuse links 1–3 and 5 of #121, no rights from Discord roles), the legacy canccubot, and main at 3b7018b. This plan changes no contract and no code.

## Why a plan first
1. **Size.** About 12,000 changed lines (below), three times the package limit of about 4,000. The issue's own Risk line says the lead splits it at its link when it passes the limit; workers do not split issues. Its two-way split (counts, live state and the opt-out filter; then commands, living messages and DMs) still leaves halves of about 6,700 and 5,300 lines. It falls apart cleanly at four links, each with its own tests (below).
2. **The opt-out filter has no source on main.** Every output must leave out "someone who hid" (E7). The flag `presence_opt_out` lives on the platform user ([tenants.md](../../contracts/tenants.md#privacy-and-retention)): `GET`/`PUT /api/tenants/me/privacy`, `GET /internal/tenants/users/{user_id}` and `tenants.privacy.changed` are in the contract only; the tenants module serves none of them (#150, open and blocked by #52). Notify's own opt-out fix waits on the same read (#294, blocked). Nobody can set the flag today, so a filter built now filters nothing real; how the links stand until #150 is the lead's call (Question 2).
3. **The bot sees Discord ids; the flag and the names are on platform users.** The live state names platform users only (`user_id` and the platform name, never a Discord id, [bot.md](../../contracts/bot.md#who-plays-what)), and the filter needs the flag per Discord id. No module path answers "which user, name and flag is this Discord id": admin maps a Discord id only inside the acting token ([admin.md](../../contracts/admin.md)). That read is a new contract part with real design in it (C1), and it is personal data.
4. **Mockup 16 first.** The `messages` metric is "added only after the product owner has seen mockup 16". Nothing on the issue or the plan PR records that they have (Question 3).

## What #122 builds on (state on main)
| Needs | State | Note |
|---|---|---|
| Gateway feeds routed by guild, dropped under their flag (`PRESENCE_UPDATE`, `GUILD_MEMBER_*`, `VOICE_STATE_UPDATE`, `MESSAGE_CREATE`) | Built (`router.py` `FEEDS`); no handler yet (`main.py`) | Link 1 adds the handlers |
| The command framework, components, link buttons, the guard, the acting token, the fake Discord (REST, gateway, transcripts) | Built (#121 links 1–3) | Reused as is |
| Purposes (`announcements`, `now_and_next`, `food`, `photos`, `crew`) and `bot.purposes.changed` | Built (#121 link 5) | Posts follow them; a `missing` purpose posts nowhere |
| `GET`/`POST` `/api/bot/presence/playing` and `/voice` | Contract only | Link 2 |
| `bot.presence.counted`, `bot.activities.counted` | Outlined in events.md; Screen and Moments consume `bot.presence.counted` | Link 1 emits them |
| Moments' announcements API and `moments.announcement.sent`, `.changed`, `.withdrawn` | Built (#115) | Link 3 |
| Screen's ticker (`PUT /api/screen/ticker`, windows) and photos (`POST /api/screen/photos` with `source_ref`) | Built | Link 3 |
| `pizza.order.*`, agenda's now and next and `discord_channel` | Built (step 5, agenda) | Link 4 |
| `notify.dm.requested` | Emitted by notify (`dm.py`) | Link 4 |
| `presence_opt_out`, the tenants user read, `tenants.privacy.changed` | Contract only (#150) | Question 2 |
| Discord id → user, name | Inside admin only | C1, Question 2 |

## Proposed contract parts
All additive. Each ships in the link whose code uses it ([0029](../decisions/0029-additive-contracts-ship-with-consumers.md)); none is breaking.

| # | Where | What |
|---|---|---|
| C1 | admin.md (with tenants.md) | **People by Discord id.** `POST /internal/admin/people/by-discord?tenant_id=` with `{discord_user_ids}` (at most 200) → `[{discord_user_id, user_id, name, presence_opt_out}]` for members of the event only; ids with no account, or no member, are left out. The bot's service identity only (403 `service_forbidden` for any other caller). Admin reads `presence_opt_out` from tenants' user read (#150). The bot caches an answer at most 60 s in Valkey per event, and drops a user's entry at once on `tenants.privacy.changed` (which gains `discord_user_id`, additive), so opting out takes effect on the next read. No user map is kept beyond that cache |
| C2 | bot.md, events.md | **Counts.** What each feed keeps: per minute `members`, `online`, `idle`, `dnd`, `in_voice`, players per activity, `messages`; folded per hour on Postgres with player-minutes per activity; no user id, name, channel or text. `bot.presence.counted` and `bot.activities.counted` as outlined; new `bot.voice.counted` (per public voice room: `channel_id`, `name`, `member_count`; Screen's `voice_rooms`, D8) and `bot.messages.counted` (hourly, `messages`, `interval_seconds` 3600, event-wide `public`). `GET /api/bot/stats?hours=` (at most 72): the hourly series (`online`, `in_voice`, `messages`) and the top games by player-hours; counts only, so any caller of the event may read it, a guest included. The counts stay with the event, anonymous; the live state goes at archiving |
| C3 | bot.md | **The module path** for Screen: `GET /internal/bot/presence/playing` and `/voice` with the service identity, the same answer as the public paths, so Screen's `now_playing` and `voice_rooms` read what the hub reads |
| C4 | screen.md | `activity_graph`'s `metric: messages` with `messages_peak` beside `online_peak` and `in_voice_peak` ([Chat activity](../briefs/step-6-bot.md#chat-activity-d6-b)); `voice_rooms`' view-model (`rooms`: `name`, `member_count`, at most 6, busiest first) from `bot.voice.counted`; `now_playing` reads C3 |
| C5 | bot.md | **The commands** with their flags: `/food` (`pizza.enabled`), `/now`, `/hub`, `/privacy`, `/announce` (the right `moments.announce`), `/ticker` (right `screen.ticker.write`), the message commands "Send to the screen" and "Remove from the screen" (flag `screen.photos`, right `screen.photos.write`); each answer private and deferred, the "no" answers of mockup 07 |
| C6 | bot.md | **Posts:** the announcement post (one per announcement, edited on `.changed`, marked withdrawn on `.withdrawn`; an urgent one mentions the event's picked role, `announce_role` in the bot's settings, none by default, L3), the pinned now-and-next board in `now_and_next`, one message per food order in `food` (counts and the holder only, L9), the run-of-show posts (L7 A: in `announcements`, at the item's shortest lead time, an embed with title, start in the event's time zone and place); edits at most once a minute per channel; re-synced after a gap; posted again if deleted or unpinned. Kept: the message ids per purpose and per order, deleted with the binding. DMs: `notify.dm.requested` delivered in order through the event's queue. Fills "Not in this contract" for these |

## Design (holds for every link)
| # | Decision | Reason |
|---|---|---|
| D1 | **Trackers as pure classes** ported from the legacy `presence_tracker`, `voice_tracker`, `game_detector` and `stats_history`, with the clock injected; each fed from the gateway and from `GUILD_CREATE`'s snapshot; one test file per tracker | The criterion's "built on the legacy trackers, a test for each"; the legacy tests carry over |
| D2 | **Live state in Valkey** per event (`bot:live:<tenant>:presence`, `:voice`, hashes by Discord id, no names), rebuilt from `GUILD_CREATE` after a reconnect; the minute's counters in Valkey (`INCR` with a 2-hour expiry), flushed once a minute to `bot_counts_minute` and folded hourly into `bot_counts_hour` by one job holding the lease | Survives a restart (no count lost: a minute not yet flushed is still in Valkey); presence never on Postgres (D7) |
| D3 | **The filter at read time:** counts and lists are built from the live state minus the opted-out (C1) when the minute is counted and when an answer is built; a message's author id is read for the filter, bot and webhook checks and never stored; `tenants.privacy.changed` drops that person's live entries at once | E7: "from the next read", in every output, messages included |
| D4 | **Chat activity** counts `MESSAGE_CREATE` only in channels whose `@everyone` overwrite allows View channel (from the guild's channel cache), never DMs or threads of private channels | D6 B: "channels everyone can read" |
| D5 | **Every post and reply** that carries other people's words goes through #121's guard (`allowed_mentions` none, the urgent role the one exception; `strip_foreign_links` with the event's hosts); every page is a link button | The issue's guard criterion; one test per post with `@everyone` and a foreign link |
| D6 | **Living messages** as one `LivingMessage` store (purpose, key, message id, last hash, last edit) and one editor loop per channel that coalesces edits to one a minute and checks for a deleted or unpinned message on each gap (`GUILD_CREATE`, resume, a 404 on edit) | L1, L2, E1, E2, E4; one mechanism for the board, the food orders and the announcement posts |
| D7 | **Commands call modules** with the acting token (#121), the interaction id as idempotency key, answer in 10 s or E5's sentence | D2, E5 |
| D8 | **Soak test** in the bot's tests against the in-process fake gateway: 2,000 members, 500 updates a second for 10 s, every count right and the minute flushed | O1; no stack needed |

## Size by area (source plus tests, estimated)
| Area | Estimate |
|---|---|
| A. Trackers (presence, voice, activities with the games catalogue match, messages), minute counters, hourly fold, player-minutes, migrations, a test each | 2,300 |
| B. Publishing the four counted events, `GET /api/bot/stats`, retention (live state at archiving), restart and soak tests | 1,100 |
| C. The opt-out source and filter (C1 in admin and the bot, the cache, `tenants.privacy.changed`), tested at each output | 900 |
| D. The live state reads (`/presence/playing`, `/voice`, the module path), names from C1 | 900 |
| E. Screen: `voice_rooms` widget and its render, `activity_graph`'s `messages` and `messages_peak`, `now_playing` on C3, screenshots | 1,500 |
| F. Crew commands: `/announce` (form, preview, Send, the post's life), `/ticker` (six subcommands), the two message commands | 2,000 |
| G. Attendee commands and the "no" answers | 500 |
| H. Living messages: the board, food orders, run-of-show posts, the editor loop, re-sync and repost | 1,700 |
| I. Notify's DMs in order | 300 |
| J. Transcripts against mockups 07–10, the stack test (a pizza and an agenda event to an edited message) | 500 |
| K. Contract parts C1–C6, README, flags | 700 |
| **Total** | **≈ 12,400** (±25%) |

## Proposed split (for the lead)
Four links, all high, each one issue and one package; the contract part of each travels with it.

| Link | Content | ≈ Lines | Needs |
|---|---|---|---|
| 1. Counts and chat activity | A, B; C2; the filter's seam for counts (D3) | 3,400 | #121 (merged) |
| 2. The live state, the opt-out filter and Screen's widgets | C, D, E; C1, C3, C4; the filter wired into link 1's counts | 3,300 | 1; #150's privacy read (Question 2); mockup 16 seen (Question 3) |
| 3. Commands | F, G and the guard on their replies and the announcement post; C5, C6's announcement part | 2,700 | #121; parallel with 1 and 2 |
| 4. Living messages and DMs | H, I, J; C6 | 2,500 | 3 (shares the post store and texts) |

The criteria map as: counts, chat activity, published events, `GET /api/bot/stats`, retention of counts, survives and the soak → 1; the live state, the opt-out filter at every output, the `messages` metric, `voice_rooms` and `now_playing` → 2; crew and attendee commands, link buttons in their answers, the guard on the announcement post and the ticker replies → 3; living messages, the run-of-show posts, DMs, transcripts and the stack test → 4.

## Questions for the lead
1. **Split:** the four links above, or the issue's own two halves (≈ 6,700 and 5,700) taken whole?
2. **The opt-out source:** (a) link 2 waits for #150's privacy flags and user read, as #294 does (recommended: the filter is the issue's high-risk heart, and a seam that answers "nobody hid" passes every test while filtering nothing); or (b) a seam in one function, fail closed for names (no one listed by name until #150) and open for counts (nobody can set the flag yet), named in the README and replaced by #150.
3. **Mockup 16:** has the product owner seen it, so link 2 may add the `messages` metric?
4. **C1's shape:** admin answers people by Discord id with the flag (admin already maps Discord ids for the acting token), or the bot reads tenants' user read per user once #150 serves it, with admin only for the mapping?

## Decisions made
- Plan tier, not feature: the size, the missing opt-out source and the new personal-data read (C1).
- Counts in Valkey per minute and on Postgres per hour; who plays what only in Valkey, live; never a user id, name, channel or text on Postgres (D2, D7).
- The filter is applied when a count or an answer is built, not when data arrives, so "from the next read" holds without a deletion job (D3).
- One living-message mechanism for the board, food orders and announcement posts (D6).
