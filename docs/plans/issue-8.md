# Plan: issue #8 — ui: theme tokens and base components

Branch `8-theme-tokens-components`. Parent epic #15 (after #7, before #9). The sources of truth are `contracts/profile.md` and `contracts/profile.schema.json` as merged in #24. The schema says `theme` has `colors` and `fonts` maps keyed by `^[a-z][a-z0-9_]{0,63}$`, and that token names follow packages/ui. This plan makes no contract changes.

## Shape: plain CSS plus HTML-string helpers
- **`ui.css`** is a single stylesheet. It declares every token as a CSS custom property on `:root`, with its default value, and has the classes for the five components. A page that only links `ui.css` already looks right on the defaults.
- **TS helpers** (`@cp/ui`):
  - `resolveTheme(profile)` merges the profile's `theme` over the defaults.
  - `themeCss(profile)` returns a `:root { … }` block with the overrides only.
  - `logoPath(profile)` reads `logos.main`.
  - Five components are functions that return escaped HTML strings.
- **Python modules with pages** link the same `ui.css` and write the same class names, as documented in the README. They don't need any TS. A Python `themeCss` helper is out of scope.

## Decisions
| # | Decision | Reason |
|---|---|---|
| D1 | No UI framework: plain CSS custom properties, plus TS functions that return HTML strings rendered on the server | It's the smallest thing that works for TS and Python modules alike. There's no client bundle or build chain, and a framework can still come later behind the same class names |
| D2 | Package `@cp/ui` in `packages/ui`, not published; modules depend on it by path (`"@cp/ui": "file:../../packages/ui"`) | Same as kit (#7 D2): it ships with the git tag |
| D3 | Node 22, ESM only, npm, its own `package-lock.json`; `tsc` builds to `dist/`; `exports`: `.` → `dist/index.js`, `./ui.css` → `ui.css` | Matches kit-ts. The CSS is a source file that ships as is, so there's no CSS build step |
| D4 | Each module serves `ui.css` from its own image (for example at `/ui/ui.css`). Fastify modules use `@fastify/static` or read the file once at start; Python modules copy it into the image at build time | Containers keep no state, and modules don't depend on each other at runtime. Admin doesn't host CSS for other modules |
| D5 | No client JS. Forms are plain `<form method="post">` | Admin pages #10 and #11 are forms and lists; interactivity can be added per page later |
| D6 | Token names are `snake_case`, the same as the profile keys. The CSS variable is `--cp-color-<name>` / `--cp-font-<name>`, with `_` → `-` | One name in the profile, TS and CSS, with a mechanical mapping between them |
| D7 | The token set is small and fixed (see Tokens). Unknown profile keys are ignored, and a known key with a bad value falls back to its default | The contract lets profiles carry any key; the UI uses only the keys it knows |
| D8 | Font values are only accepted if they match `^[A-Za-z0-9 _-]{1,64}$` and are emitted quoted, followed by the default stack as fallback. Colours are only accepted if they match the schema pattern | `themeCss` writes profile text into CSS, so this stops CSS or HTML injection even when a profile skipped validation |
| D9 | `radius` (`--cp-radius`, `0.5rem`) is a default in `ui.css` only and can't be set from the profile | As stated in the issue's Out of scope; a later additive contract PR can add `theme.radii` |
| D10 | Logo: `logoPath(profile)` returns `profile.logos?.main`. `page({logoUrl})` takes a URL that the module resolves | The asset path is relative to the event folder; serving files is the module's job, not the UI's |
| D11 | Every component escapes text and attribute values through one `escapeHtml`. Children passed in as `Html` (a branded string returned by components and `html\`\``) are not escaped again | It's safe by default, and components can still nest |
| D12 | Tests: `vitest` 5.1.0 with file snapshots for each component's HTML | The same runner as kit-ts; snapshots make markup changes visible in review |
| D13 | Schema check in tests: `ajv` 8.20.0 + `ajv-formats` 3.0.1 (`Ajv2020`, `strict: true`) validates a profile that uses every default token against `contracts/profile.schema.json` | These are the same validator versions `scripts/check-contracts` runs (ajv-cli 5.0.0 uses ajv 8). It proves the token names and default values are legal profile content |
| D14 | Lint: `eslint` 10.14.0 + `typescript-eslint` 8.72.1 + `@eslint/js` 10.0.1, `prettier` 3.9.10; `typescript` 6.0.3; `@types/node` 22.20.5; `yaml` 2.9.1 (dev, reads the demo profile) | These are kit-ts's exact pins, so the repo has one toolchain |
| D15 | Exact versions only, with no `^` or `~` | "Pin versions" (#7 D23) |
| D16 | CI: add a job `lint-types-test (ui)` to `.github/workflows/ci.yml`, a copy of the kit-ts job with `working-directory: packages/ui` | The acceptance criterion says the tests run in CI; it adds a new required-check name and renames nothing |

## Tokens (defaults)
These are dark defaults that match `events/demo/profile.yaml`, which already uses `primary`, `background`, `text` and `body`.

| `theme.colors` | Default | Used for |
|---|---|---|
| `background` | `#0f172a` | Page background |
| `surface` | `#1e293b` | Cards, inputs |
| `border` | `#334155` | Card and input borders |
| `text` | `#f8fafc` | Body text |
| `text_muted` | `#94a3b8` | Labels, hints |
| `primary` | `#3b82f6` | Primary button, links, focus ring |
| `primary_text` | `#ffffff` | Text on primary |
| `accent` | `#f59e0b` | Highlights |
| `status_ok` | `#22c55e` | Health `ok` |
| `status_degraded` | `#eab308` | Health `degraded` |
| `status_down` | `#ef4444` | Health `down`, field errors, danger button |

| `theme.fonts` | Default | Used for |
|---|---|---|
| `body` | `system-ui` | Body text, inputs |
| `heading` | `system-ui` | Headings |
| `mono` | `ui-monospace` | Code, ids |

Non-profile default: `--cp-radius: 0.5rem`.

## Components (`src/components.ts`, classes in `ui.css`)
1. **`button({label, type?, variant?, name?, value?, disabled?})`** renders `<button class="cp-button cp-button--primary|secondary|danger">`. `type` defaults to `submit`.
2. **`field({name, label, type?, value?, hint?, error?, required?, options?})`** renders a `<label>` plus an `<input>`, `<select>` (when `options` is given) or a checkbox. It has `aria-describedby` for the hint or error, and `aria-invalid` when there's an error. The types are `text|number|password|checkbox|select`, which covers the settings value types in `contracts/admin.md`.
3. **`card({title?, body})`** renders `<section class="cp-card">` with an optional `<h2>`.
4. **`page({title, body, profile?, logoUrl?, cssHref?})`** renders a full `<!doctype html>` document. It has `lang="en"`, the `ui.css` link (default `/ui/ui.css`), the `themeCss(profile)` block, a header with the logo when `logoUrl` is set, and `<main>`.
5. **`healthBadge(status)`** takes `ok|degraded|down` and renders `<span class="cp-badge cp-badge--<status>">`. The text is the status word, so the badge doesn't depend on colour alone.

## Files
| File | New/changed | Purpose |
|---|---|---|
| `packages/ui/package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`, `eslint.config.js`, `.prettierrc`, `vitest.config.ts` | new | The package, its pins, and the scripts `build`, `lint`, `typecheck`, `test`, `prepare` |
| `packages/ui/ui.css` | new | `:root` defaults for every token, plus component classes |
| `packages/ui/src/tokens.ts` | new | `COLOR_TOKENS`, `FONT_TOKENS` with defaults, `cssVar(name)` |
| `packages/ui/src/theme.ts` | new | `resolveTheme`, `themeCss`, `logoPath` |
| `packages/ui/src/html.ts` | new | `Html` type, `html` tag, `escapeHtml` |
| `packages/ui/src/components.ts`, `src/index.ts` | new | The five components; the public exports |
| `packages/ui/test/*.test.ts`, `test/__snapshots__/` | new | Tests below |
| `packages/ui/README.md` | new | Token table, a usage example for TS (Fastify), markup for Python modules, how to serve `ui.css`, the check command |
| `.github/workflows/ci.yml` | changed | The `lint-types-test (ui)` job (D16) |

## Tests
- **Schema:** a profile `{schema_version: 1, name, modules: ["admin"], theme: {colors: <all defaults>, fonts: <all defaults>}}` validates against `contracts/profile.schema.json`, which the test reads from disk. Every token name matches `$defs.key`.
- **Demo profile:** every key under `theme` in `events/demo/profile.yaml` is a known token, so the demo uses real names.
- **CSS defaults stay in sync:** parse the `:root` block of `ui.css` and check that it declares exactly one variable per token, equal to its TS default, plus `--cp-radius`.
- **resolveTheme / themeCss:**
  - No `theme` gives the defaults and an empty override block.
  - A partial `theme` overrides only those tokens.
  - An unknown key is ignored.
  - A bad colour, or a font with `;`, `}` or `<`, falls back to the default and is never emitted.
- **logoPath:** returns `logos.main` when it's set, and `undefined` when it's missing.
- **Components:**
  - There's a snapshot of each component and each variant: three button variants, the field types with and without an error, a card with and without a title, a page with and without a logo, and the three badges.
  - `<script>` in any text or attribute comes out escaped.
  - Nested `Html` isn't double-escaped.

## Steps
1. Scaffold: package files with pins, lockfile, an empty `src/index.ts`; `npm run lint`, `typecheck` and `test` all pass.
2. `tokens.ts` and `ui.css` `:root` block, with the schema, demo-profile and CSS-sync tests.
3. `theme.ts` and its tests.
4. `html.ts`, the components and the `ui.css` component classes, with snapshot tests.
5. README; the CI job; run the checks locally, then `finish`.

## Verification
- `cd packages/ui && npm ci && npm run lint && npm run typecheck && npm test`
- `scripts/check-contracts` is still green (the demo profile is unchanged).
- The CI job `lint-types-test (ui)` is green on the PR.

## Open point for the maintainer
The criterion "Used by the admin pages (#10, #11)" can't be met inside this PR, because `modules/admin` is still empty and #10 is `blocked`. In this PR, #8 delivers an API shaped for those pages, plus the README example. Two options:
- Reword the criterion to "ready for the admin pages (#10, #11)".
- Leave it as it is and tick it when #10 and #11 merge, with #8 closed by hand.

## Out of scope
- A UI framework and client JS.
- A Python `themeCss` helper.
- Profile-configurable radius (D9).
- Light/dark switching.
- Finnish and the full theme work (step 8).
- Any change to `contracts/` or `events/demo/`.
