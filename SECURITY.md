# Security Policy

`mcp-vcf-orchestrator` is an MCP server that brokers credentials into VCF Automation
Orchestrator, Service Broker, and Cloud Assembly environments, and its write tools
provision and destroy real infrastructure. Security reports are welcome and taken
seriously.

## Supported versions

Only the most recently published release on npm receives security fixes. Older
versions are not patched; upgrade to the current release before reporting an issue
that may already be fixed. Released versions are listed in
[the changelog](https://github.com/mgovedarov/mcp-vcf-orchestrator/blob/main/CHANGELOG.md).

## Reporting a vulnerability

**Please do not open a public issue, discussion, or pull request for a security
problem.** Use GitHub's private vulnerability reporting, which is enabled on this
repository:

- [Report a vulnerability](https://github.com/mgovedarov/mcp-vcf-orchestrator/security/advisories/new)

That channel is private between you and the maintainer until an advisory is
published.

### What to include

- The package version, and whether the target platform is VCF Automation or vRA/vRO 8.
- The MCP client in use.
- The tool, prompt, or resource involved.
- Steps to reproduce, and what you expected instead.
- Relevant log output **with secrets removed**.

### What never to include

Do not put credentials, tokens, session cookies, private keys, environment hostnames,
IP addresses, or organization names in a report. A redacted description is always
sufficient to start the conversation. If a reproduction genuinely depends on such a
value, say so and it will be arranged privately.

## Response expectations

This project is maintained by one person, as time allows. Reports are acknowledged on
a best-effort basis; no response or remediation time is guaranteed. Reports that
include a clear reproduction are handled fastest. If you have not heard back and the
issue is serious, a follow-up comment on the private advisory is welcome.

## How this server handles credentials

Understanding this may help you judge whether a finding is in scope.

- Credentials are supplied through environment variables at startup and are not
  written to the repository, to the artifact directories, or to any configuration
  file the server manages.
- Authentication tokens obtained from the platform are held for the life of the
  process and are used only against the configured hosts.
- The project's documented convention is that tool output, logs, tests, and docs
  must not echo configuration attribute values, scripts embedding credentials,
  tokens, passwords, or private keys. Prefer names, IDs, types, and redacted
  summaries.
- Local artifact tools confine file access to the configured artifact directories
  and reject absolute paths, traversal, and symlinks.
- Mutating tools require an explicit confirmation flag and support expected-target
  guards that are checked against live metadata before a write.

A defect in any of the above is a security defect, not a feature request.

## In scope

- Leakage of credentials, tokens, or secret-bearing values into tool output, logs,
  or artifacts.
- Escaping the artifact directory confinement, including via traversal or symlinks.
- Bypassing the confirmation flag or the expected-target guards on a mutating tool.
- TLS handling defects, including incorrect certificate verification when
  verification has not been explicitly disabled.
- Supply-chain issues in the published package or its dependencies.

## Out of scope

- Vulnerabilities in VCF Automation, vRA, or vRO themselves. Report those to the
  vendor.
- Misconfiguration of the operator's own environment, including deliberately
  disabling TLS verification, which is documented as a lab-only setting.
- Anything requiring pre-existing administrative access to the machine running the
  server, which already exposes the environment variables directly.
- Destructive outcomes from a mutating tool that was invoked with confirmation. The
  tools are designed to perform those actions.
- Missing hardening that is documented as a known limitation.

## Testing guidance

Do not test against production VCF Automation environments. The write tools create
and delete real workflows, actions, deployments, and packages. Use a disposable lab
and disposable assets.

## Disclosure

Fixes are released and an advisory is published once a fix is available. Reporters
are credited in the advisory unless they ask not to be.
