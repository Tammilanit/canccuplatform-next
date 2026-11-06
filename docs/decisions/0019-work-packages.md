# 0019. Work runs in packages, with risk classes, a health pass and a checkpoint per step

- **Status:** Accepted (supersedes the review flow per PR of [0014](0014-independent-review.md), now per package, and the accept list of [0016](0016-merge-policy.md), now given by risk class)
- **Date:** 2026-11-06

## Context
Until now every issue ran alone: one issue, one PR, one independent review and one fix-check ([0014](0014-independent-review.md)), and a fixed list of PR kinds needed the maintainer's accept ([0016](0016-merge-policy.md)). A roadmap step is many issues, so that meant many small runs and reviews, issues that touch the same files running apart, and the maintainer looking at PRs one by one rather than at a step as a whole. Nothing set a moment to clean up after a step, or a place to record how the roadmap changes as we learn. The product owner agreed the work-package model below on 2026-11-06.

## Decision
- **Step run.** Work runs per roadmap step. The lead writes a step's issues at once: a few broad ones, each a whole capability, listed in the step's epic. At the start of each wave a planner session writes a **package plan**: the packages, their order, risk class and file areas.
  - Issues touching the same files go in one package, in order.
  - Independent issues go in parallel packages.
  - High-risk content gets a package of its own.
  - A package changes at most about 1,500 lines.
- **No splitting.** No worker, planner or reviewer splits an issue or creates one. New findings become `Follow-up:` or `Roadmap note:` lines in the PR. The lead sorts them into this step, a later step, or a roadmap change for the maintainer.
- **Package run:** one worker run (subagents allowed inside it), one PR closing all its issues, CI, one independent review, one fix round, one fix-check. [0014](0014-independent-review.md) still holds for the review itself: the independent reviewer, the reviewer identity, the verdict line and the narrow fix-check.
- **Risk classes,** set by the planner and confirmed or raised by the reviewer:
  - **low:** docs, tests, cleanups, internal code of one module. Merges automatically.
  - **normal:** features and APIs inside a module. Merges automatically and is listed in the checkpoint summary.
  - **high:** a breaking contract change; a destructive migration; `.github/`; `setup/`; agent config (`AGENTS.md`, `CLAUDE.md`, `.claude/`); security, sign-in, rights, tenancy/RLS, money or personal data; a record that supersedes 0014, 0016 or 0019. Needs the maintainer's accept, for that package only.

  The reviewer's verdict is `manual — <reason>` for high, and `pass` otherwise. From the freeze (2027-03-01) every PR needs the maintainer's accept, as before ([0016](0016-merge-policy.md)).
- **Health pass.** When all of a step's issues are closed, a fresh session runs one cleanup package against the checklist:
  - no file over about 400 lines, or doing two jobs;
  - no code left for dropped features, and no old names;
  - comments follow the comment rule (comment the why, never the what);
  - no duplicated logic.
- **Checkpoint ◆.** The project then pauses. The maintainer sees the demo and the step summary (packages, risk classes, spend, roadmap notes), the roadmap is updated, and the maintainer says go. Then the next step starts.
- **Fast lane.** An issue with no milestone, or labelled `fast`, runs alone as one issue, one PR, as before.
- **Human contributors** may still do one issue per PR: a package of one.

## Consequences
- AGENTS.md "How work flows" replaces "Working on an issue"; its Merge rules go by risk class. CLAUDE.md's shortcut words follow.
- The PR body names its package and risk class (`Package:`, `Risk:`), one `Closes #<n>` line per issue, and any `Follow-up:` and `Roadmap note:` lines.
- The reviewer checks every linked issue's acceptance criteria and Out of scope, and confirms or raises the risk class.
- The accept list of [0016](0016-merge-policy.md) becomes the high class, which adds agent config, security, sign-in, rights, tenancy/RLS, money and personal data. Outside the classes, plan-tier plans (`docs/plans/issue-<n>.md`) and anything in other repos still need the maintainer's accept, as in 0016.
- `docs/roadmap.md` records how the roadmap changes: roadmap notes, the lead's triage, the review at each checkpoint and a dated change log.
- The file-size rule gets a CI `file-size` job that warns, never fails, with an exemption list in the repo (`docs/ci.md`).
- Epics carry a "Planned" checklist of the step's issues. `Order:` lines and the ready chain apply to packages of one only.

## Known limits
- **The dispatcher does not run packages yet.** Its support for package plans, package branches and risk classes is maintainer tooling, outside this repo; until it lands, the lead starts package runs by hand.
- **The risk class is a judgement.** The planner sets it and the reviewer can only confirm or raise it; nothing in CI checks it. The `review-gate` still sees only the verdict, so a high package wrongly reviewed as normal would merge without the maintainer. The paths that the dispatcher already treats as needing an accept (`.github/`, `setup/`) stay covered.
- **A package is large.** About 1,500 changed lines is a lot for one review; the review may miss more than on a narrow PR. The health pass and the checkpoint are the backstop.
- **The file-size rule only warns.** Existing long files stay until the health pass splits them or lists them with a reason.
