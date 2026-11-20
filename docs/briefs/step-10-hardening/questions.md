# Step 10 question bank

Every open question the research for [the step 10 brief](../step-10-hardening.md) found, grouped by theme, each with its options and a recommendation, for the product owner's brainstorming session (#169). IDs are stable, so the session can answer "D4: A" and the mockups can point here.

The themes: **U** who uses it and how · **L** look and feel · **D** data and integrations · **E** edge cases and failure · **O** operations and scale · **P** plan and scope.

**Decide first** (they change the most): P1 (the direction), D1 (how fresh the fallback laptop's copy is), U6 (who switches to the fallback laptop, and how), E1 (two primaries after a switch), D7 (where the watchdog lives), D10 (what a release channel pins on a shared stack), U4 (does a red readiness check block going live), P2 (the issue set), P3 (the exit criteria).

**Already decided, so not asked again:**
- Backups off the VM: WAL archiving for point-in-time recovery, a nightly base backup and nightly files to another host; the secrets key and `deploy/.env` kept apart from the dump and with the fallback laptop; a restore tested monthly; per-tenant export and import ([0013](../../decisions/0013-multi-tenant-core.md) item 26, [0007](../../decisions/0007-stateless-containers.md)). The backup job itself is #55 in the Go-public track, not this step.
- The fallback laptop is the only on-site copy, started with one command ([0011](../../decisions/0011-hosting-on-remote-vm.md)); no hot standby and no venue edge box ([0022](../../decisions/0022-product-vision.md), [roadmap](../../roadmap.md#goals-and-non-goals)).
- Screens cache their last state and keep showing it when the uplink drops; Studio says "the venue uplink may be down" (step 3, built).
- `npm audit` and `pip-audit` in CI and Renovate or Dependabot for images and dependencies ([0015](../../decisions/0015-dependency-auditing.md)); the weekly run already audits (`weekly.yml`, `audit`).
- The event's `language` setting (`en` or `fi`) exists in admin's settings; Finnish arrives in this step ([contracts/admin.md](../../../contracts/admin.md#settings)).
- Platform alerts go only to a platform channel, never to a tenant's; the watchdog belongs to the superadmin and organisers see only a coarse status line ([TE5, TI6](../../legacy-inventory/README.md)).

A question marked **contract** needs a contract change if the recommendation is taken. Every such change here is additive, so it ships in the package whose code uses it ([0029](../../decisions/0029-additive-contracts-ship-with-consumers.md)). A question marked **high** puts its package in the high risk class (`setup/`, `.github/`, agent config, secrets, sign-in).

## U · Who uses it and how

### U1. Who may restore?
- **A.** The superadmin, and any maintainer who holds the emergency kit (the secrets key and `deploy/.env`), from a terminal.
- **B.** A restore button in the superadmin's web page.
- **C.** Event admins may restore their own event from a per-event export.
- **Recommendation: A** for the whole platform, and C only as "import a per-event export into a new event" through the superadmin (#55's per-tenant import). A restore runs when the platform is broken, so it cannot depend on the platform's own pages ([mockup 06](06-restore-from-cold.svg)).

### U2. Whose is the fallback laptop?
- **A.** One per platform, kept and carried by the superadmin (or the on-call person) to every live event.
- **B.** One per venue, kept at the venue.
- **C.** Each organiser brings their own and installs the kit.
- **Recommendation: A.** One machine to keep current and to check; the venue is the same for most events (0022), so in practice it is also B. The laptop "checks in" ([U10](#u10-how-does-the-fallback-laptop-show-that-it-is-ready)).

### U3. Who sees the readiness page?
- **A.** Event admins and the crew with `admin.settings.read` see their event's checks; the superadmin also sees the platform part (backups, watchdog, release, fallback laptop).
- **B.** Superadmin only.
- **C.** Everyone signed in to the event.
- **Recommendation: A** ([mockup 02](02-readiness.svg)). Organisers fix most red checks themselves (a screen not paired, a theme not published); the platform rows tell them who to ask.

### U4. Does a red readiness check block going live?
- **A.** Advisory only: the page shows it, nothing blocks.
- **B.** A check marked **blocker** stops `draft → live` until it is fixed or overridden with a reason (audited); warnings never block.
- **C.** Every red check blocks.
- **Recommendation: B.** Few blockers (no screen paired, no backup in 24 h, the stack not on the event's release); the override keeps a small event from being stuck. **Contract:** a `readiness` summary on the status change's refusal (additive problem code `readiness_blocked`).

### U5. When is readiness checked?
- **A.** Live, whenever the page is open (checks every 30 s, as the health note does).
- **B.** A, plus digests to the organiser at fixed points: 7 days before, the day before, and 2 hours before doors.
- **C.** Only by hand.
- **Recommendation: B** ([mockup 03](03-event-timeline.svg)). The digest goes the way step 8 sends alerts (Discord first); the page is the truth.

### U6. Who switches the event to the fallback laptop, and how?
- **A.** The superadmin runs one command on the laptop (`setup/fallback promote`); screens that cannot reach the VM for 2 minutes try the event's fallback address and follow the laptop once it says it is the primary.
- **B.** As A, but venue staff move each screen by hand (a second shortcut on each screen PC).
- **C.** Fully automatic: the laptop promotes itself when the watchdog says the VM is down.
- **Recommendation: A**, with B as the documented manual fallback. A person decides (the hoster may answer in 5 minutes); the screens follow without anyone walking to each PC ([mockup 07](07-fallback-at-the-venue.svg)). C risks two primaries on a flapping link (E1). **Contract:** the player's fallback address and the `primary` flag (screen contract, additive).

### U7. What do phones get while the laptop is the primary?
- **A.** Nothing new: the hub stays on the VM's address and shows "the platform is down, the screens still run"; attendees follow the screens.
- **B.** The venue's Wi-Fi hands out the laptop's address for the platform's hostname (the venue router's DNS), so phones on Wi-Fi reach the hub without HTTPS features (no push).
- **C.** A QR on the screens to the laptop's plain address.
- **Recommendation: A.** The fallback keeps the hall running (screens, Studio, announcements on screen); phones are the attendees' own and work on mobile data once the VM is back. B is a venue-network change the crew cannot test in advance.

### U8. What do venue staff see and do during a switch?
- **A.** A one-page card printed with the event pack: "if every screen shows 'Offline since', call the on-call number"; nothing else to do unless asked to move a screen by hand (U6 B).
- **B.** A crew page on the laptop to watch the switch.
- **Recommendation: A**, plus B for the crew who already use Studio (it is the same Studio, on the laptop's address).

### U9. Who gets the watchdog's alerts?
- **A.** The superadmin and the on-call person, in the platform's Discord channel (a webhook the watchdog holds, not the bot) and by e-mail.
- **B.** A, plus the live event's admins get a plain "the platform is down, we are on it" in their own channel.
- **C.** Everyone with admin rights in any event.
- **Recommendation: B.** TE5 keeps platform alerts out of tenant channels; B sends organisers only the coarse line (TI6) and only while their event is live.

### U10. How does the fallback laptop show that it is ready?
- **A.** `setup/fallback check` on the laptop: the images of the release the stack runs are present, the latest backup restores into a scratch database, a sealed test value opens with the key; it reports the result to the platform ("checked in 2 days ago") and the readiness page shows it.
- **B.** A written checklist the superadmin ticks.
- **Recommendation: A** ([mockup 05](05-backups-and-drills.svg)). It is the monthly drill (0013 item 26) made small enough to run the week before every event.

### U11. Who reads the dependency updates?
- **A.** The independent reviewer, like any PR; one grouped PR a week; security fixes at once.
- **B.** A maintainer only.
- **Recommendation: A** ([0015](../../decisions/0015-dependency-auditing.md)). Updates of `.github/` actions are high risk and wait for a maintainer's accept; the rest merge on `pass` ([D17](#d17-how-are-update-prs-grouped)).

### U12. Which pages does the admin simplification pass cover?
- **A.** Every organiser page in the shell (admin's own and every module's), measured against one checklist (N1: no browser dialogs, works on a phone, plain words, undo where a change is easy to regret, search).
- **B.** Admin's own pages only (settings, health, profile, people).
- **C.** A full redesign of the organiser menu.
- **Recommendation: A** with a bounded fix list: the pass starts with a short audit like #377 (every page, a screenshot, a finding), and the lead picks the fixes in the session ([mockup 12](12-admin-simpler.svg)).

### U13. Who installs the platform with the install kit?
- **A.** The superadmin on a fresh Debian VM, and the same kit on the fallback laptop; the kit asks for the values (domain, Discord app, backup target, watchdog) and writes `deploy/.env`.
- **B.** Organisers who want their own copy of the platform.
- **Recommendation: A** ([mockup 10](10-install-kit.svg)); B works too, since the kit is the same, but nothing in this step is written for them (no hosting guide, no support).

## L · Look and feel

### L1. The readiness page's form?
- **A.** A summary line, then one auto-fill grid of check cards grouped by area (screens, content, people, platform), each with its state, one sentence and its fix (design amendment 3).
- **B.** A plain checklist in one column.
- **Recommendation: A** ([mockup 02](02-readiness.svg)). Cards scale from a phone to 1920 px; order is stable (blockers first within a group, never moved by a state change).

### L2. Where does readiness live in the menu?
- **A.** Under Admin as "Readiness", beside Health; the Health item's note links to it before an event.
- **B.** A banner on every organiser page until the event is live.
- **C.** Inside Health.
- **Recommendation: A**, plus a quiet one-line banner in the shell only in the last 24 hours before doors when a blocker is open.

### L3. The platform part of Health?
- **A.** Health gets a Platform tab for the superadmin: backups, drills, watchdog, release, disk, certificates, the fallback laptop ([mockup 04](04-platform-health.svg)).
- **B.** A separate superadmin console.
- **Recommendation: A.** One place to look; the superadmin's session already sees platform rows.

### L4. What does a screen show while on the fallback laptop?
- **A.** Nothing different: attendees should not notice.
- **B.** A small corner mark only crew can read ("F").
- **Recommendation: A** on the screen; Studio on the laptop has a red band "Fallback: this laptop is the primary since 21:14" ([mockup 07](07-fallback-at-the-venue.svg)).

### L5. The outside status page?
- **A.** The watchdog serves one static page ("All good" / "The platform is down since 21:12; we are on it"), no event names.
- **B.** No status page; Discord only.
- **Recommendation: A** ([mockup 08](08-watchdog.svg)). It is the one page that works when the VM does not; the hub's offline state can link to it.

### L6. Which shell themes?
- **A.** Dark (today), Light, and "follow the system", chosen per person; high contrast as a Light variant.
- **B.** Dark and Light, chosen per event.
- **C.** Dark only; "theme" means polishing the platform's default screen theme.
- **Recommendation: A** ([mockup 13](13-shell-themes.svg)). Organisers work in daylight offices and dark halls; a per-person choice follows the person, not the event. The event's admin tokens (theming) still apply on top, with the contrast fallback.

### L7. What does "theme" in the roadmap's step 10 mean?
The roadmap lists "the admin simplification pass, theme, and Finnish". Step 3 built per-event themes and the brand kit.
- **A.** The organiser shell's own themes (L6).
- **B.** A third built-in screen theme for events with no brand.
- **C.** Both.
- **Recommendation: A.** The screen already has the Default theme and the demo themes; the shell is the one surface without a choice.

### L8. Finnish copy style?
- **A.** Plain spoken Finnish, "sinä" form, short verbs on buttons ("Tallenna", "Kumoa"), the same terms everywhere through a glossary.
- **B.** Formal ("te") form.
- **Recommendation: A**, with a glossary in the repo (`docs/i18n/glossary.md`) that fixes the words for zone, screen, run of show, moment and crew.

### L9. Undo or confirm?
- **A.** Undo for anything easy to reverse (a toast with Undo for 10 s); an in-page confirm (no browser dialog) for what cannot be undone, saying what will be lost.
- **B.** Confirm everything.
- **Recommendation: A** ([mockup 12](12-admin-simpler.svg)), N1 and N6 of the inventory summary.

### L10. Search in the organiser shell?
- **A.** One search field (and `/` to focus) that finds pages, settings, screens, zones, people and run-of-show items by name.
- **B.** Pages only.
- **C.** None this step.
- **Recommendation: B** in this step: it costs little (the menu and settings are declared), and A needs every module to expose a search read. **Contract** if A (additive reads).

## D · Data and integrations

### D1. How fresh is the fallback laptop's copy?
0022 rules out a hot standby. A cold laptop restores from the backup target, which needs the uplink; when the uplink is down the laptop has only what it already holds.
- **A.** Cold: the laptop pulls the latest base backup and WAL when the switch starts (needs the uplink; a VM failure with a working uplink).
- **B.** Warm copy: during a live event the laptop pulls the WAL archive from the backup target every 5 minutes into a local folder (no database running), so a restore loses at most about 5 minutes even with the uplink down.
- **C.** A hot standby (streaming replica on the laptop).
- **Recommendation: B.** It is still not a standby (nothing runs until promoted), and it covers both failures the venue meets: the VM lost and the uplink lost ([mockup 06](06-restore-from-cold.svg)). C is a non-goal.

### D2. Restore targets?
- **A.** Recovery time 30 minutes from the decision to screens back (the legacy's target); data loss at most 5 minutes (WAL, D1 B).
- **B.** 60 minutes and 24 hours (the nightly backup only).
- **Recommendation: A**, measured in every drill and shown in Health ([mockup 05](05-backups-and-drills.svg)).

### D3. The emergency kit?
- **A.** One encrypted file (`canccu-emergency-kit.age`: the secrets key, retired keys, `deploy/.env`, the backup target's read key, the watchdog's webhook) with a passphrase kept by two people; printed recovery sheet with the passphrase's hint and the steps.
- **B.** The files as they are on a USB stick with the laptop.
- **C.** In a password manager.
- **Recommendation: A.** 0013 item 26 says apart from the dump and with the fallback laptop; encryption makes a lost stick harmless; `age` is one static binary (D4). **high** (secrets).

### D4. Which encryption for backups and the kit?
- **A.** `age` (one key pair; the VM holds only the public key, so a stolen VM cannot read old backups).
- **B.** GPG.
- **C.** The backup tool's own (for example pgBackRest's or restic's repository passphrase).
- **Recommendation: C for the backups** (it is #55's choice; this step only restores them) **and A for the kit.** If #55 takes `age` for backups too, one tool fewer.

### D5. What does a restore check before it says "done"?
- **A.** The database restores to the chosen time; migrations are at the release's version; a sealed test value opens with the key; every module's `/health` is `ok`; one screen of the demo tenant renders; counts per tenant (events, devices, members) match the backup's manifest.
- **B.** Health only.
- **Recommendation: A**, as `setup/restore --verify` and in the weekly CI drill (O4). **Contract:** a backup manifest (counts per tenant) written by #55's job (an additive file format, `docs/` not `contracts/`).

### D6. Per-event restore?
- **A.** Only through #55's per-tenant export and import, into a new event (an archived event never comes back, tenants.md).
- **B.** Point-in-time restore of one event inside the shared database.
- **Recommendation: A.** B would need per-tenant PITR, which Postgres does not do; the import gives "the event as it was at 03:00".

### D7. Where does the watchdog live?
- **A.** On the backup target host (#45): a small container or systemd timer that polls the platform and receives its heartbeat.
- **B.** A hosted dead-man's-switch service (free tier).
- **C.** On the fallback laptop, only during events.
- **D.** A + B: the host does the work, the hosted service watches the watchdog.
- **Recommendation: A**, with B's idea as an option later. It is a host the platform already depends on, it is outside the VM, and it sends nothing to third parties ([mockup 08](08-watchdog.svg)). **high** (`setup/`).

### D8. What does the watchdog watch?
- **A.** Two signals: it polls `https://<platform>/api/hello/health` every minute from outside (DNS, certificate, Caddy, the stack), and the VM pushes a heartbeat every minute with its health summary, the age of the last good backup and the last WAL push.
- **B.** Polling only.
- **C.** Heartbeat only.
- **Recommendation: A.** Polling catches "up but unreachable" (DNS, certificate, firewall); the heartbeat catches "reachable but backups stopped". Alert on silence or on a down poll, never on a reported `degraded` alone (the legacy rule).

### D9. Alert rules?
- **A.** The legacy rules: alert once when a signal is bad for 3 minutes, once on recovery, a reminder every 30 minutes while it stays bad; count from the first heartbeat, not from start-up; certificate under 14 days, backup older than 26 hours, WAL older than 15 minutes, disk over 85 %.
- **Recommendation: A** (the manager's debounce, problems P5, P10 and the bot's problem 9 fixed).

### D10. What does a release channel pin on a shared stack?
One stack serves every event, so one backend version runs for all ([0013](../../decisions/0013-multi-tenant-core.md) items 22–23). Tags `v0.<step>.<n>` already mark every green main.
- **A.** Channels belong to the stack: `dev` follows main (the test VM), `stable` moves only when a maintainer promotes a tested tag. An event records the release it tested in its repo; readiness checks that the stack runs it, and deploys are held while any event is live (hotfixes excepted). Per-event pinned screen bundles stay as item 23 says.
- **B.** Per-event backends (several stacks).
- **C.** No channels: the stack follows main always.
- **Recommendation: A** ([mockup 09](09-releases.svg)). B breaks the one shared stack; C cannot promise an organiser what they tested. **high** (`setup/deploy`, `.github/`).

### D11. Version numbers after the switch?
- **A.** Keep `v0.<step>.<n>` until step 11's switch, then `v1.0.0` and semantic versions; a `stable` tag is any `v1.x.y` a maintainer promotes.
- **B.** Calendar versions (`2027.03.1`).
- **Recommendation: A.** Settled now so the event repo's pin has a form; the switch itself is step 11.

### D12. The deploy window?
The roadmap's open question: "no deploys while any tenant is live" can block every deploy once events overlap.
- **A.** Deploys wait while any event is live, except hotfixes a maintainer marks; a queued deploy runs at the next gap and readiness shows "a release waits".
- **B.** Deploys run only in a weekly window (for example Tuesday 03:00) and never while live.
- **C.** Deploy anytime; additive contracts keep it safe.
- **Recommendation: A** for `stable`, and C for `dev` (the test VM). It answers the roadmap's open question for one venue's calendar; overlapping live events can be weighed again at the checkpoint.

### D13. Finnish: how are strings kept?
- **A.** One catalog per module and package (`i18n/en.json`, `i18n/fi.json`, keys by page), read by a small helper in each kit; ICU plural and select forms; dates, times and numbers through the platform's format helpers (`Intl` in TypeScript, Babel in Python).
- **B.** gettext `.po` files.
- **C.** Strings stay in code with an `if fi` branch.
- **Recommendation: A.** JSON reads the same in both kits and needs no build step; ICU covers Finnish plurals; a CI check finds missing keys ([mockup 11](11-language.svg)).

### D14. Which surfaces speak Finnish in this step?
- **A.** Every organiser page, every screen word (NOW, NEXT, "offline since", device states, Moments' built-in stories) and every hub and public page built by then; Discord's bot messages too if the bot (step 6) is built.
- **B.** Screens and the hub only; organiser pages stay English.
- **Recommendation: A.** The event's `language` setting already promises "organiser pages and screens"; a half-translated shell reads worse than English.

### D15. Whose language: the event's or the person's?
- **A.** The event's `language` for screens and public pages; each person's own choice (default: the event's) for organiser pages and the hub.
- **B.** The event's for everything.
- **Recommendation: A.** A visiting crew member reads English while the hall reads Finnish. **Contract:** a `language` field in the person's profile (tenants or admin, additive).

### D16. Who translates, and how are new strings kept current?
- **A.** The lead writes Finnish with each new page from this step on; a CI check fails a PR that adds an English key without its Finnish one; the product owner reviews the first full pack.
- **B.** A translation tool (Weblate) and volunteers.
- **Recommendation: A.** One language, a small team; B can come with a third language.

### D17. How are update PRs grouped?
- **A.** Renovate: one grouped PR a week for minor and patch updates of npm, PyPI, base images and actions; majors one PR each; security fixes at once. Each PR's body follows the PR rules through a template (a standing issue "Dependency updates" for `Closes`-free tracking, `Risk:`, `Tier: fix`).
- **B.** Dependabot with its defaults.
- **Recommendation: A** ([mockup 14](14-dependency-updates.svg)). Renovate groups across ecosystems and fills the body; 0015's "an exemption in the PR rules or one grouped weekly PR tied to a standing issue" becomes the template. **high** (`.github/`).

### D18. Where does the audit run?
- **A.** On every PR that changes a lock file (fails on high and critical), plus the weekly run on main (today's `audit` job), plus Renovate's security PRs.
- **B.** Weekly only (today).
- **Recommendation: A.** The exit criterion says "in CI"; a PR must not bring a known vulnerability in. An ignore needs a reason and an end date in one file (`audit-ignore.yaml`).

### D19. Images too?
- **A.** Renovate pins base images by digest and updates them; a weekly image scan (Trivy or Grype) of the release images, findings as a `regression` issue.
- **B.** Base image updates only.
- **Recommendation: A** with the scan reporting, not gating, until the first clean run.

## E · Edge cases and failure

### E1. Two primaries after a switch?
The VM comes back while the laptop is the primary; phones on mobile data write to the VM, screens to the laptop.
- **A.** Fence: `promote` writes a fence mark for the platform at the backup target (and on the VM if reachable); a VM that starts or reconnects reads it and serves read-only with "the event runs on the fallback" until the superadmin moves the data back.
- **B.** Shut the VM down by hand through the hoster before promoting.
- **C.** Merge both afterwards.
- **Recommendation: A**, with B in the runbook when the hoster answers. C has no safe merge for counters, orders and claims ([mockup 16](16-failure-modes.svg)).

### E2. Moving back from the laptop to the VM?
- **A.** After the event (or in a quiet hour): the laptop backs up, the VM restores it (`setup/restore --from-laptop`), the superadmin un-fences, the screens move back when the VM says it is the primary.
- **B.** Right away when the VM returns.
- **Recommendation: A.** One more move in the middle of the night is one more risk.

### E3. The venue uplink down, the VM fine?
- **A.** Do not switch: screens keep their last state (built); the crew is told by Studio's uplink line; phones on mobile data keep working.
- **B.** Switch to the laptop for the hall.
- **Recommendation: A** for up to 30 minutes, then B if the crew asks: after B, E1's fence holds, since phones still reach the VM.

### E4. A backup is missing or corrupt when needed?
- **A.** Restore picks the newest base that passes its check, then replays WAL; it names what was skipped and the data's age before it starts.
- **Recommendation: A**, and the weekly drill (O4) makes this rare.

### E5. The secrets key is lost?
- **A.** The data restores, but sealed secrets (bot tokens, check-in keys, provider secrets) are unreadable: the restore says which and how to re-enter each (the bot token from Discord's developer page, and so on).
- **Recommendation: A**, and two copies of the kit (D3) make it rare. VAPID: phones must subscribe again; the restore says so.

### E6. The fallback laptop has the wrong release?
- **A.** `setup/fallback check` and the readiness row fail when the laptop lacks the images of the stack's release; `setup/fallback sync` fetches them while the laptop still has internet.
- **Recommendation: A.** The restore refuses a dump newer than the laptop's migrations (as `profile_too_new` does for profiles).

### E7. Certificates on the laptop?
- **A.** The laptop serves plain HTTP on the venue LAN (the stack's IP mode); screens work on HTTP; Studio on the laptop is allowed only from the venue's LAN and the laptop's own screen.
- **B.** The laptop carries a copy of the wildcard certificate and the venue router points the hostname at it.
- **Recommendation: A.** B needs the venue's DNS and puts a private key on a laptop. **high** (sign-in on the laptop, E8).

### E8. Sign-in on the laptop?
- **A.** Crew sign in with the restored sessions where possible; otherwise a one-time code printed by `setup/fallback promote` opens a crew session for 12 hours (Discord's OAuth needs the public hostname).
- **B.** No sign-in on the laptop: Studio open on the LAN.
- **Recommendation: A.** B leaves the hall's screens to anyone on the venue Wi-Fi. **high** (sign-in, sessions).

### E9. The watchdog itself is down?
- **A.** The VM's heartbeat sender notices when the watchdog does not answer and says so in Health ("the watchdog has not answered for 10 minutes"); the readiness row turns red.
- **Recommendation: A** (who watches the watchman, cheaply).

### E10. False alarms?
- **A.** The legacy causes fixed: count from the first heartbeat (bot problem 9); no "healthy" before the first poll (P10); a slow poll never blocks the heartbeat (P5); alerts retried until delivered (P7).
- **Recommendation: A**, each with a test.

### E11. A deploy during a live event?
- **A.** The deploy waits (D12); a hotfix a maintainer marks runs with a backup first and its rollback as today.
- **Recommendation: A**, the auto-deploy's rollback (built) unchanged.

### E12. Disk full on the VM?
- **A.** The heartbeat carries the disk use; the watchdog alerts at 85 %; WAL archiving that cannot push alerts at once (Postgres would otherwise keep the WAL and fill the disk).
- **Recommendation: A.**

### E13. A failed Finnish key at runtime?
- **A.** Fall back to English for that string and log the key once; CI's check makes it rare.
- **Recommendation: A.** Never show a raw key.

### E14. Long Finnish words in fixed boxes?
- **A.** Every screenshot runs in both languages in CI; a check flags text that overflows its box (the a11y check's run).
- **Recommendation: A.** Finnish is often a third longer; the screens' fixed boxes are the risk ([mockup 11](11-language.svg)).

### E15. An update PR breaks the build?
- **A.** Renovate's PR stays red; CI's failure is the review; nobody merges it; after two red weeks the lead triages it like a `regression` issue.
- **Recommendation: A.**

### E16. A vulnerability with no fix?
- **A.** An entry in `audit-ignore.yaml` with the advisory id, a reason, and an end date after which CI fails again.
- **Recommendation: A** (0015: "explicitly ignored with a reason").

## O · Operations and scale

### O1. Drill cadence?
- **A.** Weekly in CI on the demo stack (O4), monthly on the fallback laptop by the superadmin with the result recorded, and once in the step 11 dress rehearsal.
- **B.** Monthly only (0013).
- **Recommendation: A** ([mockup 05](05-backups-and-drills.svg)).

### O2. Where are drill results kept?
- **A.** `setup/fallback check` and `setup/restore --verify` post a result to the platform (time, duration, data age, outcome); Health and readiness show the latest.
- **B.** A line in a log on the laptop.
- **Recommendation: A.** **Contract:** an internal endpoint for drill results (admin, additive).

### O3. Retention?
- **A.** The legacy numbers: 7 daily and 4 weekly base backups, WAL for 7 days (#55 sets them; this step only shows them).
- **Recommendation: A** (gap 12, TH4).

### O4. A restore drill in CI?
- **A.** The weekly run gains `restore`: make a backup of the demo stack, wipe it, restore onto a fresh stack with the key, verify (D5), and time it.
- **Recommendation: A.** It proves the exit criterion every week, not once. **high** (`.github/`).

### O5. The event timeline?
- **A.** A fixed timeline per event: T−14 days pick the release; T−7 the readiness digest and the laptop's check; T−1 the deploy hold starts and a fresh backup is verified; doors−2 h the last digest; during the event the WAL copy on the laptop; T+1 the hold ends.
- **Recommendation: A** ([mockup 03](03-event-timeline.svg)); the timeline is what the readiness page and the digests follow.

### O6. The install kit's checks?
- **A.** `setup/check-host` before install: Debian version, Docker, RAM and disk, ports, DNS for the domain, time sync, outbound to the registry, the backup target and the watchdog; it also runs on the laptop.
- **Recommendation: A** ([mockup 10](10-install-kit.svg)), one script, `--dry-run` as every setup script.

### O7. How long does an install take?
- **A.** Target: from a fresh Debian to a working demo event in 20 minutes with prepared values.
- **Recommendation: A**, timed in the dress rehearsal (step 11).

### O8. The reviewer's own OS user?
- **A.** A setup script (`setup/reviewer-user`) creates the user, moves the reviewer token into its home (mode 600), and gives author sessions a deny rule; the reviewer runs through `sudo -u` with only its command allowed.
- **B.** A maintainer does it by hand following a short doc.
- **Recommendation: B**, with the doc in `setup/README.md`: it runs once per VM, and a script would be privileged code to review for one use ([mockup 15](15-reviewer-user.svg)). **high** (agent config, secrets).

### O9. Load at the large event?
- **A.** Out of this step: the load harness is backlog (0022).
- **Recommendation: A**; readiness may show the event's expected size beside the VM's size as a note.

### O10. Translation upkeep cost?
- **A.** Each later package adds its Finnish strings in the same PR (D16); the health pass checks coverage.
- **Recommendation: A.**

## P · Plan and scope

### P1. The direction?
- **A.** The runbook: scripts and docs.
- **B.** The control room: a superadmin web console for everything.
- **C.** Ready by design: deep tools on the command line, thin visible surfaces where people decide.
- **Recommendation: C** ([mockup 01](01-directions.svg), the brief's argument).

### P2. The issue set?
- **A.** The seven issues the brief proposes, in four packages by risk and area.
- **B.** One issue per roadmap bullet (ten).
- **Recommendation: A** ([Proposed issue changes](../step-10-hardening.md#proposed-issue-changes)).

### P3. The exit criteria?
- **A.** The roadmap's two, made checkable: (1) on a laptop with nothing but the kit and the emergency kit, the demo platform is restored from the off-VM backup within 30 minutes, every module is healthy, a sealed secret opens and a screen shows the demo event; (2) the audit runs on PRs and weekly, and the first grouped update PR has arrived. Plus: the watchdog alerted on a stopped heartbeat and recovered once; every page in Finnish with no missing key.
- **B.** The roadmap's two only.
- **Recommendation: A** ([Proposed exit criteria](../step-10-hardening.md#proposed-exit-criteria)).

### P4. What waits for #55 and #45?
- **A.** The restore, the drill and the laptop need #55's backups; the readiness page, the language pack, the shell themes, the admin pass, the audit and Renovate do not. Those start first.
- **Recommendation: A**: the order sketch in the brief.

### P5. Risk classes?
- **A.** The restore, fallback and watchdog package high (`setup/`, secrets, sign-in on the laptop); releases and dependency updates high (`.github/`, `setup/deploy`); readiness, the language pack, the admin pass and themes normal; the reviewer user a maintainer task.
- **Recommendation: A.** Related high-risk issues share one package each (one accept per area).

### P6. Step 8 overlap?
Step 8 (admin operations) brings alerts as events, ack and mute, and `/platform status`.
- **A.** The watchdog's alerts do not go through step 8's path (the bot runs on the VM); readiness digests to organisers do (they are about events, not the platform).
- **Recommendation: A**: the one thing that must work when the VM is gone cannot depend on it.

### P7. What stays out of step 10?
- **A.** The backup job itself (#55), the go-public checklist (#51), the dress rehearsal and the switch (step 11), the load harness (backlog), a hot standby and a venue edge box (0022), a third language, translation tooling.
- **Recommendation: A.**
