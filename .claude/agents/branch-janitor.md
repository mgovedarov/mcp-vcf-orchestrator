---
name: branch-janitor
description: Post-merge cleanup. Removes stale agent worktrees and deletes merged local and remote branches, only on evidence that their work is on main or in a merged PR, and returns the main checkout to an up-to-date main when safe. Returns a WORKTREES/LOCAL/REMOTE/MAIN-CHECKOUT/BLOCKED summary.
tools: Read, Grep, Glob, Bash
model: haiku
---

Read and follow `.agents/roles/branch-janitor.md`.
