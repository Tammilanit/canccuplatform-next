# One design: the design language, the organiser shell and the screens

Issue #382. The UX audit ([docs/reports/ux-audit-step3.md](../reports/ux-audit-step3.md)) found that the platform looks like three products: admin unstyled, the event pages each with their own frame, the screens a third look. These mockups are the one design the product owner accepts before any build. Then #383 (the shell and the language on every organiser page), #384 (the brand kit) and #385 (the device frames) build them.

**Open [`mockups.html`](mockups.html) in a browser** (download it or open it from a checkout; GitHub shows only its source). It is one self-contained page, with no scripts and no external files. A bar at the top jumps between the nine sheets. A switch at the top right recolours every mockup with three themes: the platform default, "Demo night" (the palette of the Pulse mockups 02–05) and a light scheme. Use it to see that the whole design follows an event's theme. Desktop frames are drawn at 1440 px and phones at 390 px. On a smaller monitor the board shrinks the desktop frames.

## The sheets

| # | Sheet | Shows | Audit findings |
|---|---|---|---|
| 1 | Design language | Colour use, type scale, spacing, widths, date and time format, buttons (every kind as link and button, every state, every size), form fields, cards, tables, badges, notices, empty states | A1 and A4 (design side), B1, B4, B5, F2–F4 |
| 2 | Organiser shell | Header, Event menu, sub-page row and content width at 1440 px; the phone layout at 390 px with the menu closed and open | A1, A2, B2, B4 |
| 3 | Sign-in | Desktop and phone, plus the failed, not-set-up and first-run states | A1, A5, E2 wording |
| 4 | Admin pages | Settings of a module (desktop), health (desktop), event profile and people (phone); settings itself is on sheet 2 | A1–A5, F4 |
| 5 | Run of show | The day (desktop and phone), one item (phone), Quick add (phone) | B1, B2, B5, F1, F2 |
| 6 | Theme studio | The Studio frame with the brand kit (mockup 12) inside the shell | B2, B4; C2–C4 (frame side only) |
| 7 | Check-in | The attendee's four steps on a phone, with the event's header | E1, E2 |
| 8 | Errors | No access (desktop); not found, not at the venue and event archived (phone); the archived banner on a read page | B3, D7 (design side) |
| 9 | Screens | Pulse for reference, then pairing, not assigned, refused, event ended, offline and identify, as one family | D1–D3, D6, D7 (design side) |

## The rules in short

- **Tokens only.** Every colour comes from the eleven theme tokens. Tints, hovers, the current-page fill and the badge and notice fills are mixed from them (`color-mix()`), so no new token is needed. An event theme, dark or light, restyles every page.
- **One job per colour.** Primary marks the action, links, focus and "now"; the now line is primary, not red (F2). Accent is for highlights only. Status colours mean status and nothing else. A badge is always a word, never colour alone.
- **Type.** Seven sizes: 12, 14, 16, 18, 22, 28 and 36 px. Every page title is 28 px (24 px on a phone), and it appears once: the header names the event, the menu the section, the title the page (B4).
- **Space and width.** Spacing on a 4 px rhythm. Two content widths, set by `page()` per kind of page: 40rem for forms, 64rem for workspaces (B4).
- **Buttons.** Four kinds: primary, secondary, ghost and danger, plus a quiet danger for links that ask first. Each looks the same whether it is an `<a>` or a `<button>`. The link colour moves into `:where(.canccu-page) a`, so every button variant beats it (B1).
- **Fields.** The label above, the hint below, the error under the hint, units beside the number. Checkboxes and switches are rows with their hint under the label (A4).
- **Words.** Plain words everywhere, no ids: module names instead of `screen` (A2); "Draft" instead of revision numbers; the page name instead of a right id (B3); the font's name instead of a schema path (C1). Dates and times follow the event's `language` and `timezone`, inputs included (B5).
- **Never a dead end.** The Event menu lists only the pages this person may open. Every empty state and every error page names the next step.

## Decisions made

These choices are open to the product owner and the reviewer:

1. **One file, not one per surface.** One style block serves every sheet, and the theme switch reaches every mockup at once. Nine files would repeat the style block nine times.
2. **`docs/design/`, not `docs/briefs/step-3-screen/`.** The language applies past step 3, and the step 3 brief's mockups stay as they are ([docs/briefs/README.md](../briefs/README.md)). `scripts/file-size-exemptions.txt` gets one line for `docs/design/*.html`, the same exemption the brief mockups have.
3. **The Event menu sits at the side on desktop.** The accepted mockup 07 already puts the Screen studio's navigation there, and a side menu still has room as steps add modules. On a phone the same menu opens from the header as a full-screen sheet.
4. **Sub-pages are tabs under the page title.** Actions such as Quick add and New topic are buttons, not tabs. Admin's pages (Settings, Health, Event profile, People) are menu items with no tab row.
5. **The header shows the event's time and its time zone.** Organisers run the day from that clock, and it shows what the time-zone setting does (B5).
6. **The safety elements stay as they are (D2).** The pairing code and the offline marker look exactly as `ui.css` and the theming contract draw them today: white on black, the code centred, the marker top right. The frames are laid out around them, and mockup 05's amber marker is retired. This needs no contract change. Q2 offers the other way.
7. **"Not at the venue" has no menu.** The network refusal comes before any session is read, so the page shows only the event's header.
8. **New class names** (for example `canccu-notice`, `canccu-empty`, `canccu-menu`, `canccu-tabs`) are only a proposal. #383 decides which ones become stable classes in `contracts/theming.md`; that is an additive contract change, in its own PR first.

## Questions for the product owner

- **Q1 · The Event menu on desktop.** (a) At the side, as drawn. (b) Behind a Menu button, as on a phone. *Recommended: (a).* The current page is always in view, and the menu has room for later modules.
- **Q2 · Safety elements on screens (D2).** (a) Keep `ui.css`'s fixed white-on-black look, as drawn; no contract change. (b) Change the theming contract's safety rule so the marker can be amber and the code can sit inside the frame's layout, as in mockup 05; that is a contract change, possibly breaking, and high risk. *Recommended: (a).*
- **Q3 · The pairing and refused frames before a screen has a zone.** (a) Use the event's published theme tokens (never its CSS) wherever the server can send them, else the defaults. (b) Always use the defaults. *Recommended: (a).* Either way the background is the same family, so nothing jumps (D1).
- **Q4 · Desktop item page.** The run-of-show item is drawn on a phone, where live edits happen. On desktop it uses the same content in the 40rem column. (a) That is enough. (b) Draw it as a side panel next to the day. *Recommended: (a)* for step 3.
- **Q5 · The demo theme's font (C1).** Mockups use the system font. (a) Drop Inter from the demo profile. (b) Ship Inter as a theme font file. *Recommended: (a).* The Studio's fix is #384's.

## Not in these mockups

- The brand kit's own layout and previews beyond the frame: mockup 12 and #384.
- The Pulse look itself: mockups 02–04 and #375.
- The phone hub: the App track.
- The Screen studio pages: mockups 07–10 and #189.
