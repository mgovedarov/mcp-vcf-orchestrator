# Source: GitHub issues

Issues live in the public repo `mgovedarov/mcp-vcf-orchestrator` and are read with the `gh` CLI. Every comment is public, so sanitize it as `.agents/commands/issue.md` step 2 says.

## Select

In scope: open issues titled `[VCFO-###] …`, oldest first. Skip any issue labeled `question`, `help wanted`, `wontfix`, `duplicate`, or `invalid`. Replace `10` with the run limit:

```sh
gh issue list --state open --limit 100 \
  --search 'in:title VCFO sort:created-asc -label:question -label:"help wanted" -label:wontfix -label:duplicate -label:invalid' \
  --json number,title,labels -q '[.[] | select(.title | test("^\\[VCFO-[0-9]+\\]"))] | .[:10]'
```

Also skip any issue that an open PR already closes. That issue is in flight. An issue whose PR was closed without merging comes back.

```sh
gh pr list --state open --limit 100 --json number,closingIssuesReferences -q '[.[] | {pr: .number, closes: [.closingIssuesReferences[].number]}]'
```

## Operations

| Op | How |
|---|---|
| Read | `gh issue view <n> --json number,title,body,labels,comments,closedByPullRequestsReferences` |
| Claim | No label. The PR body's `Closes #N.` links the issue, and the in-flight check keeps it out of later runs while that PR is open. Never run two loops at once. |
| Comment | `gh issue comment <n> --body-file <file>`. The body starts with `**Processing loop:**`. Write the file in a temp dir and delete it afterwards. |
| Park | `gh issue edit <n> --add-label question` |
| Close | Never close by hand. Squash-merging the PR into `main` closes the issue; confirm with `gh issue view <n> --json state`. |

## Write-back

- **PR opened:** comment `**Processing loop:** implementation in #<pr>.`
- **Human-needed** (triage, a role's `HUMAN-NEEDED`, or out of review rounds): comment the sanitized reason and the PR if there is one, then Park. The issue comes back once a human removes `question` and no open PR closes it. A human either finishes the loop's PR or closes it.
- **Blocked by another open issue:** comment `blocked by #<m>` and add no label, so the issue comes back next run.
- **Merged:** confirm the issue closed. If it didn't, report it.
- Never repeat a comment that the issue already carries word for word from an earlier run.
