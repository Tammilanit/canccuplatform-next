# CI

`.github/workflows/ci.yml` runs on every pull request and on push to main.

## Checks (names are stable; branch rules require them)
| Check | What it does |
|---|---|
| `lint-types-test (kit-ts)` | In `packages/kit-ts`: `npm run lint`, `npm run typecheck`, `npm test`. Passes with "empty package" while there is no `package.json`. |
| `lint-types-test (kit-py)` | In `packages/kit-py`: `ruff check .`, `mypy .`, `pytest`. Passes while there is no `pyproject.toml`; the package must offer a `dev` extra with these tools. |
| `no-event-names` | Fails if the lines a PR adds contain a forbidden term. |

Do not rename these jobs; renaming breaks the required checks.

## no-event-names
- `scripts/check-event-names [--dry-run] [BASE]` scans added lines of `BASE...HEAD`, case-insensitively.
- The term list (event name, venue, IPs, hostnames, Discord ids) is **not in the repo**. A maintainer stores it in the Actions secret `EVENT_NAME_TERMS`, one term per line or comma-separated.
- Exempt: `github.com` git remote URLs (https, ssh, `git@`) and `<org>/<repo>` slugs of this org. Nothing else: the bare org name in prose, or its domain in a hostname or URL, still fails when it is on the term list.
- The log shows only `file:line`, never the matched term.
- Locally: `EVENT_NAME_TERMS=$'term1\nterm2' scripts/check-event-names origin/main`. Self-test: `scripts/check-event-names --self-test`.
- Without the secret the check fails (exit 2), except on fork PRs, where secrets are unavailable and it is skipped with a warning; a maintainer reviews those when approving the run.
