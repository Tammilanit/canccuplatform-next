# 0017. Naming: the canccu prefix

- **Status:** Accepted (implemented by #84: the rename and `scripts/check-naming`)
- **Date:** 2026-11-05

## Context
The platform's names used the short prefix `cp`: environment variables, npm and Python packages, the session cookie, CSS classes and custom properties, the firewall chain and the Postgres role. The product owner wants `canccu` instead. Nothing is deployed yet and the codebase is small, so renaming now is cheap; each module added later makes it more expensive.

## Decision
Every platform name uses the `canccu` prefix:

| Kind | Form | Example |
|---|---|---|
| Environment variables | `CANCCU_` | `CANCCU_VALKEY_URL` |
| npm packages | `@canccu/` | `@canccu/kit` |
| Python distributions / imports | `canccu-` / `canccu_` | `canccu-kit` / `canccu_kit` |
| Cookies | `canccu_` | `canccu_session` |
| CSS classes and custom properties | `canccu-` / `--canccu-` | `canccu-button`, `--canccu-color-primary` |
| systemd units, iptables chains | `canccu-` / `CANCCU-` | `canccu-stack.service`, `CANCCU-FIREWALL` |
| Postgres role and database, loggers | `canccu` | `canccu`, `canccu.kit.bus` |

`scripts/check-naming` (CI job `naming`) fails on an identifier with the old prefix in any tracked file name or content. `docs/plans/` is history and exempt; the coreutils `cp` command never matches, because a space follows it.

## Consequences
- The cookie rename (`canccu_session` in `contracts/admin.md` and `contracts/admin.openapi.yaml`) is a breaking contract change, accepted because nothing is deployed.
- The Postgres role and database are created when the volume is first initialised. A local stack started before the rename keeps the old role: remove its volumes (`docker compose -f deploy/compose.yml down -v`) and start again.
- Repo and GitHub names are out of scope; the working name `canccuplatform-next` becomes `canccuplatform` at the switch.
