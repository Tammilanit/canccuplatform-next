# 0010. Scope: what is dropped, Moments, PPTX

- **Status:** Accepted; ticker line superseded by [0018](0018-ticker-manual.md)
- **Date:** 2026-11-03

## Context
Porting everything would carry over dead parts and features nobody used.

## Decision
- **Dropped** (they stay in the old repos):
  - Windows and WSL scripts, ssh actions and systemd units of the old hosts;
  - SQLite, the hosted serverless database and its worker;
  - polls;
  - the RSS ticker and automatic ticker posts (the ticker stays, manual only);
  - per-sender tokens, the shared admin password, registration tokens and the old login-link format;
  - the bot's own heartbeat watcher, and the manager's dead-man's switch (the hardening watchdog covers both);
  - the old in-memory storage layer and the debug UI;
  - the near-duplicate HTML page per format;
  - the screen-embed message protocol;
  - old doc sprawl.
- **Moments is its own module:** ranked screen overrides (takeovers, blocks, overlays) plus the sound engine and its budget.
- **PPTX rendering is in scope,** as part of Screen core, in a separate render-job container.

## Consequences
- Screen core ([roadmap step 3](../roadmap.md#3-screen-core-incl-pptx)) includes the render job; Moments is step 4.
- A dropped feature comes back only through a new issue.
