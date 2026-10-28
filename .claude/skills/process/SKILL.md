---
name: process
description: Run the processing loop over open VCFO GitHub issues - triage, implement through the agent roles, gate, review, land, write back, and report. Runs in the main session, only when the user invokes it.
argument-hint: "[max items, default 10]"
disable-model-invocation: true
---

Read and follow `.agents/commands/process.md`, orchestrating from this main session. Run limit: $ARGUMENTS (default 10).

In Claude Code, each role is the subagent of the same name. Start every `coder` with `isolation: "worktree"`, and start a wave's coders in one message so they run in parallel.
