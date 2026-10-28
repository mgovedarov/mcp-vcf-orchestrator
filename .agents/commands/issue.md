# Command: issue

File one GitHub issue (`gh`, public repo `mgovedarov/mcp-vcf-orchestrator`) from a seed brief.

## Input

A seed brief: the bug, gap, or idea, plus any evidence the reporter has.

## Steps

1. **Research.** Find the implicated code and quote the load-bearing lines with `path:line`. Read the lines; don't infer from names. Note what the evidence does not establish.
2. **Sanitize.** Run `gh repo view --json visibility`.
   - Replace hostnames, IPs, organization or tenant names, usernames, and customer identifiers with placeholders such as `vcfa.example.com`.
   - Never include tokens, passwords, or configuration attribute values.
3. **Duplicates.** Run `gh issue list --state open --limit 300 --json number,title`, then `gh issue list --state all --search "<keywords> in:title" --json number,title,state`. On a match, stop and return `DUPLICATE <n> <title>`.
4. **Code.** The next code is the highest `VCFO-###` in any issue or PR title, plus one:
   ```sh
   { gh issue list --state all --limit 1000 --json title -q '.[].title'; gh pr list --state all --limit 1000 --json title -q '.[].title'; } | grep -oE 'VCFO-[0-9]+' | sort -t- -k2 -n | tail -1
   ```
   Codes don't follow issue numbers, so never derive a code from `#<n>`.
5. **Write.** House style follows the repo's best issues (#230, #220, #223):
   - Title: `[VCFO-###] <the problem stated as a fact>`
   - `## Summary`: 2-4 sentences on what happens today and why it matters.
   - `## Evidence`: quoted code with `path:line`, and sanitized command output or wire logs in fenced blocks.
   - `## Why it matters`: 2-4 bullets on the gap or harm.
   - `## Proposed implementation`:
     - A suggestion, not a decree.
     - Numbered options with a stated preference and the tradeoffs of each.
     - `path:line` entry points, and the files or dirs it will touch.
   - `## Acceptance criteria`: observable outcomes, as bullets.
   - `## Scope`: what the evidence covers, what it does not establish, and what is out of scope.
6. **Labels.** Use only labels that `gh label list` shows; most issues carry none. Add one only when it clearly fits, for example `bug`, `enhancement`, `documentation`, `vcfa`, or `vRO`.
7. **File.** Re-run the step 4 command first. If the highest code has moved since step 4, take the next code after it and fix the title, because another filing took yours. Write the body to a file in a temp dir. Run `gh issue create --title "<title>" --body-file <file>`, then delete the file.

## Output

```text
Filed #<n> — <title> → <url>
<one sentence: what the issue asks for>
```

Filing ends here. Never start implementation, create a branch, or comment.
