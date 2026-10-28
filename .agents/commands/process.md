# Command: process

Run the processing loop. It takes open issues from the source, implements them through the roles, gates and reviews each PR, lands the PRs, writes back, and reports.

Start the loop only when the user invokes it. Never start it on your own, for example after filing an issue.

## Inputs and limits

- Source: `.agents/sources/github-issues.md`. Gates: `.agents/gates.md`.
- A run takes at most 10 actionable items (the user may pass another number) and runs at most 3 coders at once. Each PR gets at most 2 remediation rounds; after that its items are human-needed.

## Rules

- The main session only orchestrates. Every step that reads code, writes code, or runs tests goes to a role in `.agents/roles/`: `scout`, `researcher`, `coder`, `reviewer`, `remediator`, `test-runner`, or `issue-filer`.
- Check what a role claims against the source of truth (`gh pr diff`, `gh pr view`, `gh issue view`), never against its summary.
- Hand bugs found along the way, including the `BUG:` lines that roles return, to `issue-filer` one at a time. Each filing takes the next `VCFO-###` code, so two filings at once can take the same code. Never widen a unit.
- A unit that can't proceed returns `HUMAN-NEEDED`. Report it and write it back. Never guess at an answer.
- No role and no step calls the live VCFA/vRO tools. A unit that needs a live check is human-needed; the user confirms the target and impact outside the loop.
- Every comment is public, so sanitize it.

## Steps

1. **Fetch.** Run the source's Select query and drop the in-flight issues it names. If nothing is left, report that and stop.
2. **Triage.** Read the candidates in order and classify each one:
   - `actionable`;
   - `human-needed`: ambiguous, needs a design call, or needs live verification;
   - `blocked`: waits on an open issue that this run won't land, because it is outside this run's actionable items or is itself human-needed or blocked. An item that depends on an actionable item of this run is actionable, and step 3 puts it in a later wave.

   Stop once the run limit is reached in actionable items. Human-needed and blocked items don't count toward the limit, so they can't crowd out the newer issues behind them. Use `researcher` when classifying needs a code read. Write back every item that isn't actionable, as the source's Write-back section describes.
3. **Plan units.** An item's footprint is the set of files and dirs it says it will change. That is usually in `## Proposed implementation`; older issues use `## Suggested fix` or `## Proposed change`, or have no sections at all. A path cited only as evidence is not part of the footprint. If the issue names no paths, have `scout` list them.
   - Items whose footprints overlap form one unit. `CHANGELOG.md` and `docs/reference/tools.md` don't count as overlap: items add their own entries and tool sections to them, and the final gate merges both files with the `union` driver.
   - A unit that depends on another unit in this batch goes in a later wave.
   - Print the waves and units, then continue.
4. **Implement.** In each wave, start one `coder` per unit, at most 3 at once, each in its own fresh worktree branched from `origin/main`.
   - Pass each issue's number and its body verbatim.
   - A unit of several items lands as one PR, with the codes stacked in the title (`[VCFO-a][VCFO-b] …`) and one `Closes #N.` line per issue.
   - On `PR=<n>`, write back "PR opened". On `HUMAN-NEEDED`, write it back and drop the unit.
5. **Review.** For each PR, read `gh pr diff <n>` yourself, then send the PR to `reviewer`.
   - Send findings to `remediator` when the verdict is `changes-requested` or a required CI check is red; for a red check, include the excerpt from `gh run view <run-id> --log-failed`. Then review again.
   - If the PR is still not clean after 2 remediation rounds, mark its items human-needed and leave the PR open.
6. **Final gate.** Have `test-runner` run the final gate's local part from `.agents/gates.md` on the combined tip of the wave's clean PRs, in landing order. On red, find the PR at fault:
   - If the excerpt points at one PR's changes, send it to that PR's `remediator`, then run the gate again. This counts toward that PR's rounds.
   - If no single PR is at fault, because each passed its own per-item gate and the failure appears only in the combination, drop the last PR in landing order and run the gate again. Repeat until it is green, then land the green set. Handle each dropped PR as a wave of its own, starting at this step: with the PRs it clashed with now on `main`, the failure is that PR's own.
7. **Land.** Merge the wave's clean PRs one at a time, in dependency order. For each PR:
   - Get the head SHA from `gh pr view <n> --json headRefOid` and read `behind_by` from `gh api repos/mgovedarov/mcp-vcf-orchestrator/compare/main...<sha>`.
   - If `behind_by` is above 0, run `gh pr update-branch <n>`. Re-check `behind_by` on every poll: right after a merge, GitHub reports `UNKNOWN`, not `BEHIND`.
   - If the update conflicts, send the PR to `remediator`. A fix that only touches `CHANGELOG.md` and `docs/reference/tools.md` doesn't count as a round, and the PR goes straight back to waiting for `CLEAN`. A wider fix sends it back to step 5.
   - Wait until `gh pr view <n> --json mergeStateStatus` reads `CLEAN`, for at most 30 minutes after the PR's last push. Right after an update, `gh pr checks --watch` reports the old head's runs, so poll `gh pr checks <n>` instead. While waiting:
     - A failing required check sends the PR back to step 5.
     - `UNSTABLE` means a check outside the six required contexts failed. That is usually `CodeQL`, which reports new code-scanning alerts. Send the alerts from `gh api 'repos/mgovedarov/mcp-vcf-orchestrator/code-scanning/alerts?ref=refs/pull/<n>/merge&state=open'` back to step 5, as for a red required check. Never merge past it.
     - `DIRTY` is a conflict. Handle it like a conflicting update.
     - Any other state when the time is up, such as `BLOCKED` with every required check green, means merges are blocked. Stop and give the user the remaining PRs in merge order.
   - Run `gh pr merge <n> --squash`, then confirm the merge with `gh pr view <n> --json state,mergedAt`. Don't pass `--delete-branch`: the repository already deletes the head branch on merge, and the flag's local delete can fail while the unit's worktree still holds the branch, which turns a successful merge into a failed command.
   - A permission denial on the merge, or on the command after it, proves nothing about the merge, so check the PR's state before retrying. If merges stay blocked, stop and give the user the remaining PRs in merge order.
   - Remove the unit's worktree and delete its local branch with `git branch -D`; git calls a squash-merged branch unmerged.

   After the wave, confirm the push CI on `main` is green. Then start the next wave at step 4.
8. **Write back and report.** Confirm that each merged item's issue closed. Then report in at most 20 lines:
   - items done, with PR links;
   - items that are human-needed or blocked, with reasons;
   - items skipped by the filter;
   - per-item and final gate results.
