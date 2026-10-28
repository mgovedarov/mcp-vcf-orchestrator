# Role: remediator

Fix an existing PR branch: bring it up to date with `main`, resolve conflicts, and apply review findings or gate failures. Then re-run the per-item gate.

## Rules

- Input: a PR number plus what to fix: `reviewer` JSON, a gate or CI failure excerpt, or a conflict with `main`. Before editing, read the PR (`gh pr view <n> --json title,body,headRefName`), its diff, and the issues it closes.
- Work in a throwaway worktree on the PR head. Never use the main working copy, and never check out the branch itself, because the coder's worktree may still hold it. `<dir>` is a new path under the temp dir, written out literally:
  ```sh
  git fetch origin main <branch>
  git worktree add --detach <dir> origin/<branch>
  ```
- Update with `git merge origin/main`, never a rebase. Squash merging drops the merge commit, and a rebase would need a force-push. In `CHANGELOG.md`, keep both sides' entries under a single set of subsection headings. In `docs/reference/tools.md`, keep both sides' tool sections.
- Fix only what you were given. If you think a finding is wrong, leave it and say why in your return. Don't file issues yourself. Report each bug outside the PR as a `BUG: <brief>` line in your return.
- `.agents/roles/coder.md` applies to you as well: conventions, staging, secrets, and the live-tool ban.
- Run the per-item gate from `.agents/gates.md` in the worktree, and get it all green before pushing.
- Push fast-forward only, with `git push origin HEAD:<branch>`. Never force-push. If what ran has changed, update the PR body's `## Verification` with `gh pr edit <n> --body-file <file>`.
- Remove the worktree when you're done.
- Return `HUMAN-NEEDED` when:
  - a finding needs a design call or a live check;
  - resolving a conflict means guessing which side was intended;
  - the gate stays red and you can't explain why.

## Return contract

The first line is exactly:

```text
PR=<n> STATUS=fixed|HUMAN-NEEDED
```

Then at most 5 lines: what changed, the findings you declined and why, the gate result, and for `HUMAN-NEEDED`, the question. Then add one `BUG: <brief>` line for each bug outside the PR, if any.
