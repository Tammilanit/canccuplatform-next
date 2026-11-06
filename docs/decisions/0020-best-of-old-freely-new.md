# 0020. The best of the old, freely new

- **Status:** Accepted (supersedes [0001](0001-port-dont-rewrite.md))
- **Date:** 2026-11-06

## Context
[0001](0001-port-dont-rewrite.md) made every module a port of the legacy code, to keep proven code and fixed bugs within a short time to the next event. That limits the platform to the shape of the old system. The product owner's direction of 2026-11-06 sets a larger goal, and [0021](0021-no-fixed-dates.md) removes the fixed dates that made porting the safe choice.

## Decision
- **We build a much bigger, better and richer platform:** a commercial-scale, polished and intuitive system, not a port of the old one.
- **The legacy repos are a source of proven ideas, code and tests.** Take what is best and sensible from them. We are never limited to porting: design anew wherever that gives a better product.
- **For each feature, choose freely:** reuse as is, reuse with changes, rebuild, drop, or add something new that the old system never had. Name the reason (in the issue, the package plan or the PR).
- **The rules that still hold:**
  - no event content in the platform ([0003](0003-event-content-scrubbed.md));
  - no legacy git history or legacy docs ([0002](0002-no-legacy-history-or-docs.md));
  - other authors' code keeps its licence and attribution; ISC-licensed code from another author is used only after that author's OK.

## Consequences
- AGENTS.md "Porting" becomes "Building on the legacy".
- The roadmap states the ambition, and each step says what the platform delivers, not only what is ported. Its porting plan becomes a starting point for the choice per feature, not a rule.
- The legacy inventories (`docs/legacy-inventory/`) stay the map of what can be reused.
- Legacy shapes that assume one event are still scoped to a tenant when they are reused ([0013](0013-multi-tenant-core.md)).

## Known limits
- **Rebuilding costs more than porting.** A rebuilt feature loses the bugs the old code already fixed; its tests must cover what the legacy tests covered, and the reason for the rebuild is named so the reviewer can weigh it.
