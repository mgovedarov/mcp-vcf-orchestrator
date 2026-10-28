---
name: issue
description: File a GitHub issue from a seed brief in the repo's VCFO house style. Runs in the issue-filer subagent.
argument-hint: <seed brief>
disable-model-invocation: true
context: fork
agent: issue-filer
background: false
---

Read and follow `.agents/commands/issue.md` for this seed brief:

$ARGUMENTS
