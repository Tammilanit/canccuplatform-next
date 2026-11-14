# Theming contract

Each event's own design, without code ([0013](../docs/decisions/0013-multi-tenant-core.md) items 19–21, [0022](../docs/decisions/0022-product-vision.md)): the stable CSS classes and custom properties every surface uses, the theme package (tokens, CSS, fonts, images), screen layouts as data, logic-less widget templates, custom embeds, the brand kit's simple and advanced modes, draft → preview → publish with rollback, and the security rules for everything an event uploads. The `theming` module owns it. Other modules render with it; none stores a theme of its own. The event profile's `theme` and `logos.main` ([profile.md](profile.md)) are the short form with the same token names: they apply only while the event has no published revision, and a published revision always wins. Theming reads them from admin's `GET /internal/admin/profile/theme` and `…/profile/logo` ([admin.md](admin.md#profile)). It fetches the logo only when `logo_main.sha256` changed, and re-reads the theme when the bytes' SHA-256 (the `ETag`) differs from it. It checks the logo as it checks a package image and leaves out one that fails, logging why, so a profile never brings in an image the theme rules would refuse; the profile's `fonts` go through the checks of a package's font tokens. Its copy of the logo counts against the storage quota like every file it stores: reserved before writing, released when the profile's logo changes or goes. Until #241, revision 0 answers the platform defaults.

**Machine-readable:** [theming.openapi.yaml](theming.openapi.yaml) (OpenAPI 3.1) is the source for paths, fields and status codes; [theme.schema.json](theme.schema.json) (JSON Schema 2020-12) for the package manifest `theme.yaml`. This file explains them and adds the rules and events. Conventions (field names, times, error body): [README.md](README.md#conventions).

## Words
- **Theme:** an event's whole design: one theme package plus its layouts, templates and embeds, published together.
- **Revision:** one published, immutable version of the theme, numbered 1, 2, 3, … per event. The **current** revision is the one surfaces show.
- **Draft:** the one editable copy of an event's theme. It becomes a revision only by publishing.
- **Surface:** a place that shows the theme: the venue screen, the phone hub, the public info pages, the admin and sign-in pages, Discord.
- **Sandbox:** where an event's custom HTML and JS are served, always with an opaque origin: by default the fixed path `/theming/sandbox/` on the event's own hostname (the **same-host sandbox**), or, as optional hardening, a separate sandbox origin (see Upload safety).
- **Sandbox origin:** that separate origin, `https://<tenant id>.<sandbox domain>`, used only when the stack sets `CANCCU_SANDBOX_DOMAIN`.

## Tenancy
- A theme belongs to one event, which is one tenant ([0013](../docs/decisions/0013-multi-tenant-core.md)); the tenant comes from the request's hostname. Drafts and revisions are rows with `tenant_id` under row-level security.
- Files live under `/files/<tenant>/theming/` in the shared files volume, content-addressed (SHA-256), and are served only after the tenant check.
- Events go to the tenant's stream `t:<tenant>:events:theming`. An archived event's theme is read-only: writes get 409 `event_archived`.
- An event with no published theme shows the **platform defaults**, with the event profile's `theme` applied over them. The platform defaults are the `ui.css` defaults of [packages/ui](../packages/ui/README.md), except `primary_text`, which is `#0f172a`: the white of today's `ui.css` reaches only 3.7:1 on `primary` and `status_down`, below the contrast rules (packages/ui follows). The platform defaults pass every contrast rule.

## What applies where
The rule protects people from look-alike controls: an event's CSS and templates restyle what attendees see, never the pages where admins grant rights or people sign in.

| Surface | Tokens and fonts | Images (logo) | CSS | Layouts | Templates | Embeds |
|---|---|---|---|---|---|---|
| Venue screen | yes | yes | yes | yes | yes | yes |
| Phone hub, public info pages | yes | yes | yes | — | yes | — |
| Admin, sign-in, superadmin, privacy pages | yes | yes | — | — | — | — |
| Discord (the bot) | embed colour | logo as PNG (`logo_png_url`; Discord shows no SVG) | — | — | — | — |

Admin and sign-in pages take the colour tokens only when the simple mode's contrast rules hold for them (see Brand kit); for a theme that fails them those pages use the platform default colours with the theme's fonts and sizes. `admin_tokens_css_url` serves exactly that set, so admin pages never build it themselves.

## Stable classes and custom properties
These are the contract every surface keeps and every theme may rely on (theming version 1). Adding a class or a token is additive; removing or renaming one is a breaking contract change. Modules mark up their pages with these classes; anything else in their markup may change in any release, and a theme that styles it may break.

**Custom properties**, one per token (`theme.yaml` `tokens`; defaults in [packages/ui](../packages/ui/README.md#tokens)):

| Token group | Tokens | Custom property |
|---|---|---|
| `colors` | `background`, `surface`, `border`, `text`, `text_muted`, `primary`, `primary_text`, `accent`, `status_ok`, `status_degraded`, `status_down` | `--canccu-color-<name>` (`text_muted` → `--canccu-color-text-muted`) |
| `fonts` | `body`, `heading`, `display` (new: big screen text, defaults to `heading`), `mono` | `--canccu-font-<name>`: the family, quoted unless it is a generic family (`system-ui`, `ui-monospace`, `sans-serif`, `serif`, `monospace` stay unquoted), then a generic fallback the platform appends (`system-ui, sans-serif`; for `mono` `ui-monospace, monospace`) |
| `sizes` (new) | `radius` (default `0.5rem`), `border_width` (`1px`), `gap` (`1rem`), `safe_inset` (screen edge margin, `48px`) | `--canccu-<name>` (`--canccu-radius`, `--canccu-border-width`, …) |
| `motion` (new, one value) | `moderate` (default), `calm` or `none` | None: it is not a CSS value. Screens get it as `ScreenState.display.motion` ([screen.md](screen.md#motion-and-burn-in-drift)) |
| `motion_style` (new) | `speed` (`slower`, `normal` (default), `faster`), `intensity` (`subtle`, `normal` (default), `strong`), `spotlight` (`glow_and_trace` (default), `glow`, `trace`), `pack` (`standard` (default), `broadcast`, `arcade`) | `--canccu-motion-speed`: a factor on every effect's duration (`slower` 1.4, `normal` 1, `faster` 0.75); `--canccu-motion-intensity`: a factor on its glow and scale (`subtle` 0.6, `normal` 1, `strong` 1.4). Screens get the four as `ScreenState.display.motion_style`; see Motion vocabulary |

**`motion`** caps how much the screen moves: `moderate` caps nothing, `calm` keeps every zone at most at the energy level `calm`, `none` keeps it still. The level itself is the event's and the zone's (`ScreenState.display.motion_level`, [screen.md](screen.md#motion-and-burn-in-drift)); Screen lowers it during the event's quiet hours, and the player to `none` under `prefers-reduced-motion: reduce`. A player that reads only `ScreenState.display.motion` draws it as before: `moderate` allows region transitions and the ticker's fades, `calm` keeps only slow fades, `none` swaps at once. It is not styling, so it may be set in either mode: setting it never makes a theme advanced, and Back to simple keeps it. The same holds for `motion_style`.

**Classes** (BEM; the `canccu-` prefix is reserved for the platform, [0017](../docs/decisions/0017-naming.md)):

| Block | Elements and modifiers | Where |
|---|---|---|
| `canccu-page` | — | `<body>` of every platform page |
| `canccu-surface` | `--screen`, `--hub`, `--info`, `--admin` | `<body>`, next to `canccu-page`; the root a theme's CSS targets |
| `canccu-header` | `__logo`, `__title` | Page header |
| `canccu-main` | — | Main content |
| `canccu-card` | `__title` | Card |
| `canccu-field` | `--check`, `__label`, `__hint`, `__error` | Form field |
| `canccu-input`, `canccu-check` | — | Input, checkbox |
| `canccu-button` | `--primary`, `--secondary`, `--danger` | Button |
| `canccu-badge` | `--ok`, `--degraded`, `--down` | Health badge |
| `canccu-layout` | `--<layout id>` | A screen layout |
| `canccu-region` | `--<region id>` | A layout region |
| `canccu-widget` | `--<widget type>`, `__title`, `__body`, `__footer`, `__art` | A widget in a region, on the screen or the hub; `__art` is its card background (The two backgrounds) |
| `canccu-embed` | — | The frame of an embed |
| `canccu-is-active`, `canccu-is-empty`, `canccu-is-stale`, `canccu-is-offline` | — | State: the widget now shown in a rotation; a widget with nothing to show; data older than its widget allows; a screen without uplink |
| `canccu-motion` | `--none`, `--calm`, `--lively`, `--party`; `canccu-motion-pack--standard`, `--broadcast`, `--arcade` | `<body>` of a screen: the energy level and motion pack it draws now (Motion vocabulary) |
| `canccu-fx` | `--roll`, `--flap`, `--sweep`, `--pop`, `--tilt` | An element while it plays that effect (Motion vocabulary) |
| `canccu-spotlight` | `--outline`, `--glow`, `--trace`, `--pop`, `--burst` | The box that holds the screen's spotlight, with the parts it draws at the level |
| `canccu-stage` | `__art`, `__glow`, `__kind`, `__phase`, `__tint`, `__scrim`; `--kind-<kind key>`, `--phase-<phase>`, `--tinted`, `--art` | The stage behind a screen's boxes, its layers, and what it shows now (The two backgrounds) |

Templates and a theme's CSS may add classes of their own only with the prefix `t-` (`t-clock`), so no event class collides with a platform class now or later.

## Motion vocabulary
How a screen moves is theme data: the theme picks the feel (`motion_style`), the event and the zone pick the energy level ([screen.md](screen.md#motion-and-burn-in-drift)), and the player draws the effects below with CSS animation (design guideline sheet 11 and amendment 1). The level changes how a screen moves, never what it says or its pace: rotations keep the zone's dwell at every level.

| Effect | Kind | When | Levels | Lasts | The theme sets |
|---|---|---|---|---|---|
| Number roll (`canccu-fx--roll`) | Change | A number changes: counts, hours, places | calm, lively, party | 0.7 s | speed |
| Split-flap (`canccu-fx--flap`) | Change | A time changes: a delay, a new start | calm, lively, party | 0.6 s | speed |
| Sweep (`canccu-fx--sweep`) | Spotlight | A box's content changed: a light sweeps across it once | lively, party | 1.1 s | speed, intensity |
| Pop, tilt (`canccu-fx--pop`, `--tilt`) | Spotlight | A box's content changed: a small move of the whole box, after the sweep | party | 0.45 s | speed, intensity |
| The countdown's spotlight (`canccu-spotlight`) | Spotlight | A countdown is 5 minutes or less from its start, until the start | none and calm: a steady outline (`--outline`); lively: the theme's `spotlight` (`--glow`, a glow pulse, 1.6 s a turn, and/or `--trace`, a tracing border, 2.4 s a turn); party: the same, plus a pop and a ring burst at the 5-minute mark (`--pop`, `--burst`) | while it holds | spotlight, speed, intensity |
| Background drift | Ambient | Always: the stage's glows drift | none: still; calm: 120 s a turn; lively: 45 s; party: 20 s | always | colours |

- **`speed`** scales each effect's duration by `--canccu-motion-speed`, never a rotation's dwell or the background drift. **`intensity`** scales its glow and scale by `--canccu-motion-intensity`. **`spotlight`** picks the lively and party spotlight: `glow_and_trace` both, `glow` or `trace` one; at none and calm the spotlight is always the steady outline.
- **`pack`** gives the same effects another personality: `standard` soft fades and slides; `broadcast` slabs, skewed tabs and hard wipes; `arcade` chunky cards and stepped motion. A pack changes the shapes and easing of the effects, never which effects play at a level or how long they hold.
- **The 3-per-second rule:** nothing on a screen flashes, and nothing blinks or pulses more than three times a second (WCAG 2.3.1); the fastest repeating effect is the glow pulse, once every 1.6 s at `normal` speed and once every 1.2 s at `faster`. A theme's CSS keeps the same rule.
- **One spotlight at a time:** a screen holds at most one spotlight, and starts at most one every 10 seconds; another waits its turn.
- **Region transitions and the ticker:** when a region's rotation moves to its next widget, and when the ticker moves to its next line: at `none` they swap at once; at `calm` they keep only slow fades, in every pack; at `lively` and `party` they play the region transitions and the ticker's fades, as `display.motion` `moderate` allows, in the pack's shapes and easing.
- **Cheap to run:** effects move only `opacity` and `transform` (and the split-flap's one stepped reveal), with no live blur or filters, so a kiosk PC runs them all day.
- **The reduced-motion rule:** a device whose browser asks for reduced motion draws the level `none`: values swap without motion, nothing drifts, and the countdown's spotlight is the steady outline. The ticker then steps line by line.

## The two backgrounds
A screen has two kinds of background (design guideline sheet 15, Q14). The **stage** is the whole screen behind the boxes: it belongs to the zone's moment and never stands still. The **card** is one box's own ground: it belongs to the widget. Screen composes what each shows ([screen.md](screen.md#the-stage)); the player draws it with the classes and custom properties below, so a theme's CSS restyles both.

- **The stage** is one element, `canccu-stage`, the first child of the screen's `<body>`, behind every region. Its layers, from the bottom:

| Layer | Shows | When |
|---|---|---|
| `canccu-stage__art` | The game's art, blurred by Screen's server (`display.stage.tint.art`) | While a box's tint carries art, at `lively` and `party`, unless the event switched the art off |
| `canccu-stage__glow` | Glows in the theme's `primary` and `accent` | Always; they drift at each level's pace (Motion vocabulary, Background drift) and stand still at `none` |
| `canccu-stage__kind` | A tint for the kind of the current item (`canccu-stage--kind-<kind key>`) | At `lively` and `party` |
| `canccu-stage__phase` | A tint for the day's phase (`canccu-stage--phase-<phase>`: `build_up`, `doors`, `peak`, `wind_down`, `quiet_hours`) | At `lively` and `party` |
| `canccu-stage__tint` | The tint a box asked for (`canccu-stage--tinted`) | At `lively` and `party`, until the tint's `until` |
| `canccu-stage__scrim` | The theme's `background` at the computed opacity `--canccu-stage-scrim` (0.55–1) | While the art shows (`canccu-stage--art`) |

- The platform's base layer gives the starter kinds and every phase a tint from the colour tokens; a kind an organiser adds gets none until a theme styles its class. A theme may style any layer and modifier.
- **The card:** a widget with `card_art` in its view-model gets `canccu-widget__art` as its first child. It holds the image as its background and sets `--canccu-card-veil` (0.5–1): a veil of the theme's `surface` at that opacity over the image, so the widget's text reads on any art. A widget without art draws no `__art`.
- **Cheap to run:** the art arrives already blurred, so the player applies no live blur or filters (Motion vocabulary); the layers move only by `opacity` and `transform`.

## The theme package
A folder (or a zip of it) with `theme.yaml` at its root ([theme.schema.json](theme.schema.json)). It is the format of an upload, a git sync and an export, so a theme moves between events and into an event's repo unchanged. Demo packages: [events/demo/themes/](../events/demo/themes/).

| Path | Holds | Accepted |
|---|---|---|
| `theme.yaml` | The manifest: `name`, `mode`, `brand`, `tokens`, `fonts`, `images`, `css`, `templates`, `embeds`, `layouts` | YAML, ≤ 64 KB |
| `css/` | Stylesheets (advanced mode) | `.css`, ≤ 256 KB together |
| `fonts/` | Font files, each with an SPDX licence id and its licence file | `.woff2`, ≤ 1 MB each; `.txt`/`.md` licences |
| `images/` | Logo, app icon, backgrounds, images for templates and CSS | PNG, JPEG, WebP ≤ 5 MB and ≤ 40 megapixels; SVG ≤ 512 KB |
| `templates/` | Widget templates | `.mustache`, ≤ 32 KB each |
| `embeds/<name>/` | Custom HTML, JS and their files | ≤ 5 MB per embed |

- Every path is relative, inside its folder, of `[A-Za-z0-9._/-]` only, with no `..`; a zip with absolute paths, links, nested archives, more than 300 files, more than 20 MB unpacked or an unpacking ratio over 100:1 is refused whole.
- Files are recognised by their content, never by their extension or the uploaded `Content-Type`; a mismatch is a problem.
- The package counts against the event's storage quota ([0013](../docs/decisions/0013-multi-tenant-core.md) item 27, [tenants.md](tenants.md#storage-quota)): theming reserves the bytes of the files it stores before writing them and releases them when it deletes them. An upload, sync or clone that would pass the quota is 413 `storage_quota_exceeded`; a clone is then refused whole (no revision, nothing copied).
- **Problems:** every check yields `{"severity": "error"|"warning", "code", "path", "message"}`. A draft may hold errors; publishing refuses a draft with any error (422 `theme_invalid`). Codes: `schema` (fails theme.schema.json), `file_missing`, `file_type`, `file_too_large`, `css_forbidden`, `template_forbidden`, `svg_forbidden`, `reference_unknown` (a template, embed, image or font name that does not exist, or a template made for another widget type), `duplicate_id` (a layout id, or a region id within a layout, used twice), `area_outside_grid`, `mode_mismatch` (an uploaded or synced package that declares `simple` but has CSS, fonts, templates, embeds, or font or size tokens; the editors never produce it), `contrast_low`, `text_small` (warning: text under 2.5 % of the screen height (27 px at 1080p) on the screen; see Advanced mode), `class_unstable` (warning: CSS styles a class that is neither stable nor `t-`), `widget_unknown` (warning: a widget type no module offers; the region shows nothing), `embeds_unavailable` (warning: the stack serves no embeds; with the same-host sandbox as the default it no longer arises, and the code stays so clients that know it keep working).

## Brand kit: simple mode
An organiser uploads a logo and picks two colours; the module generates the whole token set. A new branding takes minutes.

- `PUT /api/theming/draft/brand` with `logo` (an image already in the draft), `primary`, `accent`, `scheme` (`dark` or `light`) and optionally `icon` and `embed_color`. `logo` and `icon` become `images.logo` and `images.icon`, the theme's only logo and icon; the other fields are kept as `brand`. It regenerates `tokens.colors` and never changes the mode: on an advanced theme the colours update and its CSS, fonts, templates and embeds stay applied. It answers with the draft and `adjusted`: the tokens it had to lighten or darken from the given colours.
- **Generation is deterministic:** the same input gives the same tokens on every platform version that keeps the same theming version, so screenshots stay stable.
- **Contrast rules** (WCAG 2.2 contrast ratio): `text` and `text_muted` on `background` and on `surface` ≥ 4.5:1; `primary_text` on `primary` and on `status_down` ≥ 4.5:1; `primary` and `accent` on `background` ≥ 3:1; each status colour on `surface` ≥ 3:1. The simple mode never produces a failing pair: `primary_text` is the first of `background`, white and black that passes on both its fills, and where a given colour fails as text, a darker or lighter shade of it takes the text role and the given colour stays for fills.
- The simple mode keeps the default templates and no CSS, fonts or embeds; it still edits layouts.
- The **Discord embed colour** is `brand.embed_color`, otherwise `primary` (alpha dropped).
- **Live preview:** the admin shows the draft on a virtual screen in the admin's own browser, through the draft preview (see Draft, preview, publish).

## Advanced mode
The same package edited directly: tokens, CSS on the stable classes, fonts, images, templates and embeds, with the same draft → preview → publish and rollback.

- Any token change (except `motion` and `motion_style`, see Stable classes and custom properties), CSS, font, template or embed sets `mode: advanced`. Saving `brand` from the simple editor keeps `advanced` (see Brand kit).
- **Back to simple** only by the explicit switch `POST /api/theming/draft/mode` with `mode: simple` and `remove_advanced: true`: the client has told the person that the CSS, fonts, templates and embeds will be removed. The switch removes them and the font and size tokens, keeps images and layouts, regenerates the colours from `brand` (409 `brand_missing` without it) and answers with the draft and the removed paths. Removing embeds needs `theming.embeds.write` and is audited. So a round trip through the editors never mixes the modes; `mode_mismatch` arises only from an uploaded or synced package that declares `simple` with advanced files.
- Contrast failures are warnings (`contrast_low`) in advanced mode, never blocking, except that admin and sign-in pages then use the platform default colours (What applies where).
- **Small text** is a warning too (`text_small`), never blocking: text on the screen surface under 2.5 % of the screen height, 27 px at 1080p, is hard to read across a hall. Theming checks the CSS without rendering it: each `font-size` (and `font` shorthand) whose selector can apply on the screen surface, resolved for a 1920×1080 screen: `px` as it is; `rem` against the root size the theme sets, or the platform's; `vh` and `vmin` against 1080 px, `vw` and `vmax` against 1920 px; `%` and `em` against the platform's inherited size; `calc()` and `clamp()` at their minimum. A value it cannot resolve, such as one with `var()`, is skipped. `path` is the CSS file and `message` names the selector. Like `contrast_low`, it is listed among the draft's `problems`, so the publish page shows it before publishing. CI's rendered readability check catches what a static check cannot.
- **CSS rules,** checked with a CSS parser at upload, each failure an error `css_forbidden`: no `@import`, `@namespace` or `@charset` other than UTF-8; every `url()` names a file of the package's `images/` or `fonts/` (no other scheme, no `data:`, no `//`, no absolute path; rewritten to the served address on publish); `@font-face` only with package fonts; no `expression()`, `behavior`, `-moz-binding` or `javascript:` anywhere. External fonts and images are impossible by design: the CSP would block them anyway.
- The module compiles a revision's CSS into one file inside `@layer canccu-theme`, after the platform's `@layer canccu-base`. The few rules that keep people safe (a device's pairing code, the offline marker, the privacy link on public pages) are `!important` in `canccu-base`, which no later layer can override.

## Layouts as data
A layout places widgets on a screen: a grid, regions on it, widgets in each region ([theme.schema.json](theme.schema.json) `layout`).

- `aspect` (e.g. `16:9`, `9:16`) is the shape it is made for; the screen scales it to the display and letterboxes a different shape. Which zone shows which layout is Screen's ([0013](../docs/decisions/0013-multi-tenant-core.md) item 34; the screen contract).
- `grid` has 1–48 `columns` and `rows`; each region's `area` (1-based `column`, `row`, `columns`, `rows`) must fit (`area_outside_grid`). Regions may overlap; `layer` (0–9) orders them.
- A region with two or more widgets rotates them, each for `rotate_seconds` (5–3600, default 15).
- `header` (optional, `separate` or `shared`, default `separate`): how the layout's header regions show two or more widgets by default, each in a place of its own or rotating. Screen defines it and a zone may set its own ([screen.md](screen.md#header-and-hub-qr)).
- A widget entry names its `widget` type, optionally a `template` (one made for that type), and `props` (options the type documents; scalars only). This contract defines two types: `logo` (the theme's logo) and `embed` (see Embeds). The module that provides a widget names its type, options and template fields in its own contract (the screen contract for the screen's widgets). A type no module offers is a warning, not an error, so a theme survives a widget that comes later.
- Layouts carry no data and no logic: what a widget shows comes from its module at run time.

## Widget templates
Per-event markup for a widget, in a logic-less language: a strict subset of [Mustache](https://mustache.github.io/mustache.5.html) inside an HTML subset.

- **Tags allowed:** `{{name}}` and `{{a.b}}` (inserted escaped), `{{#name}}…{{/name}}` (a list repeats, a true value shows), `{{^name}}…{{/name}}` (shown when empty or false), `{{! comment }}`. **Not allowed:** unescaped output (`{{{ }}}`, `{{& }}`), partials, lambdas, changing delimiters. Sections nest at most 8 deep.
- **Elements allowed:** `div`, `span`, `p`, `h1`–`h4`, `ul`, `ol`, `li`, `strong`, `em`, `b`, `i`, `small`, `br`, `img`, `figure`, `figcaption`, `time`, `table`, `thead`, `tbody`, `tr`, `th`, `td`. **Attributes allowed:** `class` (stable classes and `t-` classes; a value from data may only add `[a-z0-9-]` characters to a class name), `alt`, `aria-label`, `aria-hidden`, `datetime`, `colspan`, `rowspan`, and `src` on `img` (a package image, `images/…`, or a field the widget documents as an image address). No `id`, `style`, `href`, event handlers or other attributes; anything else is an error `template_forbidden`.
- A template is parsed into a tree at upload and rendered from that tree with escaping; template text and data are never joined as a string and parsed as HTML.
- A template reads only the fields its widget type documents; an unknown field renders empty. The fields are data meant for the surface the widget is on, never secrets or personal data the surface would not show anyway.

### The parsed tree
Theming serves each template parsed, as `ParsedTemplate` (`name`, `widget`, `tree`) in the current theme and in a revision ([theming.openapi.yaml](theming.openapi.yaml)), and Screen passes it on unchanged in `ScreenState.theme.templates` ([screen.md](screen.md#composed-state-and-the-push-channel)). The player's own default template for each widget is the same tree, so a theme's template replaces a default one for one. No surface parses template text.

`tree` is a list of nodes, each one of:

| Node | From | Renders |
|---|---|---|
| `{"text": "…"}` | Template text between tags | The text, as text |
| `{"field": "a.b"}` | `{{a.b}}` | The field's value as text: a string, or a number in its JSON form; anything else (`true`, `false`, `null`, an object, a list, a missing field) is empty |
| `{"section": "a.b", "inverted": false, "children": […]}` | `{{#a.b}}…{{/a.b}}`; `inverted: true` for `{{^a.b}}…{{/a.b}}` | A list that is not empty: `children` once per item, with the item as the innermost context. An object: `children` once, with it as the innermost context. `true`, or a string or number that is not empty: `children` once. Anything else (`false`, `null`, `""`, an empty list, a missing field): nothing. `inverted: true` shows `children` once exactly when the plain section would show nothing |
| `{"element": "div", "attrs": {…}, "children": […]}` | An element of the allowed list (Widget templates) | The element, with `children` inside it; `br` and `img` have no `children` |

- **Names** are the tags' names: lowercase `snake_case` segments joined by `.`. A name is looked up in the innermost section's item first, then outwards to the widget's view-model, as Mustache does; the first segment found decides, and the rest is read from it.
- **Attributes:** `attrs` maps each allowed attribute (Widget templates) to its value as a list of `text`, `field` and `section` nodes, never `element`, joined into one string. Inside `class` a field's value keeps only the characters `[a-z0-9-]`, so data can lengthen a class name (`t-state-` and `live`) but never add a class of its own; the literal class names are checked at upload (stable or `t-`). `src` on `img` is a package image's served address (rewritten on publish, as CSS `url()` is) or a field the widget documents as an image address.
- **Limits** are those of the template: sections nest at most 8 deep; comments (`{{! … }}`) are dropped when it is parsed.
- **Rendering** builds the elements and text nodes from the tree (`createElement`, `textContent`, and only the allowed attributes), never an HTML string, so data can never become markup. A renderer skips a node or an attribute it does not know, so an older player draws a newer theme's tree without the new parts; the tree only grows, as the contract does.

## Embeds: custom HTML and JS
The only way an event runs its own JavaScript, for visuals no widget offers.

- An embed is a folder `embeds/<name>/` with an HTML `entry` and its `files`, placed with the `embed` widget. It is served only from the **sandbox** (the same-host sandbox path, or the sandbox origin when that hardening is set) and shown only in a frame `<iframe class="canccu-embed" sandbox="allow-scripts" allow="" referrerpolicy="no-referrer" src="…">`: no `allow-same-origin`, forms, popups, top navigation, downloads, camera, microphone or other permissions.
- **No data in, no messages out:** an embed gets nothing from the page and the page reads no messages from it (the old screen-embed message protocol stays dropped, [0010](../docs/decisions/0010-scope.md)). Its CSP lets it load only its own files and connect nowhere, so it can neither leak what is on the screen nor phone home.
- Adding or changing an embed needs right `theming.embeds.write`, and every change is audited.
- Embeds only render on the screen. Every stack serves them from the same-host sandbox unless the separate sandbox origin is set (see The sandbox).

## Upload safety
### Where files are served
| What | Served from | Path | Headers besides the CSP |
|---|---|---|---|
| Revision files: compiled CSS, fonts, images | The event's own hostname | `/theming/a/<sha256>.<ext>`, immutable | `Cache-Control: public, max-age=31536000, immutable` |
| The current logo | The event's own hostname | `/theming/logo`: a `302` to the current logo's revision file, or the event's initials as SVG (see Reading the current theme) | `Cache-Control: no-cache` |
| Draft files | The event's own hostname, to a session with `theming.theme.write` only | `/theming/draft/<sha256>.<ext>` | `Cache-Control: no-store` |
| Draft files for a preview on a screen | The event's own hostname, to whoever holds a live preview key (Draft, preview, publish) | `/theming/preview/<preview_key>/tokens.css`, `…/theme.css`, `…/<sha256>.<ext>` | `Cache-Control: no-store` |
| The current tokens, for pages | The event's own hostname, public | `/theming/current/tokens.css`, `/theming/current/admin-tokens.css` | `Cache-Control: no-cache`, `ETag` |
| Embeds | The sandbox only: the event's own hostname under `/theming/sandbox/` (default), or the sandbox origin | Same host: `/theming/sandbox/<revision>/<embed>/…` or `/theming/sandbox/draft/<draft key>/<embed>/…`; on the sandbox origin the same without `/theming/sandbox` | `Cache-Control` as above, and the sandbox CSP (see The sandbox) |

- Every response has `X-Content-Type-Options: nosniff` and a `Content-Type` the module sets from the checked content type. On the event's hostname it also has `Cross-Origin-Resource-Policy: same-origin`. Embed files (under `/theming/sandbox/` or on the sandbox origin) have `Cross-Origin-Resource-Policy: cross-origin` and `Access-Control-Allow-Origin: *` instead, without credentials: a sandboxed embed has an opaque origin, so its requests for its own files are cross-origin, and these files are public anyway.
- The event's hostname serves an event's HTML and JS only under `/theming/sandbox/`, always with the sandbox CSP; every other path above answers only CSS, WOFF2, PNG, JPEG, WebP and SVG.
- Screens cache revision files (immutable addresses), so a published theme keeps working when the uplink drops ([0013](../docs/decisions/0013-multi-tenant-core.md) item 25).

### SVG
- Checked at upload; an error `svg_forbidden` on: a DOCTYPE or entity; `script`, `foreignObject`, `iframe`, `embed`, `object`, `audio`, `video`, `animate`/`set` on `href`; any `on*` attribute; an `href` or `xlink:href` other than a local `#id`; `url()` or `@import` naming anything outside the file; a `data:` URL.
- Served with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and `Content-Disposition: attachment`, so even opened on its own it runs nothing; pages use SVG only through `<img>` and CSS, where scripts never run.

### Raster images and fonts
- PNG, JPEG and WebP (animated WebP too) are decoded and stored re-encoded, which drops metadata such as camera and GPS data; a file that does not decode, or decodes larger than 40 megapixels, is refused.
- WOFF2 is checked by its header and size; the browser's font sanitiser does the rest.

### The CSP of event pages
Every HTML response on an event's hostname carries this policy, set by the kit (`'self'` is the event's own hostname, so an event's look loads only from there):

```
default-src 'none'; script-src 'self'; style-src 'self' 'nonce-<per response>';
img-src 'self' data:; font-src 'self'; media-src 'self'; connect-src 'self';
manifest-src 'self'; worker-src 'self'; frame-src <the sandbox>;
object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'self'
```

- `<the sandbox>` is `https://<the event's hostname>/theming/sandbox/` (a source with a path, so a frame may load and navigate to sandbox paths only, never to other pages), or the sandbox origin when that hardening is set.
- No inline script and no `style` attributes; a platform-generated `<style>` block carries the response's nonce. Event CSS is always a file.
- **Precondition:** a module turns this policy on only once its pages comply. Today `page()` of packages/ui writes its theme `<style>` without a nonce, so packages/ui adds the nonce (or links `tokens_css_url`) first.
- `frame-src` is widened in exactly two cases, and no surface widens any other directive: admin pages add `'self'`, for the virtual-screen preview of surface pages on the event's own hostname; and the screen contract may add the event's own web-asset allow-list, for screen pages only.
- On admin and sign-in pages `frame-ancestors 'none'` replaces `'self'`, so they cannot be framed at all. Admin pages therefore send `frame-src 'self' <the sandbox>`; what they frame are surface pages, which keep `frame-ancestors 'self'` and serve no event JS.

### The sandbox
An event's custom HTML and JS never run with the event's origin. The browser gives every sandbox document an **opaque origin**: it holds no cookies, reads no storage of the event's hostname, and every request it makes is cross-site.

**The same-host sandbox (the default).** No second domain is needed.
- Embeds are served on the event's own hostname under the fixed path `/theming/sandbox/` (Where files are served), and framed only as `<iframe class="canccu-embed" sandbox="allow-scripts" …>` (Embeds). The `sandbox` attribute never has `allow-same-origin`.
- Every response under `/theming/sandbox/` carries `Content-Security-Policy: default-src 'none'; script-src <embed base>; style-src <embed base> 'unsafe-inline'; img-src <embed base> data:; font-src <embed base>; media-src <embed base>; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors <the event's hostnames>; sandbox allow-scripts`, where `<embed base>` is the embed's own folder (`https://<the event's hostname>/theming/sandbox/<revision>/<embed>/`, or its draft path). The header's `sandbox` (never `allow-same-origin`) gives the document an opaque origin even when it is opened on its own or framed without the attribute; `connect-src 'none'` stops fetch, XHR, WebSocket and beacons; the sources with a path keep an embed to its own files.
- **Only the sandbox loads sandbox files.** The module serves an embed's entry only to a frame request (`Sec-Fetch-Dest: iframe` or `frame`), and its other files only to cross-site requests (`Sec-Fetch-Site: cross-site`, which is what an opaque origin's requests carry). A request without these Fetch Metadata headers is refused (404). So no page on the event's hostname, or on another event's hostname of the same site, can load an embed's JS as its own script or worker, although their CSP allows `'self'`.
- The sandbox path sets no cookies, reads no session and serves no API.
- **The platform API refuses `Origin: null`.** The kit answers every request to `/api/…` that carries `Origin: null` with 403 `origin_refused`, so a sandbox document that gets a request out despite `connect-src 'none'` still reaches nothing. Besides that, state-changing requests from any origin other than the event's hostname are refused by the kit's origin check, and the platform's APIs grant no CORS to anyone.

**A separate sandbox domain (optional hardening).** A stack that sets `CANCCU_SANDBOX_DOMAIN` serves embeds from `https://<tenant id>.<sandbox domain>` instead: a registrable domain of its own, never the platform domain, a subdomain of it or an event's hostname, so it is neither same-origin nor same-site with any page that holds a session. It keeps everything above (the same CSP, with `<embed base>` on that origin; the same Fetch Metadata rule), sets no cookies, has no sign-in and serves no API. `<the sandbox>` in the event pages' `frame-src` is then that origin. It is a defence against browser bugs, not a requirement.

**Session cookies are `__Host-` cookies.** Every session cookie of the platform is set with the `__Host-` prefix (`Secure`, `Path=/`, no `Domain`), so no other hostname, a subdomain or another event's hostname included, can set or overwrite it. This lands with the central sign-in host (#52): the session cookie becomes `__Host-canccu_session` ([admin.md](admin.md#session-and-rights)).

**Residual risks.** A bug in the browser's sandbox or CSP enforcement could give an embed the event's origin, so it could act on the event's hostname with whatever the viewing browser holds there (a screen's device credentials); the separate sandbox domain is the hardening against that, and only holders of `theming.embeds.write` (audited) can add an embed at all. Within the rules, an embed can still draw anything inside its frame, a fake sign-in form included; with no network, no forms, no messages to the page and no navigation outside the sandbox paths (the page's `frame-src`), what is typed into it goes nowhere, but a person may still be misled for as long as it is on the screen.

**The IP-mode demo stack** in CI serves the same-host sandbox like any stack. Over plain http browsers send Fetch Metadata only to localhost and refuse `__Host-` cookies, so there the module skips the Fetch Metadata rule and the cookie keeps the name `canccu_session`; it never runs with real events ([0013](../docs/decisions/0013-multi-tenant-core.md) item 2).

## Draft, preview, publish
- **One draft per event.** `POST /api/theming/draft` creates it from the current revision, an earlier revision or the defaults (409 `draft_exists`); a draft from the defaults is a valid simple-mode theme with a generated `brand` (the platform default `primary` and `accent`, `scheme: dark`), publishable as it is; `DELETE` discards it. Every change returns the draft with its `draft_version` (+1 per change) and its `problems`; writes take `draft_version` and answer 409 `version_conflict` when it is stale, so two admins never overwrite each other unseen.
- **Editing:** the brand (simple editor); the switch back to simple (`POST …/draft/mode`); tokens (`PATCH …/draft/tokens`); one file (`PUT`, `DELETE …/draft/file?path=`); one layout (`PUT`, `DELETE …/draft/layouts/{layout_id}`); or the whole package (`PUT …/draft/package`, a zip, replacing the draft's content).
- **Preview:** `GET /api/theming/draft/preview` answers like `GET /api/theming/current` but with the draft's addresses and `revision: null`, since a draft is no revision. A surface given `?canccu_theme=draft` renders with the draft when the request's session holds `theming.theme.write`, and ignores it otherwise; preview pages send `Cache-Control: no-store`. Draft embeds are served under an unguessable `draft key` that changes with every draft change and dies with the draft. No preview link works without a session.
- **On a screen:** `POST /api/theming/draft/preview-key` (`theming.theme.write`) answers `{"preview_key", "expires_at"}`: an unguessable key to the event's draft for a paired screen, which has no session. Screen's preview on a screen takes it ([screen.md](screen.md#zones-and-assignments), `theme_preview_key`). A key lives 12 hours at most and dies with the draft (discard or publish); a new key leaves older ones alive. It shows the draft as it is when read, so a screen follows the draft each time Screen reads it again. `GET /internal/theming/previews/{preview_key}?tenant_id=` (Screen only, with its service identity, as the current theme for the screens; 404 `not_found` for a key that is unknown, expired or whose draft is gone) answers like `GET /api/theming/draft/preview`, with `revision: null` and its addresses under `/theming/preview/<preview_key>/`: `tokens.css`, `theme.css` (the draft's CSS compiled as publish would compile it) and every draft file at `<sha256>.<ext>`, served as draft files are (Where files are served) to whoever holds the key, without a session. Draft embeds keep their `draft key` addresses.
- **Publish:** `POST /api/theming/draft/publish` with `draft_version`. A draft with an error is 422 `theme_invalid` with its problems. Otherwise it becomes the next revision, the draft is removed, and `theming.theme.published` goes out; surfaces switch by push, without a reload.
- **Rollback:** `POST /api/theming/revisions/{revision}/restore` with `current_revision` (409 `version_conflict` if another publish came first) publishes a copy of an earlier revision as the next one. History only grows; nothing is rewritten.
- **Kept:** the last 20 revisions, plus any revision a screen pins or a timed pin will restore ([0013](../docs/decisions/0013-multi-tenant-core.md) item 23, [screen.md](screen.md#offline-theming-and-the-pinned-bundle)), which theming learns from `screen.pin.changed` (`theme_revision` and `restores.theme_revision`); files no kept revision or draft uses are deleted.
- `GET /api/theming/revisions` lists the history (newest first, paged with `before`); `GET …/revisions/{revision}` returns one with its manifest.

## Git sync
A theme can come from the event's own git repo instead of uploads.

- `PUT /api/theming/sync` with `repo_url` (`https://` only), `ref` (branch or tag), `path` (the package folder, relative to the repo's root: never absolute, never `..`, no segment starting with `-` or `.`) and optionally `credential` (a read-only access token: write-only, stored encrypted, never returned, [0013](../docs/decisions/0013-multi-tenant-core.md) item 29). `GET` shows the settings with `credential_set` only; `DELETE` removes them. **The credential is bound to the host of `repo_url`:** changing `repo_url` to another host while a credential is stored is 400 `credential_required` unless `credential` is given again (or `null`).
- `POST /api/theming/sync/run` fetches the folder into the draft, through the same checks as an upload, and answers with the draft (creating it when there is none; 409 `version_conflict` with `draft_version` stale). It never publishes.
- **Fetching is guarded:** port 443 only; the host must resolve only to public addresses (no loopback, private, link-local, CGNAT or the VM's own), checked again on each redirect and connection; at most 3 redirects, 60 seconds and the package limits. A failure is 502 `sync_failed` with a reason for people. The credential is sent only to the configured host: a redirect to another host is followed without it. After the fetch, `path` is resolved with symlinks followed and must stay inside the checkout; a link out of it is `sync_failed`.

## Reuse: series and export
- **Clone with an event** ([tenants.md](tenants.md#series-and-clone)): `POST /api/theming/clone` with `source_tenant_id`, by a user holding the event-admin role on both events of one series (otherwise 403 `missing_right`). The source's current revision, its files copied into the new event's files, becomes the new event's next revision (`cloned_from`), so the new event looks right at once; an existing draft is untouched. The source is read in its own tenant context. Emits `theming.theme.published`.
- **Export:** `GET /api/theming/revisions/{revision}/package` downloads the revision as a package zip: the format of an upload, so it goes into another event or the event's repo.

## The phone hub
- The hub uses the same tokens, fonts, logo, CSS and templates as the screen (What applies where). Its web app manifest takes `theme_color` from `surface` and `background_color` from `background`; its icons (192 and 512 px, and a maskable 512 px on `background`) are made from `images.icon` or the logo.

## Reading the current theme
`GET /api/theming/current` → the current revision: `revision`, `published_at`, `tokens` (complete, defaults filled in), `tokens_css_url` (a `:root` block of the tokens and the `@font-face` rules), `admin_tokens_css_url` (the same, with the platform default colours when the theme fails the contrast rules: for admin, sign-in, superadmin and privacy pages), `css_url` (the compiled CSS: only for the surfaces that take CSS), `logo_url`, `logo_png_url` (a PNG rendition, 512 px wide, for Discord and other places that take no SVG), `icon_urls`, `embed_color` (integer), `layouts`, `templates` (name, widget type and the parsed template), `embeds` (name and frame address) and `theming_version`. Readable by whoever the event's info-page mode lets in ([tenants.md](tenants.md#info-page-mode)) and by the event's paired screens. Without a published theme it answers the platform defaults with the profile's `theme` applied, and `revision: 0`.

**The logo, for every organiser page:** `GET /theming/logo` names the event's current logo at one address, so the organiser shell's header and the sign-in and check-in posters (packages/ui) show it without reading the theme. With a logo (`logo_url` above, at revision 0 the profile's main logo) it answers `302` to that `/theming/a/` address; without one it answers the event's initials (the first letter of each of the first two words of its name, `?` without a name) as a square SVG in the theme's primary and accent colours, as the shell's avatar draws them. Theming reads the name from `GET /api/tenants/current` ([tenants.md](tenants.md#tenants)); a tenants module that does not answer gives `?`. Public in `live` and `archived`, like the revision files, since the posters show the name and logo to guests in every info-page mode; `Cache-Control: no-cache`, so a newly published logo shows on the next page. A hostname that is no event is 404 `not_found`.

**The logo while the event is `draft`:** guests see no event ([tenants.md](tenants.md#lifecycle)): theming reads `GET /api/tenants/current` with the request's own `Cookie` header, so tenants alone decides who sees the event. An answer with the event's name (a session of the event's member, event admin or a superadmin in a support window) gets the logo or initials as above. Any other answer (a `DraftTenant`, an error, no answer) gets the `?` SVG in the platform default colours, never the `302`, so an event is prepared out of sight.

**The current tokens, for pages:** `GET /theming/current/tokens.css` and `GET /theming/current/admin-tokens.css` answer the bodies `tokens_css_url` and `admin_tokens_css_url` name for the current theme (revision 0's too), as `text/css` with `Cache-Control: no-cache` and an `ETag`, so a page takes its event's look with one `<link>` after `ui.css`, never reads `GET /api/theming/current` to build it, and the next page load after a publish has the new look. Public in every info-page mode, as the files they name are: the sign-in page needs them before anyone signs in. Admin, sign-in and privacy pages link `admin-tokens.css` (What applies where); the phone hub and the public info pages, check-in among them, link `tokens.css`. A hostname with no event (the superadmin's) answers 404, and its pages keep `ui.css`'s defaults.

**The current theme, for the screens:** `GET /internal/theming/current?tenant_id=` → the same answer as `GET /api/theming/current` gives a guest whom the info-page mode lets in (the current revision, or the defaults with `revision: 0`). It ignores the info-page mode, so an event in mode `venue_only` or `sign_in` keeps its own look on its own screens: Screen's server reads it for the event's screens, whose container is no venue address and has no session ([screen.md](screen.md#widgets)). Every status of the event; an unknown event is 404 `not_found`. Only Screen may call it, with its service identity; any other module is 403 `service_forbidden`. Internal network only ([README.md](README.md#conventions)).

**A pinned revision, for a module:** `GET /internal/theming/revisions/{revision}?tenant_id=` answers the same shape for one kept revision of that tenant (404 `not_found` for one that is not kept). The screen module's server reads it to draw a screen pinned to that revision (`ScreenState.theme`, [screen.md](screen.md#offline-theming-and-the-pinned-bundle)). Internal network only ([README.md](README.md#conventions)).

## Rights
`theming.theme.write` (draft, preview, publish, restore, history, export), `theming.embeds.write` (add, change or remove an embed, also through a package upload, a sync or a restore that changes embeds), `theming.sync.write` (git sync settings and credential). Event admins hold all three through their role. Cloning needs the event-admin role itself.

## Audit
Through `POST /internal/tenants/audit` in the same request ([tenants.md](tenants.md#audit-log)): publish, restore and clone (with the revision numbers), every embed change, and git sync settings and credential changes (which, never the value).

## Events (version 1)
Envelope, naming and transport: [admin.md](admin.md#events). Listed in the catalog: [events.md](events.md).

| Type | When | Audience | `data` |
|---|---|---|---|
| `theming.theme.published` | A revision became current: publish, restore or clone | event-wide, `public` | `revision`, `restored_from` (or `null`), `cloned_from` (`tenant_id` and `revision`, or `null`), `changed` (any of `tokens`, `css`, `fonts`, `images`, `layouts`, `templates`, `embeds`), `tokens_css_url`, `css_url`, `embed_color`, `actor_user_id` |

Consumers read the rest through `GET /api/theming/current` (Screen's server through `GET /internal/theming/current`).

## The test
- **Screenshots:** CI's demo-stack job ([docs/ci.md](../docs/ci.md)) publishes each package in [events/demo/themes/](../events/demo/themes/) on the demo tenant and screenshots, per theme, each of its layouts on the screen, the hub home, a public info page and an admin page, named `theming-<theme>-<surface>[-<layout>].png`. These screenshots are the theming contract's test: a change to the stable classes, the tokens, `ui.css` or a module's markup shows in the PR's screenshots (the `demo-screenshots` artifact), where the reviewer sees it. Each surface's module adds its screenshots when it is built.
- **Per widget:** on the screen, each widget a demo theme's layouts place is also screenshot on its own, in each layout it appears in, landscape (16:9) and portrait (9:16), named `theming-<theme>-screen-<layout>-<widget type>.png` (`theming-level-up-screen-portrait-countdown.png`); a region that rotates is shot once per widget. Embeds are shot with `prefers-reduced-motion: reduce`, so every run shows the same picture: the platform enforces reduced motion by hiding the embed's frame (a rule of `@layer canccu-base` that no theme can undo, since an embed cannot be trusted to honour the setting), so the shot shows the platform's still behind the frame (the theme's logo on its background), not a still frame of the embed's own. The `level-up` demo theme places every widget the screen offers in both a landscape and a portrait layout for this.
- **Static:** `scripts/check-contracts` validates every demo `theme.yaml` against [theme.schema.json](theme.schema.json), then `scripts/check-theme-refs` checks what the schema cannot: the files it names exist, ids are unique, areas fit their grid, references resolve (templates, embeds, and `images.logo` for a `logo` widget), each embed's files sit in its own `embeds/<name>/`, font tokens name package fonts or generic families, and the mode matches the content.
- **Contract API tests** (once the module exists) cover the problem codes, the headers and CSP of every path above, the draft and preview rights, and cross-tenant leaks of drafts, files and revisions ([0013](../docs/decisions/0013-multi-tenant-core.md) item 8).

## Not in this contract
The screen module: its widgets and their fields, zones and which layout a zone shows, pinned bundles, and the web-asset allow-list (the screen contract). The admin pages of the brand kit (the admin module). Language packs.
