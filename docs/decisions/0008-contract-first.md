# 0008. Contract first, with shared conventions

- **Status:** Accepted
- **Date:** 2026-11-02

## Context
The legacy modules grew links one feature at a time: polling, one token per link and calls into each other's data.

## Decision
- Modules talk only through their API and the bus; each module owns its data and no tables are shared.
- Each module has one contract in `contracts/`, written and merged before its consumers. A contract change is its own PR and is additive; removals come later in a separate PR, and breaking changes need a person's approval.
- Conventions:
  - events are named `<module>.<noun>.<past verb>` and carry a UUIDv7 envelope (with `tenant`, [0013](0013-multi-tenant-core.md));
  - payloads are snake_case with RFC 3339 UTC times;
  - errors are `{error:{code,message}}`;
  - rights are `<module>.<right>`;
  - the session cookie is `cp_session`.

## Consequences
- Modules are language-independent behind their contract.
- CI diffs contracts (additive vs breaking) and runs API tests from them.
