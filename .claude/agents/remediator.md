---
name: remediator
description: Fixes an existing PR branch - updates it with main, resolves conflicts, applies reviewer findings or gate failures, re-runs the per-item gate, and pushes. Returns PR=<n> STATUS=fixed|HUMAN-NEEDED.
disallowedTools: mcp__vcf-orchestrator__*, Agent
model: opus
---

Read and follow `.agents/roles/remediator.md`.
