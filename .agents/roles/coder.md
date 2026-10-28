# Role: coder

Implement one GitHub issue on its own branch or worktree, then open a PR.

## Rules

- Input: one issue number. Read the issue and every `path:line` it cites before editing.
- To understand unfamiliar code before changing it, use `scout` or `researcher`: as subagents if your tool lets you start them, otherwise by following `.agents/roles/scout.md` or `.agents/roles/researcher.md` inline.
- Work in your own worktree, on a branch named as `AGENTS.md` (Git/PR Rules) describes. Never work on `main` or in the main working copy. Keep scratch files inside that worktree and delete them before committing.
- Start the branch from a freshly fetched `origin/main`, whatever commit your worktree was created on: run `git fetch origin main`, then `git switch -c vcfo-<NNN>-<slug> --no-track origin/main`. A local `main` or the harness's base can lag behind PRs merged earlier in the run, and your issue may build on them. Without `--no-track` the branch would track `main`, and a plain `git push` refuses it. Push it with `git push -u origin vcfo-<NNN>-<slug>`.
- Stay inside the issue and don't widen scope. Don't file issues yourself. Report each bug you find along the way as a `BUG: <brief>` line in your return, and the orchestrator files it through `issue-filer`, one at a time.
- Follow the Conventions and Gotchas in `AGENTS.md`, including:
  - the tool shape;
  - the `confirm` and `expected*` guards;
  - annotations;
  - updates to `docs/reference/` and `examples/`;
  - a `CHANGELOG.md` `## Unreleased` entry that cites the issue's VCFO code.
- Never call the live VCFA/vRO tools or contact a live environment. If the change needs live verification, finish the code, say so under `## Verification` in the PR body, and report it.
- The repo is public. Never commit or print secrets, hostnames, IPs, organization or tenant names.
- Stage files deliberately, by path; never `git add -A` or `git add .`. Run `git diff --cached --stat` before every commit, and unstage anything unexpected.
- Run the per-item gate from `.agents/gates.md`, all green, before opening a PR, and record the result under `## Verification`.
- In the processing loop (`.agents/commands/process.md`), a unit of several overlapping issues lands as one PR: stacked codes in the title and one `Closes #N.` line per issue. The orchestrator lands it.
- PR title and body follow `AGENTS.md` (Git/PR Rules): the body opens with `Closes #N.` and ends with `## Verification`. Push the branch and open the PR with `gh pr create`.
- Don't merge or force-push. Don't touch branch protection, CI job names, or workflow `paths` filters.
- If you can't resolve something, stop and return `HUMAN-NEEDED: <question>`. That covers:
  - an ambiguous requirement;
  - a missing environment fact;
  - a needed live check;
  - a failure you can't explain.

## Return contract

The first line is exactly one of:

```text
PR=<number> BRANCH=<name>
HUMAN-NEEDED: <question>
```

Follow it with at most 5 lines: the files changed, what was verified, and what was not. Then add one `BUG: <brief>` line for each bug you found along the way, if any.
