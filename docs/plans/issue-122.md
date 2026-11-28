# Plan: issue #122 — the living server: counts, commands, living messages and DMs

Package `bot-living-server`, branch `122-feat-bot-the-living`. Step 6, package 2 of the step's order ([step-6-bot.md](../briefs/step-6-bot.md#order-packages-by-dependency-chain)). Sources: the accepted step 6 plan ([step-6-bot.md](../briefs/step-6-bot.md#plan), [Chat activity](../briefs/step-6-bot.md#chat-activity-d6-b), [decisions.md](../briefs/step-6-bot/decisions.md), the [question bank](../briefs/step-6-bot/questions.md)), mockups [07](../briefs/step-6-bot/07-attendee-commands.svg)–[12](../briefs/step-6-bot/12-on-the-screen.svg) and [16](../briefs/step-6-bot/16-chat-activity.svg), [bot.md](../../contracts/bot.md), [events.md](../../contracts/events.md#bot), [screen.md](../../contracts/screen.md), [tenants.md](../../contracts/tenants.md#privacy-and-retention), [admin.md](../../contracts/admin.md), the lead's comment on the issue (reuse links 1–3 and 5 of #121, no rights from Discord roles), the lead's answers on the plan PR (2026-11-28, below), the product owner's decision on #763 (what needs #150 leaves step 6 for the Go-public track), the legacy canccubot, and main at 3b7018b. This plan changes no contract and no code.

## Why a plan first
1. **Size.** About 12,400 changed lines (below), three times the package limit of about 4,000. The issue's own Risk line says the lead splits it at its link when it passes the limit; workers do not split issues. Its two-way split still leaves halves of about 6,700 and 5,700 lines. It falls apart at its links, each with its own tests (below).
2. **The opt-out filter has no source on main.** Every output must leave out "someone who hid" (E7). The flag `presence_opt_out` lives on the platform user ([tenants.md](../../contracts/tenants.md#privacy-and-retention)): `GET`/`PUT /api/tenants/me/privacy`, `GET /internal/tenants/users/{user_id}` and `tenants.privacy.changed` are in the contract only; the tenants module serves none of them (#150, open and blocked by #52). Nobody can set the flag before #150. Answered: no names in any output until #150; counts go through one seam (Answers, 2).
3. **The bot sees Discord ids; the flag and the names are on platform users.** The live state names platform users only (`user_id` and the platform name, never a Discord id, [bot.md](../../contracts/bot.md#who-plays-what)), and the filter needs the flag per Discord id. No module path answers "which user, name and flag is this Discord id": admin maps a Discord id only inside the acting token ([admin.md](../../contracts/admin.md)). That read is a new contract part with personal data in it (C1), designed here and built in link 2b (Answers, 4).
4. **Mockup 16.** The `messages` metric waited for the product owner to see mockup 16. Answered: they accepted it with the step 6 plan (Answers, 3).

## Answers (the lead, 2026-11-28, on the plan PR)
1. **Split:** four links, with link 2 cut in two. **2a** (step 6): Screen's widgets from counts, all anonymous. **2b** (Go-public track, blocked on #150): the named live state, C1, and the opt-out filter wired into every output; it replaces link 1's seam. Links 1, 3 and 4 as proposed. Order: 1, then 2a; 3 parallel with 1; 4 after 3.
2. **The opt-out source:** until 2b there are **no names in any output** (closed for names). Counts are built through one seam, `hidden_discord_ids(tenant)`, which answers the empty set until #150. The bot's README names it with the issue that replaces it (2b), as #121's B11 seams are named. Honest, because nobody can set `presence_opt_out` before #150 and counts carry no person. Its wiring is tested with a fake that hides someone: that person is dropped from every count, chat activity included.
3. **Mockup 16:** seen. The product owner accepted the step 6 plan PR #673 with mockup 16 in it, with their remarks on 06 and 07 (2026-11-20). Link 2a adds the `messages` metric.
4. **C1's shape:** admin answers people by Discord id in one batch call and reads `presence_opt_out` from tenants' user read. Admin already holds the Discord id map for the acting token, and the bot keeps no user map. Designed now (C1 below), built in 2b.

## What #122 builds on (state on main)
| Needs | State | Note |
|---|---|---|
| Gateway feeds routed by guild, dropped under their flag (`PRESENCE_UPDATE`, `GUILD_MEMBER_*`, `VOICE_STATE_UPDATE`, `MESSAGE_CREATE`) | Built (`router.py` `FEEDS`); no handler yet (`main.py`) | Link 1 adds the handlers |
| The command framework, components, link buttons, the guard, the acting token, the fake Discord (REST, gateway, transcripts) | Built (#121 links 1–3) | Reused as is |
| Purposes (`announcements`, `now_and_next`, `food`, `photos`, `crew`) and `bot.purposes.changed` | Built (#121 link 5) | Posts follow them; a `missing` purpose posts nowhere |
| The anonymous module paths for Screen (C3) | Not in the contract | Link 2a |
| `GET`/`POST` `/api/bot/presence/playing` and `/voice` (with names) | Contract only | Link 2b |
| `bot.presence.counted`, `bot.activities.counted` | Outlined in events.md; Screen and Moments consume `bot.presence.counted` | Link 1 emits them |
| Moments' announcements API and `moments.announcement.sent`, `.changed`, `.withdrawn` | Built (#115) | Link 3 |
| Screen's ticker (`PUT /api/screen/ticker`, windows) and photos (`POST /api/screen/photos` with `source_ref`) | Built | Link 3 |
| `pizza.order.*`, agenda's now and next and `discord_channel` | Built (step 5, agenda) | Link 4 |
| `notify.dm.requested` | Emitted by notify (`dm.py`) | Link 4 |
| `presence_opt_out`, the tenants user read, `tenants.privacy.changed` | Contract only (#150) | The seam until 2b |
| Discord id → user, name | Inside admin only | C1, link 2b |

## Proposed contract parts
All additive. Each ships in the link whose code uses it ([0029](../decisions/0029-additive-contracts-ship-with-consumers.md)); none is breaking.

| # | Link | Where | What |
|---|---|---|---|
| C1 | 2b | admin.md (with tenants.md) | **People by Discord id.** `POST /internal/admin/people/by-discord?tenant_id=` with `{discord_user_ids}` (at most 200) → `[{discord_user_id, user_id, name, presence_opt_out}]` for members of the event only; ids with no account, or no member, are left out. The bot's service identity only (403 `service_forbidden` for any other caller). Admin reads `presence_opt_out` from tenants' user read (#150). The bot caches an answer at most 60 s in Valkey per event, and drops a user's entry at once on `tenants.privacy.changed` (which gains `discord_user_id`, additive), so opting out takes effect on the next read. No user map is kept beyond that cache |
| C2 | 1 | bot.md, events.md | **Counts.** What each feed keeps: per minute `members`, `online`, `idle`, `dnd`, `in_voice`, players per activity, `messages`; folded per hour on Postgres with player-minutes per activity; no user id, name, channel or text. `bot.presence.counted` and `bot.activities.counted` as outlined; new `bot.voice.counted` (per public voice room: `channel_id`, `name`, `member_count`; Screen's `voice_rooms`, D8) and `bot.messages.counted` (hourly, `messages`, `interval_seconds` 3600, event-wide `public`). `GET /api/bot/stats?hours=` (at most 72): the hourly series (`online`, `in_voice`, `messages`) and the top games by player-hours; counts only, so any caller of the event may read it, a guest included. Every count leaves out `hidden_discord_ids(tenant)` (D3). The counts stay with the event, anonymous; the live state goes at archiving |
| C3 | 2a | bot.md | **The module paths** for Screen, with the service identity, counts only: `GET /internal/bot/presence/playing` (per game: `game_id`, `name`, `player_count`; hidden games and unmatched activities as [Who plays what](../../contracts/bot.md#who-plays-what) rules them) and `GET /internal/bot/presence/voice` (per public voice room: `channel_id`, `name`, `member_count`). Never who plays or who is in a room: no user id, name or Discord id. `as_of` and `available: false` as the public paths. 2b adds the lists of people to them, additively, with the named public paths |
| C4 | 2a | screen.md | `activity_graph`'s `metric: messages` with `messages_peak` beside `online_peak` and `in_voice_peak` ([Chat activity](../briefs/step-6-bot.md#chat-activity-d6-b)); `voice_rooms`' view-model (`rooms`: `name`, `member_count`, at most 6, busiest first) from `bot.voice.counted` and C3; `now_playing` reads C3, players per game; its `names` stay absent (`props.show_names` has no source until 2b) |
| C5 | 3 | bot.md | **The commands** with their flags: `/food` (`pizza.enabled`), `/now`, `/hub`, `/privacy`, `/announce` (the right `moments.announce`), `/ticker` (right `screen.ticker.write`), the message commands "Send to the screen" and "Remove from the screen" (flag `screen.photos`, right `screen.photos.write`); each answer private and deferred, the "no" answers of mockup 07 |
| C6 | 3, 4 | bot.md | **Posts:** the announcement post (link 3; one per announcement, edited on `.changed`, marked withdrawn on `.withdrawn`; an urgent one mentions the event's picked role, `announce_role` in the bot's settings, none by default, L3), the pinned now-and-next board in `now_and_next`, one message per food order in `food` (counts and the holder only, L9), the run-of-show posts (L7 A: in `announcements`, at the item's shortest lead time, an embed with title, start in the event's time zone and place); edits at most once a minute per channel; re-synced after a gap; posted again if deleted or unpinned. Kept: the message ids per purpose and per order, deleted with the binding. DMs: `notify.dm.requested` delivered in order through the event's queue. Fills "Not in this contract" for these |

## Design (holds for every link)
| # | Decision | Reason |
|---|---|---|
| D1 | **Trackers as pure classes** ported from the legacy `presence_tracker`, `voice_tracker`, `game_detector` and `stats_history`, with the clock injected; each fed from the gateway and from `GUILD_CREATE`'s snapshot; one test file per tracker | The criterion's "built on the legacy trackers, a test for each"; the legacy tests carry over |
| D2 | **Live state in Valkey** per event (`bot:live:<tenant>:presence`, `:voice`, hashes by Discord id, no names), rebuilt from `GUILD_CREATE` after a reconnect; the minute's counters in Valkey (`INCR` with a 2-hour expiry), flushed once a minute to `bot_counts_minute` and folded hourly into `bot_counts_hour` by one job holding the lease | Survives a restart (no count lost: a minute not yet flushed is still in Valkey); presence never on Postgres (D7) |
| D3 | **One seam for the filter:** `hidden_discord_ids(tenant)` (one function, in the bot) answers the set of Discord ids to leave out; every count (presence, voice, activities, messages) and every answer is built from the live state minus that set, at the moment it is built. Until 2b it answers the empty set, and no output carries a name; the README lists it with the bot's seams and names 2b as its replacement. A message's author id is read for the filter, bot and webhook checks and never stored. Link 1 tests the wiring with a fake seam that hides one member: that member is dropped from every count, chat activity included. Link 2b answers it from C1 and drops that person's live entries at once on `tenants.privacy.changed` | E7 "from the next read" in every output, without a deletion job; the lead's answer 2 |
| D4 | **Chat activity** counts `MESSAGE_CREATE` only in channels whose `@everyone` overwrite allows View channel (from the guild's channel cache), never DMs or threads of private channels | D6 B: "channels everyone can read" |
| D5 | **Every post and reply** that carries other people's words goes through #121's guard (`allowed_mentions` none, the urgent role the one exception; `strip_foreign_links` with the event's hosts); every page is a link button | The issue's guard criterion; one test per post with `@everyone` and a foreign link |
| D6 | **Living messages** as one `LivingMessage` store (purpose, key, message id, last hash, last edit) and one editor loop per channel that coalesces edits to one a minute and checks for a deleted or unpinned message on each gap (`GUILD_CREATE`, resume, a 404 on edit) | L1, L2, E1, E2, E4; one mechanism for the board, the food orders and the announcement posts |
| D7 | **Commands call modules** with the acting token (#121), the interaction id as idempotency key, answer in 10 s or E5's sentence | D2, E5 |
| D8 | **Soak test** in the bot's tests against the in-process fake gateway: 2,000 members, 500 updates a second for 10 s, every count right and the minute flushed | O1; no stack needed |
| D9 | **No names before 2b:** links 1, 2a, 3 and 4 put no guild member's name or id in any output: the counts, C3, Screen's widgets and the posts carry none. The posts of links 3 and 4 name only platform users other modules already give (an announcement's author, a food order's holder) | The lead's answer 2: closed for names until the opt-out has a source |

## Size by area (source plus tests, estimated)
| Area | Estimate |
|---|---|
| A. Trackers (presence, voice, activities with the games catalogue match, messages), minute counters, hourly fold, player-minutes, migrations, a test each | 2,300 |
| B. Publishing the four counted events, `GET /api/bot/stats`, retention (live state at archiving), restart and soak tests | 1,100 |
| C. The seam `hidden_discord_ids` and its wiring test with a fake that hides someone | 150 |
| D. The anonymous module paths (C3) | 400 |
| E. Screen: `voice_rooms` widget and its render, `activity_graph`'s `messages` and `messages_peak`, `now_playing` as players per game on C3, screenshots | 1,500 |
| F. The opt-out from C1 (admin's batch read, the bot's cache, `tenants.privacy.changed`), replacing the seam, tested at each output | 900 |
| G. The named live state (`/api/bot/presence/playing` and `/voice` with names, `now_playing`'s `names`) | 700 |
| H. Crew commands: `/announce` (form, preview, Send, the post's life), `/ticker` (six subcommands), the two message commands | 2,000 |
| I. Attendee commands and the "no" answers | 500 |
| J. Living messages: the board, food orders, run-of-show posts, the editor loop, re-sync and repost | 1,700 |
| K. Notify's DMs in order | 300 |
| L. Transcripts against mockups 07–10, the stack test (a pizza and an agenda event to an edited message) | 500 |
| M. Contract parts C1–C6, README, flags | 700 |
| **Total** | **≈ 12,750** (±25%) |

## The split
Five issues (links 1, 2a, 2b, 3, 4), all high, each one package; the contract part of each travels with it. The lead files them after this plan merges.

| Link | Content | ≈ Lines | Needs | Where |
|---|---|---|---|---|
| 1. Counts and chat activity | A, B, C; C2 | 3,700 | #121 (merged) | Step 6 |
| 2a. Screen's widgets from counts | D, E; C3, C4 | 2,100 | 1 | Step 6 |
| 2b. The named live state and the opt-out filter | F, G; C1, the named paths | 1,800 | 1, 2a, #150 | Go-public track, blocked on #150 |
| 3. Commands | H, I and the guard on their replies and the announcement post; C5, C6's announcement part | 2,700 | #121 | Step 6, parallel with 1 |
| 4. Living messages and DMs | J, K, L; C6 | 2,500 | 3 (shares the post store and texts) | Step 6 |

Order: 1, then 2a; 3 parallel with 1; 4 after 3; 2b once #150 and 2a are merged. Each link's contract lines grow its size by their share of M.

The criteria map as: counts, chat activity, published events, `GET /api/bot/stats`, retention of counts, survives, the soak, and the filter's seam for counts → 1; the `messages` metric, `voice_rooms` and `now_playing` as players per game → 2a; the live state with names, the opt-out filter at every output and `now_playing`'s names → 2b; crew and attendee commands, link buttons in their answers, the guard on the announcement post and the ticker replies → 3; living messages, the run-of-show posts, DMs, transcripts and the stack test → 4.

## Decisions made
- Plan tier, not feature: the size, the missing opt-out source and the new personal-data read (C1).
- Counts in Valkey per minute and on Postgres per hour; who plays what only in Valkey, live; never a user id, name, channel or text on Postgres (D2, D7).
- The filter is applied when a count or an answer is built, not when data arrives, so "from the next read" holds without a deletion job (D3).
- Until #150, one seam (`hidden_discord_ids`, the empty set) for counts and no names in any output; 2b replaces the seam with C1 (D3, D9; answer 2).
- Screen reads anonymous module paths (C3) in step 6; the named public paths come with 2b (answer 1).
- One living-message mechanism for the board, food orders and announcement posts (D6).
