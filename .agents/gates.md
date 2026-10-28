# Test gates

Two tiers. `test-runner` runs a gate when the orchestrator asks; `coder` and `remediator` run the per-item gate themselves.

## Rules

- Run every command in the foreground, one at a time, in order, with the timeout shown. macOS has no `timeout` command, so set the timeout on the shell tool.
- Run inside the worktree under test, never in the main working copy.
- A failing command stops the gate. Report it and skip the rest, except a trailing `git worktree remove`, which always runs so that no worktree is left behind.
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

1. **Local, on the combined tip** of the wave's PR branches, merged in landing order in a throwaway worktree. `<dir>` is a new path under the temp dir. Write it out literally, because shell variables don't survive from one command to the next:
   ```sh
   git fetch origin main <branch>...
   git worktree add --detach <dir> origin/main
   printf 'CHANGELOG.md merge=union\n' > <dir>.attrs
   git -C <dir> -c core.attributesFile=<dir>.attrs merge --no-edit origin/<branch>   # once per branch
   ```
   Every PR appends to `CHANGELOG.md`, so the `union` driver keeps both sides there. A conflict anywhere else is a FAIL. Then run per-item steps 1–3 in `<dir>`, and finish with `git worktree remove --force <dir>`.
2. **CI, per PR, before its merge.** All six required contexts must be green on a head that is up to date with `main`, which `strict: true` enforces: `Test on Node 22`, `Test on Node 24`, `Validate docs, coverage, and package`, `Verify npm package contents`, `Review dependency changes`, `Analyze JavaScript and TypeScript`. The Node 24 leg, dependency review, and CodeQL are CI-only. After the wave's last merge, the push CI on `main` must be green too. Each round takes about 2 min, mostly CodeQL.

## Strict vs lax

- `npm test` is lax. It skips the coverage thresholds, docs drift, docs build, and package check, all of which CI requires. `npm run test:coverage` is the threshold-free twin of `test:coverage:check`. Gate only on `npm run validate`.
- A bare `node --test` without a build tests a stale `dist/`.
- `npm install` can rewrite `package-lock.json`. Gates use `npm ci`.
- Local Node may be 22 while `.nvmrc` and CI's validate job use 24. A local green proves nothing about Node 24; only CI's Node 24 leg does.
