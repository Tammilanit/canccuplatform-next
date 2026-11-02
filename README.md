# CanccuPlatform

A general platform for running LAN events, big or small: the screen view, tournament, games, pizza orders, a Discord bot and one admin, all on one host with Docker Compose.

`canccuplatform-next` is a working name; the repo is renamed `canccuplatform` at the switch.

Status: skeleton. Nothing runs yet.

## Layout

| Folder | Holds |
| --- | --- |
| modules/screen | CanccuScreen: the info view for the big screen and anyone's PC |
| modules/tournament | CanccuTournament: events, registration, scores, leaderboard |
| modules/pizza | CanccuPizza: pizzerias, menus, orders, bills |
| modules/bot | CanccuBot: the Discord bot (Python) |
| modules/admin | CanccuAdmin: sign-in, rights, settings, health, alerts, updates |
| modules/games | CanccuGames: rosters and organizing players into games |
| modules/moments | CanccuMoments: what the screens show and play, and when |
| modules/voices | CanccuVoices: text to speech, cached |
| modules/cast | CanccuCast: cast your screen to the big screen |
| packages/kit-ts, packages/kit-py | Shared plumbing: bus, health, settings, sign-in checks, logging |
| packages/ui | Shared look: theme tokens and components |
| deploy/ | Compose files: modules plus Postgres, Valkey and Caddy |
| setup/ | Install, first-run wizard, backup, restore, new-event |
| contracts/ | One file per module: its API and events |
| docs/ | General docs and design rules; no event-specific content |
| events/demo/ | The demo event profile for tests, screenshots and new organizers |

An event lives in its own repo next to this one (profile, `platform.version`, Compose override, venue docs). `setup/new-event` will create one from a template.

## Rules

- Nothing event-specific in this repo; a CI check will fail PRs that name a real event, venue, IPs or Discord ids.
- One version for the whole platform: a release is a git tag, CI builds one image per module.
- Contracts live next to code; a contract change and its consumers land in one PR.
- English throughout; other languages arrive as language packs.
- Linux only (WSL2 with mirrored networking: at your own risk).

## License

AGPL-3.0. See [LICENSE](LICENSE).
