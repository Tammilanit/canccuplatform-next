# Decisions

The settled decisions behind [the roadmap](../roadmap.md), one record each. A decision changes only through an issue the product owner (the maintainer) agreed, and its PR adds a new record and marks the old one superseded; old records are never rewritten, except their Status line. Sessions that answer questions escalate a new decision to the maintainer rather than add a record. Records merge like any other PR ([0016](0016-merge-policy.md)).

Each record has Status, Date, Context, Decision and Consequences. New records take the next number: `NNNN-<slug>.md`.

| # | Decision | Date |
|---|---|---|
| [0001](0001-port-dont-rewrite.md) | Port, don't rewrite (superseded by 0020) | 2026-11-03 |
| [0002](0002-no-legacy-history-or-docs.md) | No legacy git history and no legacy docs | 2026-11-03 |
| [0003](0003-event-content-scrubbed.md) | Event content is scrubbed from the platform | 2026-11-02 |
| [0004](0004-nothing-migrated.md) | Nothing is migrated except the legacy bot data | 2026-11-03 |
| [0005](0005-signup-site-stays-outside.md) | The event signup site stays outside the platform | 2026-11-02 |
| [0006](0006-stack.md) | The stack | 2026-11-02 |
| [0007](0007-stateless-containers.md) | Containers are stateless | 2026-11-02 |
| [0008](0008-contract-first.md) | Contract first, with shared conventions | 2026-11-02 |
| [0009](0009-rust-rejected.md) | Rust is not used | 2026-11-04 |
| [0010](0010-scope.md) | Scope: what is dropped, Moments, PPTX | 2026-11-03 |
| [0011](0011-hosting-on-remote-vm.md) | The platform is hosted on a remote VM | 2026-11-04 |
| [0012](0012-development-on-the-vm.md) | Development runs on the VM, for now | 2026-11-05 |
| [0013](0013-multi-tenant-core.md) | Multi-tenant from day 1, on one shared stack | 2026-11-05 |
| [0014](0014-independent-review.md) | Every PR gets an independent review | 2026-11-05 |
| [0015](0015-dependency-auditing.md) | Dependency auditing | 2026-11-05 |
| [0016](0016-merge-policy.md) | Merge policy | 2026-11-05 |
| [0017](0017-naming.md) | Naming: the canccu prefix | 2026-11-05 |
| [0018](0018-ticker-manual.md) | The ticker is manual: set by a person, from admin or the bot | 2026-11-06 |
| [0019](0019-work-packages.md) | Work runs in packages, with risk classes, a health pass and a checkpoint per step | 2026-11-06 |
| [0020](0020-best-of-old-freely-new.md) | The best of the old, freely new | 2026-11-06 |
| [0021](0021-no-fixed-dates.md) | No freeze and no target dates | 2026-11-06 |
| [0022](0022-product-vision.md) | The product vision: who it is for, the Pulse screen at its heart, what is planned and what is not | 2026-11-06 |
| [0023](0023-step-design-briefs.md) | Every step starts with a design brief, and issues leave room to design | 2026-11-06 |
| [0024](0024-additive-contract-docs-normal-risk.md) | Additive contract docs are normal risk; the maintainer reviews contracts at the checkpoint | 2026-11-07 |
