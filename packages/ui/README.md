# @canccu/ui

The shared look for platform pages. It has three parts:

- **`ui.css`**: one stylesheet. It declares every theme token as a CSS custom property with its default, plus the component classes.
- **Theme helpers:** they read the event profile's `theme` and `logos` ([contracts/profile.md](../../contracts/profile.md)).
- **Six components:** button, form field, card, page layout, health badge and the `embed` widget. Each is a function that returns escaped HTML, rendered on the server.
- **`embedWidget({ frameUrl, logoUrl })`** ([contracts/theming.md](../../contracts/theming.md#embeds-custom-html-and-js)): an embed's `frame_url` from the current theme in `<iframe class="canccu-embed" sandbox="allow-scripts" allow="" referrerpolicy="no-referrer">`, over a still (the logo on the theme background). It frames only same-host sandbox paths (`/theming/sandbox/…`). The frame is transparent until the embed paints, so a frame that fails, a sandbox refusal or a script that dies before it draws leaves the still showing; under `prefers-reduced-motion: reduce` `ui.css` hides the frame (`!important` in the base layer, so no theme CSS brings it back).

- **The safety elements** (`SAFETY_CLASSES`, [contracts/theming.md](../../contracts/theming.md#advanced-mode)): `canccu-pairing-code` (a device's pairing code, centred), `canccu-offline-marker` (top right) and `canccu-privacy-link` (bottom right, on public pages). `ui.css` draws them in `canccu-base` with every declaration `!important`, starting with `all: initial`, in fixed colours and fonts, so no theme layer can hide, move, cover or restyle them. That holds only for an element that is a direct child of `<body class="canccu-page">`, after its other children, holding text only: `ui.css` also guards the root and the page (no `display: none`, opacity, filter, transform, zoom, clipping or containment on them, no `:root::before`/`::after`, the page's pseudo-elements at `z-index: auto`), but no other ancestor. These classes are not stable classes for themes: a theme that styles them gets `class_unstable`, and its rules lose. `modules/theming/test/safety.browser.test.ts` proves it in Chromium with theming's own compile.

There's no framework and no client JS.

The classes and custom properties listed in the [theming contract](../../contracts/theming.md#stable-classes-and-custom-properties) are stable: event themes rely on them. Renaming or removing one is a breaking contract change.

## Install (from a module)

```json
{ "dependencies": { "@canccu/ui": "file:../../packages/ui" } }
```

`npm install` builds the package (`prepare`). It needs Node 22.13+ and is ESM only.

## Tokens

A profile sets tokens by name under `theme.colors` (`#rrggbb` or `#rrggbbaa`) and `theme.fonts` (a family name). Everything it leaves out keeps the default. Unknown keys are ignored. A bad value falls back to the default: a colour that doesn't match the pattern, or a font outside `[A-Za-z0-9 _-]`. A token named `text_muted` becomes the CSS variable `--canccu-color-text-muted`.

| `theme.colors`    | Default   | Used for                                   |
| ----------------- | --------- | ------------------------------------------ |
| `background`      | `#0f172a` | Page background                            |
| `surface`         | `#1e293b` | Cards, header                              |
| `border`          | `#334155` | Card and input borders                     |
| `text`            | `#f8fafc` | Body text                                  |
| `text_muted`      | `#94a3b8` | Hints                                      |
| `primary`         | `#3b82f6` | Primary button, links, focus ring          |
| `primary_text`    | `#0f172a` | Text on primary and danger buttons         |
| `accent`          | `#f59e0b` | Highlights                                 |
| `status_ok`       | `#22c55e` | Health `ok`                                |
| `status_degraded` | `#eab308` | Health `degraded`                          |
| `status_down`     | `#ef4444` | Health `down`, field errors, danger button |

| `theme.fonts` | Default        | Used for                                        |
| ------------- | -------------- | ----------------------------------------------- |
| `body`        | `system-ui`    | Body text, inputs                               |
| `heading`     | `system-ui`    | Headings, header                                |
| `display`     | `system-ui`    | Big screen text (follows `heading` in `ui.css`) |
| `mono`        | `ui-monospace` | `code`                                          |

| `theme.sizes`  | Default  | Custom property         | Used for                  |
| -------------- | -------- | ----------------------- | ------------------------- |
| `radius`       | `0.5rem` | `--canccu-radius`       | Corner radius             |
| `border_width` | `1px`    | `--canccu-border-width` | Card, input, header lines |
| `gap`          | `1rem`   | `--canccu-gap`          | Page grid gap             |
| `safe_inset`   | `48px`   | `--canccu-safe-inset`   | Screen edge margin        |

Sizes are lengths like `0`, `1px`, `0.5rem` (the `$defs.length` pattern of `contracts/theme.schema.json`); other values are dropped. `ui.css` wraps everything in `@layer canccu-base`. `page()` takes `surface` (`screen`, `hub`, `info`, `admin`; default `admin`) and an optional CSP `nonce`; `themeStyle(profile, nonce)` returns the theme `<style>` element.

## Usage (TypeScript, Fastify)

```ts
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { button, card, field, healthBadge, html, logoPath, page } from "@canccu/ui";

// Serve ui.css from this module's own image; no module hosts it for another.
const css = readFileSync(createRequire(import.meta.url).resolve("@canccu/ui/ui.css"), "utf8");
app.get("/ui/ui.css", (_req, reply) => reply.type("text/css").send(css));

app.get("/", (_req, reply) => {
  const logo = logoPath(profile); // "assets/logo.svg": relative to the event folder
  const body = card({
    title: "Settings",
    body: html`<form method="post">
      ${field({ name: "title", label: "Title", value: "Demo", hint: "Shown on screens" })}
      ${button({ label: "Save" })}
    </form> ${healthBadge("ok")}`,
  });
  reply.type("text/html").send(
    String(page({ title: "Admin", body, profile, logoUrl: logo && `/files/${logo}` })),
  );
});
```

- Text passed to `html` slots and component options is always escaped.
- Components return `Html`, and `Html` nested in a slot is inserted as is.
- `raw()` marks trusted markup. Never pass user or profile text to it.

## Markup (any language)

A Python module with pages copies `ui.css` into its image, links it and writes the same markup. To apply the profile theme, it emits a `<style>:root { --canccu-color-primary: …; }</style>` block, holding only values that match the rules above.

```html
<body class="canccu-page">
  <header class="canccu-header"><img class="canccu-header__logo" src="…" alt=""><span class="canccu-header__title">Admin</span></header>
  <main class="canccu-main">
    <section class="canccu-card"><h2 class="canccu-card__title">Health</h2><span class="canccu-badge canccu-badge--ok">ok</span></section>
    <div class="canccu-field"><label class="canccu-field__label" for="f">Title</label><input class="canccu-input" id="f" name="title"><p class="canccu-field__hint">…</p></div>
    <button class="canccu-button canccu-button--primary">Save</button>  <!-- --secondary, --danger -->
  </main>
</body>
```

## Check

```sh
npm ci && npm run lint && npm run typecheck && npm test
```

The tests cover:

- the default tokens validate against `contracts/profile.schema.json`;
- the demo profile uses only known tokens;
- `ui.css` matches the TS defaults;
- the theme rules;
- escaping;
- an HTML snapshot of every component.

Update snapshots on purpose with `npx vitest run -u`.
