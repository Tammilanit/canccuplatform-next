# Contributing

Welcome. The rules for people and AI tools alike are in [AGENTS.md](AGENTS.md); this page gets your machine ready.

## 1. Get the code
- **Write access:** clone the repo and work in a branch `<n>-short-name`.
- **Everyone else:** fork, clone your fork, branch the same way, and open the PR from your fork. A maintainer approves the first CI run for forks and first-time contributors.

Pick an issue labelled `ready`, assign yourself (or comment "I'll take this"), and open a draft PR early.

## 2. Your computer
You need git and Docker with Compose.
- **Linux:** Docker Engine with the Compose plugin.
- **Windows:** WSL2 with a Linux distribution and Docker (Docker Desktop with the WSL2 backend, or Docker Engine inside WSL). Clone **inside WSL** (e.g. `~/code`), not under `C:`, or file access is slow. Give WSL 6–8 GB of memory in `%UserProfile%\.wslconfig`:
  ```ini
  [wsl2]
  memory=8GB
  ```
  then run `wsl --shutdown` and start it again.
- **macOS:** Docker Desktop.

## 3. Run the demo event
One Docker Compose command starts the whole platform with the demo event (`events/demo/`). It arrives with the Compose and demo-event issues and will be written here; the repo is a skeleton and nothing runs yet.

Each module's README names its own check command (lint, types, unit tests); run it for every module you touch before asking for review.

## 4. Cast and other LAN features
Devices on your LAN cannot easily reach containers inside WSL or on a Mac. Test Cast and anything else that needs other devices on the shared test VM, which runs main: merge your work first, then try it there.

## 5. Merging
You never merge by hand. Before marking your PR ready, run a local code review (Claude Code: `/code-review` at `high` effort, or an equivalent review in your tool), fix its findings and add a `Review run:` line to the PR body. If your PR is `Accept: auto`, enable auto-merge; GitHub merges it when CI is green. With `Accept: manual` a maintainer accepts the PR first; which PRs those are (and that from the freeze on 2027-03-01 every PR is) is listed in AGENTS.md, Merge rules. A person also approves breaking contract changes, destructive migrations, and the first CI run of fork or first-time PRs; a maintainer reviews fork PRs. See AGENTS.md, Merge rules.
