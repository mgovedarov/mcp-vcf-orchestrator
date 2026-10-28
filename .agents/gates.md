# Test gates

Two tiers. `test-runner` runs a gate when the orchestrator asks; `coder` and `remediator` run the per-item gate themselves.

## Rules

- Run every command in the foreground, one at a time, in order, with the timeout shown. macOS has no `timeout` command, so set the timeout on the shell tool.
- Run the build and test commands inside the worktree under test, never in the main working copy. Each gate step says where it runs. The final gate's setup and cleanup (`git fetch`, `git worktree add`, `git worktree remove`, `rm -f`) run in the main repository, because the worktree doesn't exist yet or is being removed. They only touch `.git` and the temp dir.
- A failing command stops the gate. Report it and skip the rest, except the trailing cleanup (`git worktree remove`, `rm -f`), which always runs so that nothing is left behind.
- One retry is allowed. A `git fetch` that fails with `cannot lock ref`, or because a `.lock` file exists, collided with a fetch in another worktree or role, since worktrees share refs. Wait 5 s and run it once more. Any other failure, or a second lock failure, stops the gate.
- Never run the final gate per item. It runs once per wave, on the combined result.
- No gate contacts a live VCFA/vRO environment or needs Docker or credentials.

## Per-item gate

Run it in the unit's worktree before opening a PR and again after every fix. It takes about 15 s once dependencies are installed.

| # | Command | Timeout | Notes |
|---|---|---|---|
| 1 | `curl -s -o /dev/null -w '%{http_code}' --max-time 20 https://registry.npmjs.org/` | 30 s | Must print `200`. On anything else, return `HUMAN-NEEDED: npm registry unreachable`: a DNS-filtering network or VPN can block it, and you never route around that. |
| 2 | `npm ci` | 300 s | A fresh worktree has no `node_modules`. |
| 3 | `npm run validate` | 300 s | CI's `Validate docs, coverage, and package` job, verbatim: build, tests, coverage thresholds, docs drift, docs build, package contents. |

## Final gate

Both parts must be green before anything lands on `main`.

1. **Local, on the combined tip** of the wave's PR branches, merged in landing order in a throwaway worktree. `<dir>` is a new path under the temp dir. Write it out literally, because shell variables don't survive from one command to the next. Set up from the main repository:
   ```sh
   git fetch origin main <branch>...
   git worktree add --detach <dir> origin/main
   printf 'CHANGELOG.md merge=union\ndocs/reference/tools.md merge=union\n' > <dir>.attrs
   git -C <dir> -c core.attributesFile=<dir>.attrs merge --no-edit origin/<branch>   # once per branch
   ```
   PRs in one wave each add their own `CHANGELOG.md` entries and `docs/reference/tools.md` sections, and the plan doesn't count those files as overlap. The `union` driver keeps both sides in both files. A conflict anywhere else is a FAIL. Then run per-item steps 1–3 in `<dir>`. Finish from the main repository with `git worktree remove --force <dir>` and `rm -f <dir>.attrs`.
2. **CI, per PR, before its merge.** All six required contexts must be green on a head that is up to date with `main`, which `strict: true` enforces: `Test on Node 22`, `Test on Node 24`, `Validate docs, coverage, and package`, `Verify npm package contents`, `Review dependency changes`, `Analyze JavaScript and TypeScript`. The Node 24 leg, dependency review, and CodeQL are CI-only. After the wave's last merge, the push CI on `main` must be green too. Each round takes about 2 min, mostly CodeQL.

## Strict vs lax

- `npm test` is lax. It skips the coverage thresholds, docs drift, docs build, and package check, all of which CI requires. `npm run test:coverage` is the threshold-free twin of `test:coverage:check`. Gate only on `npm run validate`.
- A bare `node --test` without a build tests a stale `dist/`.
- `npm install` can rewrite `package-lock.json`. Gates use `npm ci`.
- Local Node may be 22 while `.nvmrc` and CI's validate job use 24. A local green proves nothing about Node 24; only CI's Node 24 leg does.
