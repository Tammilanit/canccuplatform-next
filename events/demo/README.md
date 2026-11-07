# Demo event

Complete placeholder profile used by tests and screenshots; the tenants module seeds the demo tenant from it. Validated by `scripts/check-contracts`. Contains no real event content.

## Themes
`themes/` holds the demo tenant's theme packages ([contracts/theming.md](../../contracts/theming.md)); CI screenshots each one, and those screenshots are the theming contract's test.

- `default`: the platform default colours put through the simple mode.
- `terminal`: the advanced mode, with CSS, two fonts, templates, a portrait layout and an embed; ported from the legacy signage look. Fonts: Barlow Semi Condensed by The Barlow Project Authors, SIL Open Font License 1.1 (`themes/terminal/fonts/OFL.txt`).

The template field names follow the screen contract's widget fields; they are placeholders until that contract names them.
