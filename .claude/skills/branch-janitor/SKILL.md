---
name: branch-janitor
description: Clean up after merges - remove stale agent worktrees, delete merged local and remote branches, and return the main checkout to an up-to-date main. Runs in the branch-janitor subagent.
argument-hint: "[branches to keep]"
disable-model-invocation: true
context: fork
agent: branch-janitor
background: false
---

Read and follow `.agents/roles/branch-janitor.md`. `KEEP`, possibly empty: $ARGUMENTS
