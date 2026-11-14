# 0029. Additive contract changes ship with the code that uses them; contract-first only for breaking changes

- **Status:** Accepted (amends [0008](0008-contract-first.md) and the Contracts sentence of [0024](0024-additive-contract-docs-normal-risk.md) without superseding them)
- **Date:** 2026-11-14

## Context
[0008](0008-contract-first.md) says a contract change is its own PR, merged before its consumers, and [0024](0024-additive-contract-docs-normal-risk.md) kept that rule. Of the 8 most recent packages, 5 first opened a contract-only PR, and each of those paid for a full extra cycle of CI, independent review and merge queue (about 45–60 minutes) before its code could follow. For an additive change that cycle buys little: nothing a consumer uses changes, so merging the contract first protects no one, and the reviewer sees the contract next to the code that implements it. A breaking change is different: consumers must be ready before it lands, and it needs the maintainer's accept. The product owner decided this on 2026-11-14, from the lead's analysis of the package cycle (#462).

## Decision
- **Additive ships together.** An additive contract change (new fields, endpoints, events, settings) goes in the package PR together with the code that uses it. When several packages use the same addition, it goes in the first of them in the package order, and the others build on it after that PR merges.
- **Breaking stays first.** A breaking change (removing or renaming anything a consumer may use) is its own PR, merges before its consumers and needs a maintainer's accept; the independent review names it.
- **Removal stays apart.** Removing an old thing comes later, in a separate PR from the one that adds its replacement; being breaking, that PR follows the rule above.

## Consequences
- AGENTS.md (Contracts, Package plan, the review in A package run, Maintainers), CLAUDE.md (`review`), the README, [contracts/README.md](../../contracts/README.md#changing-a-contract) and [contracts/events.md](../../contracts/events.md) follow.
- A package PR that carries an additive contract change takes the risk class of its other parts: the contract part alone is normal ([0024](0024-additive-contract-docs-normal-risk.md)), and high-class code beside it makes the whole PR high, as before.
- The checkpoint still lists every PR that changed `contracts/` ([0024](0024-additive-contract-docs-normal-risk.md)); from now on most of them are package PRs, not contract-only PRs.
- 0008's other decisions (modules talk only through their API and the bus, the shared conventions) and the rest of 0024 stand.

## Known limits
- **"Additive" stays a judgement.** Until the contract diff in CI tells additive from breaking, the planner sets the class and the reviewer confirms or raises it ([0024](0024-additive-contract-docs-normal-risk.md), Known limits). A breaking change read as additive now also lands together with its consumers.
