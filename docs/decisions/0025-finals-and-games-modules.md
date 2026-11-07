# 0025. Finals and games are separate modules, on a shared tourney core

- **Status:** Accepted
- **Date:** 2026-11-07

## Context
The roadmap's Games track bundled two different things: the games people play at an event (the catalogue, activity matching, surges, [games.md](../../contracts/games.md)) and the mini tourney, a small standalone app for one game's 3-player team ladder (seasons, sign-up, brackets, rankings, champions, a team builder), ISC-licensed by another author. Its use waited for that author's OK ([0020](0020-best-of-old-freely-new.md)). The mini tourney also runs off-LAN on its own, between events, and the bot's `/finals` commands talk to it there. On 2026-11-07 the product owner and the mini tourney's author agreed the split below (#148), and the author gave the OK to reuse the ISC code in the platform: in the `finals` module and in the shared core.

## Decision
- **Two modules, two tracks.**
  - **`finals`:** the mini tourney on the platform: seasons, registration of teams and individuals, brackets, rankings, champions and the team builder. Paths `/api/finals/…` and `/finals/…`, events `finals.<noun>.<past-tense verb>`, rights `finals.<right>` ([contracts/README.md](../../contracts/README.md#conventions)).
  - **`games`:** the generic games module: the catalogue, activity matching and surges ([games.md](../../contracts/games.md)), later LFG and casual sessions.
  - The roadmap's Games track splits into a **Finals track** and a **Games track** ([roadmap](../roadmap.md#parallel-tracks)).
- **A shared tourney core.** The pure parts of the mini tourney (the bracket engine, rankings and the team builder) come from one small public library that both the standalone off-LAN app and the `finals` module use. It keeps its licence (ISC) and its author's attribution.
  - **How `finals` takes it:** as a normal dependency pinned to a release: from the npm registry once it is published there (preferred), otherwise a git dependency pinned to a release tag. No vendored copy, and nothing fetched from a branch at build or deploy time.
  - **Upgrades are deliberate:** a PR that bumps the pinned version, reviewed like any change; the dependency auditing of step 10 covers it like any other dependency ([0015](0015-dependency-auditing.md)).
  - **The licence notice** comes with the package as usual (its `LICENSE` in the installed package and the lockfile entry); the module's README names the library, its author's project and the licence.
  - Storage (Postgres, per tenant), the API, sign-in and rights, and the frontend are built new on the kit; only the pure core is shared.
- **The standalone off-LAN app stays independent.** It keeps its own data and runs without the platform. There is **no data sync** between it and the platform in either direction: a season lives in one of them.
- **The provider contract is the shared interface for `/finals`.** The bot's `/finals` commands talk to a finals provider through one contract, against a base URL: the off-LAN app or the platform's `finals` module ([contracts/finals.md](../../contracts/finals.md)). The platform's copy is provisional until the Finals track writes the full `finals` contract; a change on either side is passed to the other before it ships.

## Consequences
- `docs/roadmap.md`: the Finals track and the Games track replace the Games track; the "waiting for the author's OK" notes are removed, and the licence and attribution rule stays.
- `contracts/README.md` lists `finals`; `contracts/finals.md` holds the provider stub. The Finals track writes the full contract (its own API, events, rights and the screen's finals cards) when it starts.
- The tournament module (step 7) is a separate module; it builds on the signup site's code, not on this core.
- The `finals` module is a Node module in TypeScript on kit-ts, the stack's default ([0006](0006-stack.md)), which also takes the core, a JavaScript library, directly.

## Known limits
- **The core is not published yet.** Until it is on the npm registry the module pins a git tag, which the lockfile records but npm's auditing covers less well. Moving to the registry is one version-bump PR.
- **Two providers, one contract.** The off-LAN app and the platform can drift apart. The stub copies the off-LAN app's shapes exactly, and a change on either side goes to the other before it ships, and the Finals track tests the bot's `/finals` against both providers.
