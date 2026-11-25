# Demo event

Complete placeholder profile used by tests and screenshots; the tenants module seeds the demo tenant from it. Validated by `scripts/check-contracts`. Contains no real event content.

## Media
Generated with ffmpeg 5.1's lavfi sources (`gradients`, `mandelbrot`, `life`) and `drawtext` in DejaVu Sans, in the Default theme's colours; no people, no real places. The dev server's screen seed (`modules/screen/src/dev-seed.ts`, #788) puts them on the demo event's screens; the screen image carries them.
- `media/photos/demo-photo-1.jpg` … `-8.jpg`: 1280×960 abstract stills, the photo wall's placeholder photos (their captions and placeholder authors are the seed's).
- `media/slides/demo-slide-welcome.jpg`, `-tournament.jpg`, `-food.jpg`: 1920×1080 title cards for the demo loop.
- `media/demo-clip.mp4`: an 8 s clip of drifting gradients with the words "Demo clip", H.264, no sound, for the demo loop.
- `media/demo-film.mp4` (not a profile asset, so the profile export leaves it out): "Demo Event: the film", a 12 s placeholder (a title card over a soft chord, H.264 and AAC, made with ffmpeg's `color` and `aevalsrc` sources and `drawtext` in DejaVu Sans). The storyboards' Premiere preset plays it in the CI screenshots (`scripts/demo-screenshots-stories.mjs`, mockup 22).

## Themes
`themes/` holds the demo tenant's theme packages ([contracts/theming.md](../../contracts/theming.md)); CI screenshots each one, and those screenshots are the theming contract's test.

- `default`: "Demo night", the design guideline's base look (`docs/design/mockups.html`), in the simple mode; the profile's `theme` carries the same colours, so the event looks the same before a theme is published.
- `terminal`: the advanced mode, with CSS, two fonts, templates, a portrait layout and an embed; ported from the legacy signage look. Fonts: Barlow Semi Condensed by The Barlow Project Authors, SIL Open Font License 1.1 (`themes/terminal/fonts/OFL.txt`).
- `level-up`: an original advanced-mode theme built on progression: countdowns fill like progress bars, announcements arrive as achievement cards, the leaderboard reads as a rank ladder, the clock sits in a HUD frame, over glass panels in a warm ember palette of its own and a calm animated embed (`drift`, a still frame under `prefers-reduced-motion`). Its `main` (16:9) and `portrait` (9:16) layouts each place every screen widget, for the per-widget screenshots. Fonts: Chakra Petch by The Chakra Petch Project Authors (`themes/level-up/fonts/OFL-chakra-petch.txt`) and Exo 2 by The Exo 2 Project Authors (`themes/level-up/fonts/OFL-exo-2.txt`), both SIL Open Font License 1.1.

The template field names follow the screen contract's widget fields; they are placeholders until that contract names them.
