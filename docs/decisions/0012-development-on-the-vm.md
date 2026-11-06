# 0012. Development runs on the VM, for now

- **Status:** Accepted (temporary). The "revisit before the freeze" trigger is superseded by [0021](0021-no-fixed-dates.md): revisit before real event data comes to the VM. The "one issue per PR" flow is superseded by [0019](0019-work-packages.md).
- **Date:** 2026-11-05

## Context
Development moved from a home machine to the hosted VM. There is no separate dev VM yet. AGENTS.md forbids editing on the VMs: code reaches them only through a merge to main and the deploy that follows.

## Decision
- Development (AI sessions and their worktrees) runs on the VM as an unprivileged user, temporarily.
- Work happens in separate worktrees. The running stack still changes only through merges to main and the deploy that follows (AGENTS.md).
- The AI tool's settings deny commands that touch the firewall, ssh, Tailscale or sudoers.
- The legacy repos are cloned read-only on the VM (push disabled) as the porting source.
- The flow stays issue-driven on GitHub (epics, sub-issues, one issue per PR) for traceability.

## Consequences
- Development and the running stack share CPU, RAM and disk.
- Author and reviewer sessions share one OS user until the reviewer moves to its own, before the freeze, in roadmap step 10 ([0014](0014-independent-review.md), Known limits).
- Revisit before the freeze, when real secrets and the event come to the VM: ask the hoster for a separate dev VM, or move development off it.
