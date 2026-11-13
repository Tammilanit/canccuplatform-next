# Demo event

Complete placeholder profile used by tests and screenshots; the tenants module seeds the demo tenant from it. Validated by `scripts/check-contracts`. Contains no real event content.

## Themes
`themes/` holds the demo tenant's theme packages ([contracts/theming.md](../../contracts/theming.md)); CI screenshots each one, and those screenshots are the theming contract's test.

- `default`: "Demo night", the design guideline's base look (`docs/design/mockups.html`), in the simple mode; the profile's `theme` carries the same colours, so the event looks the same before a theme is published.
- `terminal`: the advanced mode, with CSS, two fonts, templates, a portrait layout and an embed; ported from the legacy signage look. Fonts: Barlow Semi Condensed by The Barlow Project Authors, SIL Open Font License 1.1 (`themes/terminal/fonts/OFL.txt`).
- `level-up`: an original advanced-mode theme built on progression: countdowns fill like progress bars, announcements arrive as achievement cards, the leaderboard reads as a rank ladder, the clock sits in a HUD frame, over glass panels in a warm ember palette of its own and a calm animated embed (`drift`, a still frame under `prefers-reduced-motion`). Its `main` (16:9) and `portrait` (9:16) layouts each place every screen widget, for the per-widget screenshots. Fonts: Chakra Petch by The Chakra Petch Project Authors (`themes/level-up/fonts/OFL-chakra-petch.txt`) and Exo 2 by The Exo 2 Project Authors (`themes/level-up/fonts/OFL-exo-2.txt`), both SIL Open Font License 1.1.

The template field names follow the screen contract's widget fields; they are placeholders until that contract names them.
