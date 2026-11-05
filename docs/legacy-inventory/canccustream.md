# Legacy inventory: canccustream

The legacy stream relay, read in full so the product owner can confirm what exists before the tenancy foundation ([#47](../roadmap.md#2b-tenancy-foundation)) and the contracts ([#36](../roadmap.md#2c-event-catalog-and-screen-contract)) are designed. Roadmap step 2a, issue #75. Other legacy repos are out of scope here; each has its own inventory (#68 canccuplatform, #69 canccubot, #70 canccumanager, #71 canccusignage, #72 the signup site, #73 thefinals_mini_tourney, #74 canccudocs), and the summary (#76) joins them.

Nothing here is copied from the legacy repo: it is described. Short identifiers (route paths, file names, env var names, layout names) are kept so a later reader can find them. Event-specific values are named by kind and counted only (see [Event-specific content](#event-specific-content)).

## In short

- **What it is.** A self-hosted RTMP multi-camera compositor for one Linux host: an nginx RTMP server takes up to four inbound streams (OBS or FFmpeg), a Bash daemon re-encodes each into one of four slots with FFmpeg and runs a second FFmpeg that mixes the slots into one 1280×720 output stream, whose layout follows how many cameras are live. A small HTTP control API (spotlight, name overlay, mode, encode preset, publish info), outbound webhooks to the Discord bot, and a terminal dashboard complete it. No database, no web page, no Discord client of its own.
- **Is it still used?** No. The other legacy repos record it as decommissioned on 2026-10-23 and the repo as archived: the bot's `/stream` commands are stubs that answer "unavailable", the manager mutes its `canccustream` subsystem from the start, and the casting plan (in the canccuplatform and canccudocs repos) replaces it with a MediaMTX WebRTC relay that forwards one cast without re-encoding. Its last commit is from 2026-03-24. Note for the summary (#76): canccuplatform's agent notes call this repo the legacy MediaMTX cast relay; the code shows it is nginx-rtmp plus FFmpeg, and MediaMTX was only the planned replacement. The path that was to put the composite on the big screen (a `stream` directive to the signage server) was never built; no code for it exists here.
- **Size.** 34 tracked files, 6095 lines; 16 commits (10 changes, 6 merges) from 2026-03-19 to 2026-03-24, one author. Read at commit `cc6eb71` (`master`); every remote branch is merged into it.
- **Port verdict.** Drop the code. Nothing maps to a module as code: ingest, compositing, the slot daemon, scripts and units all go. The Cast track ([#67](../roadmap.md#cast), module `cast`) inherits ideas only: the low-latency encoder findings, the grace before reacting to a lost stream, the "active / idle with heartbeat" signal (as bus events), the "how to publish" info (as the cast page), and the test approach.

## Coverage

Every tracked file was examined; nothing was skipped. Lines are counted from the git blobs (`wc -l`); a symlink counts 0.

| Directory | Files | Lines | Files examined |
|---|---|---|---|
| `/` (root) | 4 | 1091 | `.gitignore`, `DOCUMENTATION.md`, `README.md`, `requirements-dev.txt` |
| `.venv-run/` | 2 | 5 | `.venv-run/lib64` (symlink), `.venv-run/pyvenv.cfg` |
| `.venv-run/bin/` | 3 | 0 | `.venv-run/bin/python`, `.venv-run/bin/python3`, `.venv-run/bin/python3.12` (symlinks to the system Python) |
| `.venv-run2/` | 2 | 5 | `.venv-run2/lib64` (symlink), `.venv-run2/pyvenv.cfg` |
| `.venv-run2/bin/` | 3 | 0 | `.venv-run2/bin/python`, `.venv-run2/bin/python3`, `.venv-run2/bin/python3.12` (symlinks) |
| `bin/` | 8 | 2588 | `bin/.gitkeep`, `bin/canccustream-manager.sh`, `bin/canccustream-monitor`, `bin/canccustream-publish-four-test-streams.sh`, `bin/canccustream-restart-and-monitor.sh`, `bin/canccustream-set-publish-ip-auto.sh`, `bin/canccustream-set-publish-ip.sh`, `bin/canccustream-up.sh` |
| `config/` | 5 | 152 | `config/.gitkeep`, `config/canccustream-manager.service`, `config/canccustream-up.service`, `config/nginx-rtmp.conf`, `config/override.conf` |
| `config/canccustream-manager.service.d/` | 1 | 8 | `config/canccustream-manager.service.d/50-execstart-from-repo.conf` |
| `tests/` | 6 | 2246 | `tests/.gitkeep`, `tests/conftest.py`, `tests/test_canccustream_monitor_cli.py`, `tests/test_control_api.py`, `tests/test_manager_modes.py`, `tests/test_monitor_data_collectors.py` |
| **Total** | **34** | **6095** | |

By kind: source 7 (`bin/canccustream-manager.sh` Bash with two embedded Python programs, `bin/canccustream-monitor` Python, five Bash helpers; 2587 lines); config 7 (nginx, two systemd units, two drop-ins, `.gitignore`, `requirements-dev.txt`) plus the two committed virtualenv stubs (10 files); migrations 0 (there is no database); tests 5 (4 test modules and `conftest.py`, 2245 lines; 46 test cases); docs 2 (`README.md`, `DOCUMENTATION.md`); empty placeholders 3 (`.gitkeep`). The git history was read too (all 16 subjects and bodies); no file was ever deleted. Untracked paths named in the files (`.venv/`, `plans/`, `/run/canccustream/`) are not in the repo.

To see what the tests really cover, the suite was run once from an exported copy (the legacy clone stays read-only): 35 passed, 11 failed. All 11 failures are the manager's stream discovery failing on a host whose `awk` is not GNU awk (see [Known problems](#known-problems) 1).

## Features

"Where" is the path in this repo; "Reached by" is how a person or service gets to it.

### User-visible features (what attendees and viewers see)

| # | Feature | Where | Reached by |
|---|---|---|---|
| U1 | Publish a camera or game feed: any RTMP encoder pushes to the `live` application under its own stream name; any codec, size and frame rate is accepted and normalized | `config/nginx-rtmp.conf`, `bin/canccustream-manager.sh` (`get_streams`, `start_live_worker`) | RTMP publish to `live/<name>` on port 1935 |
| U2 | Automatic layout: no stream → waiting slate; one → full screen; two → side by side; three → one on top, two below; four → 2×2 grid. A fifth stream waits for a free slot | `bin/canccustream-manager.sh` (`sync_slots`, main loop, `start_mixer`) | Watching `output/composite` |
| U3 | Waiting slate: black frame with a "waiting" title and a hint to use the bot's `/stream` command (the clock was removed in `9400af3`) | `bin/canccustream-manager.sh` (`start_mixer nostream`) | Composite while nothing is live |
| U4 | Per-slot placeholder: a black frame naming the free slot, so the mixer always has four inputs | `bin/canccustream-manager.sh` (`start_placeholder_worker`) | Internal `output/slotN`; visible when a slot is shown alone |
| U5 | Stream-name overlay: each tile shows its RTMP stream name in the bottom-left corner on a half-transparent box (font size by tile size); can be switched off | `bin/canccustream-manager.sh` (`drawtext_safe_name`, `start_mixer`) | Composite; toggled by `POST /names` |
| U6 | Spotlight: force one live slot to full screen until cleared; ignored while that slot has no stream | `bin/canccustream-manager.sh` (`read_spotlight_slot`, main loop) | `POST /spotlight` (also through nginx on 8080) |
| U7 | Cycle mode: show the mosaic first, hold it for one interval, then rotate full-screen through the live slots every `CYCLE_INTERVAL` seconds | `bin/canccustream-manager.sh` (`pick_cycle_target`, main loop) | `POST /mode`, `canccustream-manager.sh mode cycle` |
| U8 | Silent stereo AAC on every output so players such as VLC buffer less (publisher audio is never forwarded) | `bin/canccustream-manager.sh` (all FFmpeg calls) | Composite and slot streams |
| U9 | Watch or restream the composite: any RTMP player, OBS media source, recorder or restreamer can subscribe, many at once | `config/nginx-rtmp.conf` (`output` application) | RTMP play `output/composite` |

### Operator features

| # | Feature | Where | Reached by |
|---|---|---|---|
| O1 | Stream discovery every poll from the nginx stat XML: every publishing stream of every RTMP application (`output` included, not only `live`), minus the exact internal names `slot1`–`slot4` and `composite` | `bin/canccustream-manager.sh` (`get_streams`) | Daemon loop, `POLL_INTERVAL` |
| O2 | Offline grace: a slot is freed only after `OFFLINE_GRACE_CYCLES` missed polls in a row | `bin/canccustream-manager.sh` (`sync_slots`) | Daemon loop |
| O3 | Self-healing workers: a dead slot FFmpeg is restarted each poll; a dead mixer is restarted with the tail of its log copied into the manager log, and after two deaths in a row on a camera layout the mixer falls back to the slate | `bin/canccustream-manager.sh` (`sync_slots`, main loop) | Daemon loop |
| O4 | Mixer start guard: before a camera layout starts, wait until the needed `output/slotN` streams show as publishing in the stat XML, then settle briefly; on timeout show the slate | `bin/canccustream-manager.sh` (`wait_for_mixer_output_slots`, `switch_stream`) | `MIXER_WAIT_PUBLISH_SEC`, `MIXER_PUBLISH_SETTLE_SEC` |
| O5 | Encode preset `latency` (default) or `quality`; a change restarts all five encoders | `bin/canccustream-manager.sh` (`apply_encode_quality_vars`, main loop) | `POST /quality`, `canccustream-manager.sh quality …`, monitor key Q |
| O6 | Mode `auto` / `cycle` | `bin/canccustream-manager.sh` | `POST /mode`, `canccustream-manager.sh mode …` |
| O7 | Status print: the state file plus the API address | `bin/canccustream-manager.sh` (`show_status`) | `canccustream-manager.sh status` |
| O8 | Control API with fail-closed start: with a non-loopback bind and no token the daemon exits 1 after it has already started the slate; under systemd (`Restart=always`, 3 s) this becomes a restart loop every 3 s, not a stop | `bin/canccustream-manager.sh` (`start_control_api`) | Port 8091 |
| O9 | Publish info for the bot: the RTMP publish URL, notes and an update time | `bin/canccustream-manager.sh` (`GET /publish-info`) | Port 8091, or 8080 through nginx |
| O10 | Bot webhooks: `stream_active` on the first live stream and as a heartbeat, `stream_idle` when the last one goes; retries with backoff on 5xx and network errors only; tokens never logged | `bin/canccustream-manager.sh` (`send_canccubot_webhook`, main loop) | Outbound POST to `CANCCUBOT_WEBHOOK_URL` |
| O11 | State file and event log for tools | `bin/canccustream-manager.sh` (`write_state`, `log`) | Files in `RUNDIR` |
| O12 | Terminal dashboard: service status, the four inbound slots (live or placeholder, bitrate, size, fps, codec, uptime), the composite and its viewers (address, duration, dropped frames), recent log lines; optional Q key toggles the encode preset | `bin/canccustream-monitor` | Command `canccustream-monitor [--interval] [--stat-url] [--rundir] [--events]` |
| O13 | One-shot bring-up: runtime dir, a venv with `rich`, unit install, start nginx and the manager, the dashboard in tmux (or nohup); optional boot unit | `bin/canccustream-up.sh`, `config/canccustream-up.service` | Command `canccustream-up.sh [--install-and-start]`; boot |
| O14 | Restart nginx and the manager, then open the dashboard with the Q key enabled | `bin/canccustream-restart-and-monitor.sh` | Command with monitor flags |
| O15 | Set the publish URL in the manager's drop-in from a given host, or from the default-route IPv4, then restart the manager | `bin/canccustream-set-publish-ip.sh`, `bin/canccustream-set-publish-ip-auto.sh` | Commands `<host>`, `[--dry-run]` |
| O16 | Four synthetic test publishers (distinct patterns and tones) for layout testing | `bin/canccustream-publish-four-test-streams.sh` | Command with `RTMP_*`, `STREAM_PREFIX` |
| O17 | Service units: manager depends on nginx, restarts always after 3 s, `NoNewPrivileges`, `PrivateTmp`; drop-in sets paths, runtime dir, stop timeout and kill mode; a second drop-in runs the script from the clone | `config/canccustream-manager.service`, `config/override.conf`, `config/canccustream-manager.service.d/50-execstart-from-repo.conf` | systemd |
| O18 | nginx tuned for low delay: one worker (stable stat output), small buffer, short sync, no key-frame or video wait; HTTP health | `config/nginx-rtmp.conf` | nginx |
| O19 | Documentation: architecture, layouts, encoder table, API, env reference, units | `README.md`, `DOCUMENTATION.md` | Reading |

## Interfaces

### A. HTTP routes

**Control API (embedded Python `ThreadingHTTPServer`, `API_BIND`:`API_PORT`, default `127.0.0.1:8091`).** "Token" = `CANCCUSTREAM_CONTROL_TOKEN`, else `API_TOKEN`; when set, a protected route needs `Authorization: Bearer <token>` or `X-Api-Token: <token>` (plain string compare); when neither is set, every route is open. All responses are JSON.

| Method and path | Auth | Request | Response |
|---|---|---|---|
| `GET /health` | none | none | `200 {ok: true}` (the API process only, not the pipeline) |
| `GET /mode` | token | none | `200 {mode}` (`auto`\|`cycle`); `401 {error: "unauthorized"}` |
| `POST /mode` | token | JSON `{mode}`, form `mode=`, or plain text | `200 {ok, mode}`; `400 {error: "invalid_mode", allowed}`; `401` |
| `GET /quality` | token | none | `200 {quality}` (`latency`\|`quality`); `401` |
| `POST /quality` | token | JSON key `quality`, `preset` or `value`; form the same; plain text with an optional `quality ` prefix; aliases `low`, `high` | `200 {ok, quality}`; `400 {error: "invalid_quality", allowed}`; `401` |
| `GET /publish-info` | token | none | `200 {event_publish_url, notes?, updated_at?}`; `503 {error: "event_publish_url_not_configured"}`; `401` |
| `POST /spotlight` | token | JSON key `spotlight`, `stream`, `value`, `target` or `slot`; form the same minus `target`; plain text with an optional `spotlight ` prefix. Value `1`–`4`, `sN`, `slotN`, or `off`/`none`/empty | `200 {ok, spotlight}` (number or `"off"`); `400 {error: "invalid_spotlight", allowed: ["off",1,2,3,4]}`; `401` |
| `POST /names` | token | JSON key `names`, `enabled`, `value` or `state`; form `names`, `enabled`, `value`; plain text `on`/`off` with an optional `names ` prefix; booleans and 0/1 accepted | `200 {ok, names}` (0\|1); `400 {error: "invalid_names", allowed}`; `401` |
| any other path | none | | `404 {error: "not_found"}` (checked before auth) |

The API only writes the small state files in `RUNDIR`; the daemon applies them on its next poll. There is no request size limit and no rate limit.

**nginx HTTP (port 8080, all interfaces).**

| Method and path | Auth | Response |
|---|---|---|
| `GET /stat` | none | nginx-rtmp statistics XML (`rtmp_stat all`): uptime, per application and stream the name, publishing flag, `bw_in`, video size, fps, codec, time, and each client's address, time and dropped frames |
| `GET /health` | none | `200` plain text `ok` (nginx only) |
| `GET /publish-info` | passed through (control token) | Proxied to the same method and path on 8091 (`GET /publish-info`) with the `Authorization` header |
| `POST /spotlight` | passed through (control token) | Proxied to the same method and path on 8091 (`POST /spotlight`) with `Authorization` and `Content-Type` |

The two proxy locations set no `proxy_method`, so nginx forwards the client's own method: only `GET /publish-info` and `POST /spotlight` are answered; any other method on those paths reaches the API and gets its `404 {error: "not_found"}`. When the API has no token, both proxied routes are open to anyone who reaches 8080 ([Known problems](#known-problems) 2).

### B. RTMP endpoints (port 1935, all interfaces, no auth)

| Application and stream | Direction | Who |
|---|---|---|
| `live/<name>` | publish | Attendees' OBS or FFmpeg; names must be unique; `slot1`–`slot4` and `composite` are ignored; an idle publisher is dropped after 60 s |
| `live/<name>` | play | The slot workers (internal) |
| `output/slot1` … `output/slot4` | publish, play | Slot workers publish; the mixer plays (internal) |
| `output/composite` | publish | The mixer |
| `output/composite` | play | Any viewer, OBS media source, recorder or restreamer |
| `output/<any other name>` | publish | Not meant for publishers, but nothing stops it; the daemon takes such a stream as a camera and gives it a slot whose worker cannot start ([Known problems](#known-problems) 3) |

### C. Discord commands and handlers

None in this repo: it has no Discord client. The consumer was canccubot (#69), whose `/stream help`, `/stream on`, `/stream off`, `/stream spotlight`, `/stream auto` and `/stream status` called `GET /publish-info` and `POST /spotlight` and listened for the webhooks below; since the decommission they are stubs. The waiting slate still points viewers to `/stream`.

### D. WebSocket, SSE and streams

No WebSocket and no SSE. The media streams are RTMP (section B). The internal data feeds are files (section F) and the stat XML.

### E. Messages and events

There is no bus. The only messages are the outbound webhooks (enabled only when both `CANCCUBOT_WEBHOOK_URL` and `STREAM_WEBHOOK_TOKEN` are set):

| Event | Body | When |
|---|---|---|
| `stream_active` | `{event, active_slots: [1–4 sorted], spotlight?}` (`spotlight` only when the spotlit slot is live) | On the change from no live slot to at least one, then every `STREAM_HEARTBEAT_INTERVAL_SECONDS` while live |
| `stream_idle` | `{event}` | Once, on the change from live to none |

Each POST carries `Authorization: Bearer <STREAM_WEBHOOK_TOKEN>` and `Content-Type: application/json`, with a per-try timeout; network errors and 5xx retry with exponential backoff plus up to 0.25 s jitter until the attempt cap; 4xx stops at once. Outcomes go to the manager log as `webhook ok|retry|error|exhausted …`. No `stream_idle` is sent when the manager stops; the receiver must time out the heartbeat.

### F. Files as an interface

The daemon, the API, the CLI and the dashboard share files in `RUNDIR` (section [Data](#data)): the API and CLI write `mode`, `spotlight`, `names`, `quality`; the daemon writes `state.txt` and the logs; the dashboard reads `state.txt` and `manager.log` and may write `quality`.

### G. Commands

| Command | Arguments | Effect |
|---|---|---|
| `bin/canccustream-manager.sh` | none | Runs the daemon |
| `bin/canccustream-manager.sh mode` | `get` (default), `auto`, `cycle` | Prints or writes the mode file and exits |
| `bin/canccustream-manager.sh quality` | `get` (default), `latency`/`low`, `quality`/`high` | Prints or writes the preset file and exits |
| `bin/canccustream-manager.sh status` | none | Prints the state file, the preset and the API address |
| `bin/canccustream-monitor` | `--interval`, `--stat-url`, `--rundir`, `--events` | Full-screen dashboard |
| `bin/canccustream-up.sh` | none or `--install-and-start` | Bring-up (O13) |
| `bin/canccustream-restart-and-monitor.sh` | `-h`, monitor flags | O14 |
| `bin/canccustream-set-publish-ip.sh` | `<host>`, `-h` | O15 (needs root or sudo) |
| `bin/canccustream-set-publish-ip-auto.sh` | `--dry-run`, `-h` | O15 |
| `bin/canccustream-publish-four-test-streams.sh` | env only | O16; Ctrl+C stops all four |

### H. Scheduled and background jobs

| Job | Cadence | Runs in |
|---|---|---|
| Poll stat XML, reconcile slots, choose the layout, restart dead workers, write the state file | every `POLL_INTERVAL` (1 s) | manager |
| Offline grace | after `OFFLINE_GRACE_CYCLES` (8) missed polls | manager |
| Cycle rotation and the mosaic hold | every `CYCLE_INTERVAL` (30 s) | manager |
| Mixer readiness wait | up to `MIXER_WAIT_PUBLISH_SEC` (10 s), checking every 0.2 s, then `MIXER_PUBLISH_SETTLE_SEC` (1 s) | manager |
| Webhook heartbeat | every `STREAM_HEARTBEAT_INTERVAL_SECONDS` (10 s) while live | manager |
| Stat-failure log line | first failure and every tenth | manager |
| Detection snapshot log line | whenever the inbound set changes (`DEBUG_DETECTION=1`) | manager |
| Dashboard refresh | every `--interval` (1 s); `systemctl` calls time out after 1.5 s, stat fetch after 2 s | monitor |
| Idle publisher drop | 60 s without data | nginx |
| Manager restart on exit | 3 s after any exit | systemd |
| Bring-up at boot | once per boot, when the boot unit is installed | systemd oneshot |

## Data

There is no database and no migration. All state is in small files in `RUNDIR` (default `/run/canccustream`, a systemd runtime directory on tmpfs; fallback `/tmp/canccustream`), so it is lost at reboot and the defaults come back.

| Store | Keys or content | Writer → reader | Scope | Retention |
|---|---|---|---|---|
| `mode` | `auto` or `cycle` | API, CLI → daemon | per stream host | until reboot |
| `spotlight` | `off` or `1`–`4` | API → daemon | per stream host | until reboot |
| `names` | `1` or `0` | API → daemon | per stream host | until reboot |
| `quality` | `latency` or `quality` | API, CLI, dashboard → daemon | per stream host | until reboot |
| `state.txt` | `mode`, `active_assigned`, `target` (`nostream`, `s1`–`s4`, `layout2`–`layout4`), `spotlight`, `names`, `quality`, `slot1`–`slot4` (stream name or `(placeholder)`); the dashboard also accepts upper-case and `SLOT_N` forms and shows `POLL_INTERVAL`, `GRACE_CYCLES`, `DROP_IDLE_PUBLISHER` if present (the daemon never writes them) | daemon → dashboard, CLI | per stream host | rewritten every poll |
| `manager.log` | time-stamped events: slot changes, switches, mixer deaths with log tails, stat failures, webhook outcomes | daemon → dashboard | per stream host | appended without limit until reboot |
| `compositor.log`, `slot1.log`–`slot4.log` | FFmpeg warnings | FFmpeg | per stream host | appended without limit until reboot |
| `monitor.log` | dashboard output when tmux is missing | bring-up script | per stream host | until reboot |
| In-memory daemon state | slot → stream name, worker PIDs, miss counters, current layout, last switch time, mixer death streak, webhook state and last heartbeat | daemon | per stream host | process lifetime |
| systemd drop-in (`override.conf`) | env: paths, integration URLs, the publish URL, tokens | operator, publish-IP scripts → manager | per stream host | until changed |
| Virtualenv `.venv` | `rich` | bring-up script | per stream host | until deleted |

**Per event or global?** Nothing is tied to an event: no event id, no attendee, no history. Stream names are whatever publishers type (typically nicknames) and live only in memory, the state file and the logs until reboot. **Venue rather than event:** the whole repo belongs to a device at the venue: the stream host, its LAN address (the publish URL is built from it), its systemd setup, and the expectation that publishers and viewers are on the same LAN. Nothing describes backups; nothing needs one.

## Configuration

Secret values are never in the repo and none are copied here. "Daemon" is `bin/canccustream-manager.sh`.

### Daemon environment

| Name | Default | Meaning |
|---|---|---|
| `STAT_URL` | `http://localhost:8080/stat` | nginx stat XML |
| `LIVE_APP` | `rtmp://localhost/live` | Inbound base URL |
| `OUTPUT_APP` | `rtmp://localhost/output` | Slot base URL |
| `OUTPUT` | `$OUTPUT_APP/composite` | Where the mixer publishes |
| `RUNDIR` | `/run/canccustream` | Runtime directory (fallback `/tmp/canccustream`) |
| `MODE_FILE`, `STATE_FILE`, `LOG`, `NAMES_FILE`, `SPOTLIGHT_FILE`, `QUALITY_FILE` | `$RUNDIR/mode`, `state.txt`, `manager.log`, `names`, `spotlight`, `quality` | File paths (the fallback resets all but `LOG`) |
| `POLL_INTERVAL` | 1 | Seconds between polls (fractions work) |
| `CYCLE_INTERVAL` | 30 | Seconds per slot in cycle mode, and the mosaic hold |
| `DEFAULT_MODE` | `auto` | Mode when the file is missing or invalid |
| `OFFLINE_GRACE_CYCLES` | 8 | Missed polls before a slot is freed |
| `PUBLISH_MISS_GRACE` | 5 | Read but never used |
| `API_ENABLED` | 1 | `1` starts the control API |
| `API_BIND` | `127.0.0.1` | API address; non-loopback needs a token |
| `API_PORT` | 8091 | API port |
| `CANCCUSTREAM_CONTROL_TOKEN` | empty (secret) | API token |
| `API_TOKEN` | empty (secret) | Older alias, used when the first is empty |
| `CANCCUSTREAM_EVENT_PUBLISH_URL` | empty | Returned as `event_publish_url`; in practice the RTMP publish URL (`rtmp://<host>:1935/live`, set by the publish-IP scripts) |
| `CANCCUSTREAM_PUBLISH_NOTES` | empty | Optional `notes` |
| `CANCCUSTREAM_PUBLISH_UPDATED_AT` | empty | Optional `updated_at`, not validated |
| `CANCCUBOT_WEBHOOK_URL` | empty | Bot webhook URL; with the token, enables webhooks |
| `STREAM_WEBHOOK_TOKEN` | empty (secret) | Webhook bearer |
| `STREAM_HEARTBEAT_INTERVAL_SECONDS` | 10 | Heartbeat spacing (fraction cut, junk → 10) |
| `STREAM_WEBHOOK_TIMEOUT_SECONDS` | 5 | Per-try timeout |
| `STREAM_WEBHOOK_RETRY_MAX_ATTEMPTS` | 6 | Tries per send (minimum 1) |
| `STREAM_WEBHOOK_RETRY_BASE_SECONDS` | 1 | Backoff base |
| `STREAM_WEBHOOK_RETRY_MAX_SECONDS` | 16 | Backoff cap before jitter |
| `DEBUG_DETECTION` | 1 | Log the inbound set when it changes |
| `MIXER_WAIT_PUBLISH_SEC` | 10 | Mixer readiness wait; 0 disables (the tests do) |
| `MIXER_PUBLISH_SETTLE_SEC` | 1 | Pause after readiness |

Internal shell variables that look like settings but are not: `FFPID`, `NAMES_ENABLED`, `WEBHOOK_STATE`, `WEBHOOK_LAST_HEARTBEAT` (set before use, so an inherited value is overwritten), and `WEBHOOK_JSON_BODY`, `WEBHOOK_EVENT_LABEL` (exported to the webhook sender). The test suite also sets `FFMPEG_LOGLEVEL` and `FFMPEG_CAPTURE_PATH`; the daemon ignores the first, the second is read only by a test stub.

Fixed encoder settings (not configurable): 1280×720, 30 fps, `yuv420p`, libx264 at 3 Mbps with a 3 Mbps max rate, `zerolatency`, silent AAC 96 kb/s 44.1 kHz stereo. Preset `latency`: `ultrafast`, baseline 3.1, GOP 15, buffer 300k (live) or 1M (generated), no lookahead. Preset `quality`: `veryfast`, main 4.0, GOP 30 with minimum 15, buffer 450k or 1200k, no lookahead, no B-frames. Inputs use a 15 s read timeout on the slot side and low-delay, no-buffer flags on both stages.

### Dashboard environment

| Name | Default | Meaning |
|---|---|---|
| `STAT_URL` | `http://localhost:8080/stat` | Stat XML (flag `--stat-url` wins) |
| `RUNDIR` | `/run/canccustream` | Runtime directory (flag `--rundir` wins) |
| `MONITOR_INTERVAL` | 1 | Refresh seconds (flag `--interval` wins) |
| `MONITOR_EVENTS` | 8 | Log lines shown (flag `--events` wins) |
| `STATE_FILE`, `LOG`, `QUALITY_FILE` | under `RUNDIR` | Direct path overrides |
| `CANCCUSTREAM_MONITOR_QUALITY_KEYS` | off (`1`/`on`/`true`/`yes` enables; the restart helper defaults it to on) | Q key toggles the preset file |

### Scripts

| Name | Script | Default | Meaning |
|---|---|---|---|
| `CANCCUSTREAM_MONITOR_INTERVAL` | `bin/canccustream-up.sh` | 1 | Dashboard interval |
| `HOME` | `bin/canccustream-up.sh` | the caller's home | Computed but unused |
| `RTMP_HOST`, `RTMP_PORT`, `RTMP_APP`, `STREAM_PREFIX` | `bin/canccustream-publish-four-test-streams.sh` | `127.0.0.1`, 1935, `live`, `ffmpeg` | Test publisher target and names |

### systemd and nginx

- Manager unit: runs as one fixed personal account (see [Event-specific content](#event-specific-content)), `After`/`Requires` nginx, `Restart=always`, `RestartSec=3`, sets `API_ENABLED`, `API_BIND`, `API_PORT`, `DEFAULT_MODE`, `CYCLE_INTERVAL`; the integration variables are listed commented out. Drop-in `override.conf`: `RUNDIR`, `MODE_FILE`, `STATE_FILE`, `LOG`, `OFFLINE_GRACE_CYCLES`, `RuntimeDirectory`, mode 0755, `TimeoutStopSec=10s`, `KillMode=control-group`. Drop-in `50-execstart-from-repo.conf`: replaces `ExecStart` with the script under `%h`.
- Boot unit: oneshot, `RemainAfterExit`, runs the bring-up script.
- nginx: `worker_processes 1`, `worker_connections 4096`; RTMP `listen 1935`, `chunk_size 4096`, `buflen 50ms`; both applications `live on`, `record off`, `sync 10ms`, `wait_key off`, `wait_video off`; `live` adds `drop_idle_publisher 60`; HTTP `listen 8080`, `sendfile off`, `tcp_nodelay on`; the RTMP module is loaded from a path that varies by system.
- `requirements-dev.txt`: `pytest` only; `rich` is installed separately.

## External integrations

| Integration | Used for | Needs |
|---|---|---|
| nginx with the RTMP module | Ingest, internal slot streams, output, stat XML, proxy to the API | The module built for the installed nginx; ports 1935 and 8080 reachable from publishers and viewers |
| FFmpeg with libx264, AAC and `drawtext` | Five long-running encoders (four slots, one mixer), placeholders and the slate | A font for `drawtext`; CPU for five 720p30 encodes at once |
| GNU awk | Parsing the stat XML in the daemon | Must be `gawk` (three-argument `match`); undocumented |
| curl | Fetching the stat XML | |
| Python 3 | Control API and webhook sender (standard library only); dashboard with `rich` | `python3` on `PATH`; a venv for `rich` |
| systemd, journald, sudo | Units, restarts, runtime dir | Root or sudo for install and the scripts |
| tmux (optional), iproute2 | Dashboard session; default-route IPv4 detection | |
| OBS, FFmpeg or any RTMP encoder | Publishing | A unique stream name and the publish URL (from `/stream help` in the bot) |
| canccubot | Reads publish info, sets spotlight, receives `stream_active`/`stream_idle` | The control token and the webhook token on both sides, reachability of 8091 or 8080 |
| RTMP players and restreamers (VLC, ffplay, OBS media source, video platforms) | Watching or forwarding the composite | Reachability of 1935 |
| canccumanager (planned) | The docs expect restarts and health through a host control agent with an allow-list; no such agent is in this repo | |
| Files and media | None stored: no recordings (`record off`), no assets; only runtime text files | |

## Tests

46 test cases in 4 modules, all offline (a fake stat server on loopback, a fake `ffmpeg` on `PATH` that just sleeps, fake webhook receivers). There is no CI in the repo; the suite runs by hand with `pytest tests/ -v`.

| File | Covers |
|---|---|
| `tests/conftest.py` | Fixtures: loads the dashboard as a module without running it, a sample stat XML (one live stream, the composite with one viewer), an empty stat XML, a sample state file and log lines |
| `tests/test_canccustream_monitor_cli.py` | `test_default_interval_and_urls`: the dashboard's flag defaults equal its env-derived defaults |
| `tests/test_monitor_data_collectors.py` | Dashboard collectors and rendering (29 cases): `test_fetch_stat_xml_success`, `test_fetch_stat_xml_invalid_xml_returns_none`, `test_fetch_stat_xml_urlopen_exception_returns_none`, `test_read_state_file`, `test_read_state_file_missing`, `test_read_state_file_ignores_comments_invalid_lines`, `test_tail_log`, `test_tail_log_empty`, `test_tail_log_n_zero_returns_empty_list`, `test_check_services_mock`, `test_check_services_uses_stderr_when_stdout_empty`, `test_parse_live_streams_with_active_stream`, `test_parse_live_streams_empty`, `test_parse_live_streams_without_live_application_returns_empty`, `test_parse_live_streams_missing_video_metadata_uses_placeholders`, `test_parse_output_streams_composite_publishing`, `test_parse_output_streams_composite_infers_publishing_from_bitrate`, `test_parse_output_streams_composite_missing`, `test_parse_output_streams_client_list`, `test_parse_output_streams_when_clients_missing_returns_empty_list`, `test_parse_output_streams_when_output_application_missing_returns_none`, `test_format_bitrate`, `test_format_bitrate_negative_returns_dash`, `test_format_uptime`, `test_make_layout_handles_missing_stat_root`, `test_outbound_panel_renders_only_non_publishing_clients`, `test_run_dashboard_updates_once_and_uses_dependencies`, `test_header_panel_shows_quality_from_state`, `test_toggle_quality_preset_file` |
| `tests/test_manager_modes.py` | The real daemon against a stat sequence (4 cases): `test_manager_auto_mode_switches_targets_by_stream_count` (s1 → layout2 → layout3 → layout4 in order), `test_manager_cycle_mode_switches_between_slots` (s1 then s2), `test_manager_auto_mode_keeps_compositor_continuous_when_first_stream_appears` (no instability fallback, at most two mixer deaths), `test_manager_outbound_ffmpeg_commands_include_silent_aac` (captured FFmpeg arguments: placeholder text, live and slot and output URLs, silent AAC, never `-an`) |
| `tests/test_control_api.py` | The real daemon with its API and webhooks (12 cases): `test_control_api_spotlight_and_names_restart_compositor` (plain-text spotlight on and off, names off and on, as seen in the log), `test_control_api_publish_info_bearer_and_missing_url` (401 without token; 200 with URL and notes), `test_control_api_publish_info_503_when_url_unset_even_with_auth`, `test_control_api_refuses_non_loopback_bind_without_token` (exit 1, log line), `test_control_api_spotlight_json_slot_with_bearer` (wrong token 401, right token switches), `test_control_api_spotlight_invalid_slot_returns_400`, `test_control_api_quality_get_post_and_restart_log` (default, JSON and plain set, restart logged, 400 on junk), `test_webhook_stream_active_then_idle`, `test_webhook_retries_on_500_then_succeeds_with_bounded_attempts`, `test_webhook_does_not_retry_on_400_or_401` (two cases), `test_webhook_retry_exhaustion_respects_attempt_limit` |

Run once for this inventory (exported copy, Python 3 with `pytest` and `rich`, a host whose default `awk` is not GNU awk): 35 passed, 11 failed. The failures are every daemon test that needs stream discovery (`test_manager_modes.py` 4/4, `test_control_api.py` 7/12); the five API tests that do not need a live stream pass. With GNU awk they are expected to pass; that was not run here.

Gaps that matter for the port:

- Not tested: `GET /health`, `GET /mode`, `POST /mode`, the `X-Api-Token` header, JSON and form bodies of `/names`, the nginx proxy routes, the CLI subcommands, offline grace with the default 8 cycles, slot reuse after a stream leaves, the fifth-stream case, mixer death and the fallback to the slate (the stub never dies), the stat-failure path, spotlight in cycle mode, and the webhook `spotlight` field.
- Not tested at all: every helper script, both units, the nginx config, real FFmpeg (filters, latency, the drawtext escaping) and real nginx.
- The suite silently depends on GNU awk, `curl` and `bash`, and uses fixed sleeps and log-text matching; several tests take tens of seconds, one waits up to 95 s.
- Test fixtures use state keys and values the daemon never writes (`MODE=live`, `TARGET=YouTube`, `SLOT_N`); one helper in `tests/test_manager_modes.py` is never called.
- None of this ports as code. For the Cast track the reusable lesson is the test shape: a fake upstream server plus a fake media binary on `PATH`, driving the real process; plus a measured end-to-end latency test, which this repo never had.

## Known problems

From the files, the commit history and the one test run.

1. **Undocumented GNU awk dependency.** Stream discovery uses the three-argument `match`, a gawk extension. On a host whose `awk` is another implementation (the Debian default, for one), every poll fails and the log says "stat fetch failed", which points at nginx instead of awk. Confirmed by the test run (11 failures).
2. **The fail-closed API can be bypassed through nginx.** The API may run without a token on loopback, but nginx on port 8080 (all interfaces) proxies `/spotlight` and `/publish-info` to it (`341dc24`). With the default loopback bind and no token, anyone who reaches port 8080 can change the spotlight. The startup check (`c0394b6`) does not see the proxy.
3. **RTMP has no auth, and discovery does not check the application.** Anyone who reaches port 1935 can publish to `live` and take a slot, publish to the internal `output` names while a worker restarts, or watch every stream; the stat XML on 8080 also lists viewers' addresses. Discovery takes publishing streams from every application, so any other name published to `output` is also taken as a camera and holds a slot with a worker that cannot start: the worker plays `live/<name>`, which does not exist, dies, and is restarted on every poll for as long as the publisher stays. Security rested on the LAN being trusted. For the Cast contract: check both the application and the publisher.
4. **Untrusted stream names reach the FFmpeg filter graph.** Names are typed by publishers; the overlay only strips quotes and doubles backslashes, so other `drawtext` syntax (for example `%{…}` expansion) is still read. A crafted name can break the mixer; after two deaths it falls back to the slate, so one publisher can blank the output.
5. **The bring-up script overwrites the secrets drop-in.** `bin/canccustream-up.sh` copies `config/override.conf` over the installed one on every run, and with the boot unit on every boot, although both docs warn never to do that because real tokens live there.
6. **The from-repo drop-in points at the wrong home.** `50-execstart-from-repo.conf` uses `%h`, which in a system unit is the service manager's home (root's), not the `User=` account's, so the manager fails to start unless the clone is there too.
7. **Webhook sends block the daemon.** Sends run inline in the poll loop; with the defaults a failing receiver holds the loop for up to six tries with up to 5 s each plus backoff (about a minute), during which no slot is reconciled and no state is written. A layout change that waits for slots does the same for up to 10 s, and when the wait fails the layout is not recorded, so it is tried again on every poll.
8. **No `stream_idle` on shutdown** or crash; the bot needed its own heartbeat timeout.
9. **Double encoding.** Every camera is encoded twice (slot worker, then mixer), even when shown alone, which adds delay and CPU; the casting plan's "forward one stream without re-encoding" is the answer to this.
10. **Unbounded logs on tmpfs.** `manager.log` and the FFmpeg logs grow without limit in `/run` (memory), and the dashboard reads the whole log on every refresh.
11. **Unvalidated input in a root script.** `bin/canccustream-set-publish-ip.sh` puts its argument unchecked into a `sed` replacement and a unit file as root.
12. **Plain token compare** (not constant time); no request size limit on the API.
13. **Committed virtualenv stubs.** `.venv-run/` and `.venv-run2/` are tracked (symlinks and a config holding a personal home path); `.gitignore` covers only `.venv/`.
14. **Hard-coded personal account** in the manager unit; the unit is not reusable as is.
15. **Dead code and settings:** `PUBLISH_MISS_GRACE` and the per-slot and composite publish-miss counters are never used; `HOME` in the bring-up script is computed and unused; the tests set `FFMPEG_LOGLEVEL`, which nothing reads.
16. **Documentation drift:** `DOCUMENTATION.md` capitalizes paths and script names that are lower-case in code, still shows a clock on the slate (removed in `9400af3`), says white overlay text (code: green), says `sync 100ms` (config: 10 ms), an `fps` filter and a larger input queue than the code uses, and gives a webhook-style example for `event_publish_url`, which is really the RTMP publish URL. Both docs refer to a manager-side control agent that does not exist here.
17. **Cycle-mode corner:** the mosaic is shown first only when coming from the slate; going from one stream to two while cycling skips it.
18. **Non-atomic file writes** between API, daemon and dashboard; harmless in practice.
19. **No CI**, no lint, no shellcheck.
20. **Stale slate text:** the slate tells viewers to use `/stream`, which is now a stub.
21. **Never finished:** the planned path from this host to the big screen (a stream directive to the signage server) exists only in plans in other repos.
22. **No TODO or FIXME markers** in the repo.

## Port recommendation

Targets use the roadmap's steps. "Drop" follows [0010](../decisions/0010-scope.md) where it already covers the item, and the legacy decision to replace this repo with the cast relay otherwise. A dropped feature comes back only through a new issue (0010, Consequences).

| Feature | Verdict | Reason | Target module | Roadmap step |
|---|---|---|---|---|
| U1 RTMP ingest | drop | Cast takes one cast at a time over WebRTC/WHIP through MediaMTX; RTMP ingest is not in its scope | cast | Cast track (#67) |
| U2 automatic multi-view layout, U4 placeholders | drop | No multi-view in Cast; four live encodes would also not fit the uplink to a remote VM ([0011](../decisions/0011-hosting-on-remote-vm.md)) | — | — |
| U3 waiting slate | drop | Screen shows its normal content when nothing is cast | screen | 3 |
| U5 name overlay | drop (idea kept) | The cast takeover can name who casts, from sign-in, not from a typed stream name (see problem 4) | cast, moments | Cast track |
| U6 spotlight, U7 cycle mode, O6 modes | drop | One cast at a time leaves nothing to choose between; the takeover ranking is Moments' job | moments | 4 |
| U8 silent AAC, O5 encode presets | drop (findings kept) | Cast forwards without re-encoding; keep the findings (player buffering on video-only streams, no lookahead, short GOP, `zerolatency`) as input to the uplink measurement the roadmap asks for | cast | Cast track |
| U9 watching the composite | drop | The projector shows `/screen`; restreaming is not in scope | — | — |
| O1 discovery, O2 offline grace | drop (rule kept) | Keep the rule "wait a grace period before reacting to a lost stream" as part of Cast's stall guard spec | cast | Cast track |
| O3 self-healing workers, O4 mixer guard | drop | Containers restart on failure; no multi-process pipeline | deploy | 1 |
| O7, O11 status and state files | drop | State lives in Postgres and Valkey ([0007](../decisions/0007-stateless-containers.md)); health comes from the kit | kit | 1 |
| O8 control API | rewrite | Cast gets its own contract with kit auth and per-tenant rights; no unauthenticated loopback mode | cast | Cast track |
| O9 publish info | rewrite | Becomes the cast page: "how to cast" for the tenant, reached from the bot | cast, bot | Cast track, 6 |
| O10 webhooks `stream_active`/`stream_idle` | rewrite | Becomes cast events on the bus (started, heartbeat or stalled, ended), defined in the Cast contract and consumed by Moments and Screen; no direct bot webhook | cast | Cast track |
| O12 dashboard | drop | The admin health view covers it | admin | 1 (done), 8 |
| O13–O15 bring-up, restart and publish-IP scripts, O17 units | drop | Windows/WSL scripts and systemd units of the old hosts are dropped (0010); the VM is set up by `setup/` and Compose | setup, deploy | 1 |
| O16 test publishers | drop (idea kept) | A synthetic publisher is useful for Cast's demo-stack test, as a WHIP sender | cast, ci | Cast track |
| O18 nginx tuning | drop | Caddy is the edge; MediaMTX has its own settings | — | — |
| O19 docs | drop | Legacy docs are not imported ([0002](../decisions/0002-no-legacy-history-or-docs.md)) | — | — |
| Tests | drop (shape kept) | See [Tests](#tests): fake upstream plus fake media binary, plus a real latency measurement | cast | Cast track |
| Bot `/stream` consumer (in canccubot) | rewrite there | Replaced by cast commands in the bot port (#69 decides) | bot | 6, Cast track |
| Manager subsystem `canccustream` (in canccumanager) | drop | The module list replaces the subsystem list; the new module is `cast` | admin | 8 |

The porting plan in the roadmap has no row for this repo; the summary (#76) should add one: everything dropped, ideas to the Cast track.

## Tenancy questions

What this repo implies for the tenancy design (#48). Each is a question for the tenants contract or the Cast contract; none is decided here.

**Global (platform, superadmin)**

1. Is the cast relay one shared service on the stack for all tenants (sessions tagged by tenant), or one per tenant? Encoder and relay settings (the legacy preset) look global; confirm no tenant can change them.
2. Relay health and restarts (the legacy manager's guarded subsystem) are about the shared stack: superadmin only, or also visible to the admins of live tenants?

**Per tenant (event)**

3. Who may cast, and who may end or take over a cast: any signed-in attendee of the tenant, or only holders of a tenant right? Legacy allowed anyone who could reach the port.
4. The cast instructions (legacy publish URL and notes) become tenant content: a tenant setting, or part of the event profile?
5. The name shown with a cast comes from the user's global identity; does a tenant need moderation or a display-name override?
6. Cast events on the bus carry the tenant; which of the tenant's screens does a cast go to when a tenant has several?

**Per venue**

7. Legacy ran the relay on a venue device and relied on the venue LAN as its only protection. With a remote VM the stream crosses the uplink twice (roadmap open question): is a per-venue relay device needed, and would it be a global, venue-scoped row like Screen's devices ([0013](../decisions/0013-multi-tenant-core.md) item 34)?
8. Two simultaneous events at one venue share the venue's public address (item 33). If casting is limited to "people at the venue", is that check per venue, and how are casts kept apart between those two tenants?
9. The publish URL was built from the host's LAN address. Does any per-venue network setting survive (an address, a port opening on the venue router), and who owns it?

## Event-specific content

Named by kind and counted only; no value appears in this file. The location of each value is listed in the PR, for a follow-up issue in the event repo.

| Kind | Distinct values | Lines | Files |
|---|---|---|---|
| Personal account name (the unit's user and group, the home path in the virtualenv stubs) | 1 | 4 | 3 |
| Private LAN address of a host, in publishing examples | 1 | 4 | 1 |
| Event names, venue names, public hostnames, tailnet names, Discord ids, channel or role names, dates of events | 0 | — | — |
| Placeholder addresses (documentation-style private examples in usage text, loopback, test fixtures) | not counted | — | — |

Menus, photos, recordings and other media: none in this repo.
