# 0024. Additive contract docs are normal risk; the maintainer reviews contracts at the checkpoint

- **Status:** Accepted (extends [0019](0019-work-packages.md) without superseding it)
- **Date:** 2026-11-07

## Context
[0019](0019-work-packages.md) puts "security, sign-in, rights, tenancy/RLS, money or personal data" in the high class without saying whether that means the code or the contract that describes it. Read broadly, almost every contract doc is high: a module's contract names who may call what and which personal data it holds. In step 2, five of six packages waited for the maintainer's accept, mostly contract docs that only added contracts, fields, endpoints or events. Those docs change no running code, and a later consumer PR that implements them is reviewed on its own. A stop per contract doc slows the step without lowering the risk, and shows the maintainer contracts one at a time rather than as a whole. The maintainer agreed the rule below on 2026-11-07 (#136).

## Decision
- **The high class** covers:
  - a breaking contract change: anything removed or renamed that a consumer may use;
  - a destructive migration;
  - `.github/` (the gates themselves);
  - `setup/` (privileged host scripts);
  - agent config (`AGENTS.md`, `CLAUDE.md`, `.claude/`);
  - a record that supersedes 0014, 0016 or 0019;
  - **code or config** for security, sign-in, rights, sessions, secrets, tenancy/RLS, money or personal data.
- **An additive contract doc is normal.** A PR to `contracts/` that only adds new contracts, fields, endpoints or events is normal risk, even when it defines rights or personal data. A PR that also changes high-class code or config, or removes or renames anything in a contract, stays high.
- **The checkpoint reviews contracts together.** The step summary at the checkpoint ◆ lists the step's contract PRs (every PR that changed `contracts/`) with their risk class, so the maintainer reviews the step's contracts as a whole. What the maintainer wants changed becomes a roadmap note or an issue for the next step, as any checkpoint finding.
- **The reviewer** still confirms or raises the risk class, and raises a contract PR to high when it is breaking. It still runs `/security-review` when a PR changes code or config for sign-in, rights, sessions, secrets or tenancy/RLS; a contract doc alone does not need it.

## Consequences
- AGENTS.md (Merge rules, risk classes) and CLAUDE.md (`review`) follow; CONTRIBUTING.md, `docs/contributing.md`, `docs/ci.md` and the roadmap's checkpoint review follow too.
- The step summary gains a list of the step's contract PRs.
- A contract doc that only adds merges on green CI and `pass`, like any normal PR.
- Everything else in 0019 holds: packages, the other risk classes, no splitting, the health pass and the checkpoint. The Contracts rules stand: a contract change is its own PR and merges first, and a breaking change needs the maintainer's accept.

## Known limits
- **"Only adds" is a judgement.** `scripts/check-contracts` lints the contracts but does not yet tell additive from breaking; until the contract diff in CI does, the planner sets the class and the reviewer confirms or raises it; a breaking change read as additive would merge without the maintainer.
- **A contract merges before the maintainer sees it.** Consumers may build on it before the checkpoint. A change the maintainer asks for then is a new additive contract PR, or a breaking one with an accept, as the Contracts rules already require.
