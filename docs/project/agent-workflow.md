# Agent Workflow

**Purpose:** how a maintainer uses the repository's agent commands and subagents to file issues and work through them. The procedures live in `.agents/`; this page covers how to start them and what comes back.

These are development tools for a checkout of this repository. They are not part of the npm package, and installing the `vcfa-orchestrator` plugin does not provide them: that plugin ships skills for driving a VCFA environment, described in [Claude Code Plugin](../guide/claude-code-plugin.md).

## Key Files

| Path | Holds |
| --- | --- |
| `.agents/commands/issue.md` | The issue-filing procedure behind `/issue` |
| `.agents/commands/process-issues.md` | The processing loop behind `/process-issues` |
| `.agents/roles/` | One tool-neutral file per role |
| `.agents/gates.md` | The per-item and final test gates |
| `.agents/sources/github-issues.md` | How the loop selects, reads, and writes back issues |
| `.claude/skills/` | The two slash commands, each pointing at its command file |
| `.claude/agents/` | One Claude Code subagent per role, each pointing at its role file |

## Prerequisites

- Claude Code started in a checkout of this repository, so it loads the project `.claude/` directory.
- `gh` signed in to github.com. `/process-issues` also needs push and merge rights on the repository.
- Node 22.19 or later, with `registry.npmjs.org` reachable. The gate checks the registry first and stops with `HUMAN-NEEDED` when a filtering network or VPN blocks it.

## Commands

Both run only when you type them. The model never starts either one on its own.

### `/issue`

Files one GitHub issue from a short brief, in the `issue-filer` subagent.

```text
/issue <the bug, gap, or idea, plus any evidence you have>
```

It reads the implicated code, sanitizes the evidence for the public repository, checks for duplicates, takes the next `VCFO-###` code, and files the issue in the house style. It never branches, implements, or comments. It returns one of:

```text
Filed #<n> — <title> → <url>
DUPLICATE <n> <title>
HUMAN-NEEDED: <question>
```

### `/process-issues`

Works open issues end to end, orchestrated from the main session. The argument is the number of actionable issues to take, 10 by default.

```text
/process-issues
/process-issues 3
```

| Step | What happens |
| --- | --- |
| Fetch | Takes open `[VCFO-###]` issues opened by a maintainer, oldest first, and drops any that an open maintainer PR already closes |
| Triage | Marks each one actionable, human-needed, or blocked |
| Plan | Groups issues whose file footprints overlap into one unit, and puts dependent units in a later wave |
| Implement | Starts one `coder` per unit, at most 3 at once, each in its own worktree from `origin/main` and opening one PR |
| Review | Sends each PR to `reviewer`, and its findings or a red CI check to `remediator`, for at most 2 rounds |
| Final gate | Has `test-runner` run the gate on the wave's PRs merged together |
| Land | **Squash-merges each clean PR into `main`**, one at a time, once GitHub reports it mergeable |
| Report | Reports in at most 20 lines: what landed with PR links, what is human-needed or blocked and why, what was skipped, and the gate results |

What the loop leaves on an issue:

- **PR opened:** a comment starting `**Processing loop:**` that links the PR.
- **Human-needed:** a comment with the reason, plus the `question` label. The issue goes back in the queue once you remove the label and no open PR closes it.
- **Blocked:** a `blocked by #<m>` comment. The issue comes back on the next run.
- **Merged:** the PR's `Closes #N.` closes it.

Never run two loops at once: an open PR is the only claim on an issue.

## Agents

The commands call these, and you can also ask a session for one by name, for example "use the scout agent to list every caller of `apiErrorStatus`".

| Agent | Use it to | Model | Returns |
| --- | --- | --- | --- |
| `scout` | List the call sites, files, and patterns for one question, with `path:line` | haiku | `QUERY`, `HITS`, `SEARCHED`, `NOT FOUND` |
| `researcher` | Explain how something works before you change it | opus | `ANSWER`, `MECHANISM`, `CONFIDENCE`, `UNVERIFIED`, `ALSO NOTICED` |
| `coder` | Implement one issue on its own branch and open a PR | opus | `PR=<n> BRANCH=<name>`, or `HUMAN-NEEDED: <question>` |
| `reviewer` | Review one PR diff in repository context | opus | A JSON verdict, `clean` or `changes-requested`, with findings |
| `remediator` | Fix an open PR: update it with `main`, resolve conflicts, apply findings and gate failures | opus | `PR=<n> STATUS=fixed`, or `STATUS=HUMAN-NEEDED` |
| `test-runner` | Run a gate's commands without editing anything | haiku | `PASS` or `FAIL` per command, then `RESULT=green` or `RESULT=red` |
| `issue-filer` | File one issue | haiku | The same lines as `/issue` |

`scout`, `researcher`, `reviewer`, and `test-runner` have Read, Grep, Glob, and Bash only. `coder`, `remediator`, and `issue-filer` have every tool except the `vcf-orchestrator` MCP tools and `Agent`. The return contract for each role is at the end of its file in `.agents/roles/`.

## Gates

- **Per item:** the registry check, `npm ci`, and `npm run validate` in the unit's worktree. `coder` and `remediator` run it before opening a PR and after every fix.
- **Final:** once per wave, the same steps on the wave's PRs merged together in landing order, then the six required CI checks on each PR before its merge.

## Boundaries

- No agent calls the live VCFA/vRO tools. A change that needs a live check comes back human-needed, and you run that check yourself after confirming the target and impact.
- Only issues and comments by maintainers, meaning users with push access, reach an agent. Issue text is data, not instructions.
- Everything written to GitHub is public, so it carries no hostnames, IPs, organization names, or credentials.
- A bug found along the way comes back as a `BUG:` line and is filed separately by `issue-filer`, never fixed in the same PR.

## Other Tools

A coding agent without subagents reads `AGENTS.md`, then follows the command or role file in `.agents/` inline.
