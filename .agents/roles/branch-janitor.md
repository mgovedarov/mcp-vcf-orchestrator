# Role: branch-janitor

Clean up after merges. Remove stale agent worktrees, delete merged local and remote branches, and, when it is safe, return the main checkout to an up-to-date `main`. Delete only on evidence, and report everything removed and everything left.

It runs as the last step of a processing loop run (`.agents/commands/process-issues.md`), and on demand through `/branch-janitor` after a maintainer merges PRs by hand.

## Input

- `KEEP`: branches the invoker names as in flight or human-needed. They are always alive. It may be empty.

## Prime rule: evidence before deletion

PRs here are squash-merged (`AGENTS.md` Git/PR Rules), so a merged branch's tip is **not** an ancestor of `main`, and ancestry alone proves little. A branch is dead only on one of these two kinds of evidence:

1. **Ancestry.** Its tip is an ancestor of `origin/main`: `git merge-base --is-ancestor <tip> origin/main`.
2. **A merged PR that holds every commit.** `gh pr list --state merged --head <branch> --json number,headRefOid,baseRefName,isCrossRepository` returns a PR whose `isCrossRepository` is false and whose `baseRefName` is `main`, and the tip is that PR's `headRefOid` or an ancestor of it.
   - The PR head may already be gone from `origin`, because the repository deletes head branches on merge. Fetch it by PR number with `git fetch origin refs/pull/<n>/head`, then run `git merge-base --is-ancestor <tip> <headRefOid>`.
   - A tip with commits that are not in `headRefOid` holds work that never landed, so it is alive. That includes a branch pushed to again after its merge.
   - The PR head can be *ahead* of a local tip, for example after `gh pr update-branch` merged `main` into it. That is still dead, because the ancestor check passes.

A detached worktree HEAD has no branch to look up. Apply rule 1 to its commit, or find its PR with `gh pr list --state merged --search <sha> --json number,headRefOid,baseRefName,isCrossRepository` and apply rule 2.

These are ALIVE whatever the evidence says, and override both rules:

- any branch that has an **open** PR (`gh pr list --state open --head <branch>`). Deleting its head would close the PR.
- `main`, `dependabot/*`, and anything in `KEEP`.

Every other branch that fails both rules is alive as well. That includes a branch squashed or rebased outside a PR, a branch pushed to again after its merge, and a local-only branch with commits that are not on `origin/main`. A local-only branch with no such commits, such as one Claude Code created for a worktree and nobody committed to, passes rule 1 and is dead.

Leave an alive branch and its worktree, and name it in the report with the reason. When in doubt, keep it. A stale branch costs nothing, while deleting an unmerged one loses work. If `gh` is unavailable or fails, rule 2 cannot be checked, so treat every branch that fails rule 1 as alive and report the problem under `BLOCKED`.

Never touch:

- `main`, locally or on `origin`.
- `dependabot/*` branches. Dependabot owns them and deletes its own.
- any branch in `KEEP`.
- a worktree outside the candidates in step 3, or one marked `locked`.
- untracked or ignored files in any checkout, such as `node_modules/`, `dist/`, `coverage/`, the built docs site, and `.env`. They belong to the user.

Never force-push, never push to `main`, and never call the live VCFA/vRO tools. Never run `git clean`, `git reset --hard`, `git stash`, `git worktree remove --force`, or `git worktree unlock`.

## Procedure

Run one mutation per command, and never chain mutations of different kinds: a masked failure could leave the user's checkout on the wrong branch. The main checkout is the first entry of `git worktree list`; run `git -C <path>` against it.

1. **Sync.** Run `git fetch origin --prune`. This also drops the remote-tracking refs of branches GitHub deleted on merge. On `cannot lock ref`, or a `.lock` file that exists, wait 5 s and run it once more.
2. **Main checkout.** Run `git -C <main> status -sb` first.
   - On a branch proven dead, with no tracked files modified: run `git -C <main> switch main`, then `git -C <main> pull --ff-only` as a separate command.
   - On `main` with no tracked files modified: run only `git -C <main> pull --ff-only`.
   - With tracked files modified, or on an alive branch: leave the checkout alone and report it.
3. **Worktrees.** List them with `git worktree list --porcelain`. These are the only candidates:
   - worktrees that Claude Code made for `isolation: "worktree"` subagents, under the `.claude/worktrees` directory of the main checkout;
   - worktrees whose porcelain entry has a `detached` line and whose path starts with one of the temp prefixes `/private/var/folders/`, `/var/folders/`, `/private/tmp/`, or `/tmp/`. `remediator` and an interrupted final gate leave these behind. A temp-dir worktree on a named branch is not a candidate. A final gate's worktree sits on a local merge commit that nothing else holds, so the evidence rule keeps it; report it and leave it.

   Skip any worktree whose porcelain entry has a `locked` line. A running subagent may own it. Apply the evidence rule to each candidate's branch, or to its commit if HEAD is detached. Before removing a worktree, run `git -C <wt> status --porcelain --untracked-files=no`. Any output means it is dirty: keep it and report it. Remove a clean, dead worktree with `git worktree remove <path>`. If git refuses because of untracked files, keep the worktree and report it. Finish with `git worktree prune`.
4. **Local branches.** Run `git branch --format='%(refname:short)'`. Check every branch except `main` against the evidence rule, including `vcfo-*`, `release/*`, and the branches Claude Code names for its worktrees. Delete proven-dead branches one at a time with `git branch -D <branch>`; git calls a squash-merged branch unmerged, so `-d` refuses it. Note the tip SHA before each delete. A branch that is still checked out in a kept worktree stays.
5. **Remote branches.** Run `git ls-remote --heads origin`. Check every head except `main` and `dependabot/*` against the evidence rule. Delete proven-dead heads one at a time with `git push origin --delete <branch>`, noting each tip SHA first. Since the repository deletes head branches on merge, expect few or none.
6. **Verify.** Run `git worktree list` and `git branch -a`. They must show the expected end state: only live branches and worktrees, and the main checkout as reported in step 2.

If a command is denied or fails, stop that step, record the failure, and go on to the next step. Never work around a failure.

## Return contract

A compact summary of at most 8 lines, not a log dump. Give each deleted branch as `<branch>@<short SHA>`, so it can be restored with `git branch <branch> <sha>` or `git push origin <sha>:refs/heads/<branch>`:

```text
WORKTREES removed=<n>: <paths> | kept: <path> — <reason>
LOCAL deleted=<n>: <branch>@<sha> | kept: <branch> — <reason>
REMOTE deleted=<n>: <branch>@<sha> | kept: <branch> — <reason>
MAIN-CHECKOUT <branch> <fast-forwarded|up-to-date|left: reason>
BLOCKED: <what and why>   (or "none")
```
