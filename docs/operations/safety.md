# Safety

Tools fall into three categories:

- **Read-only discovery** (`readOnlyHint: true`): list, get, preflight, and diff tools. They do not write local files or mutate live VCFA/vRO state. `get-workflow-execution-logs` is also read-only by default; it only writes a local file when the optional `fileName` parameter is provided.
- **Local artifact writes** (`readOnlyHint: false`, no `confirm` required): export, scaffold, and snapshot tools — for example `export-workflow-file`, `export-action-file`, `export-configuration-file`, `export-resource-element`, `export-package`, `export-project-package`, `scaffold-workflow-file`, `collect-context-snapshot`, and `prepare-artifact-promotion`. These write files under configured artifact directories and default `overwrite` to `false`. They do not mutate live VCFA/vRO state.
- **Live VCFA/vRO mutations** (`readOnlyHint: false`, `confirm: true` required): create, update, import, delete, run, and deployment day-2 action tools. Treat every live write operation as an environment change. Tools that overwrite or delete live state — import, update, run, and delete tools, plus `rebuild-project-package` — additionally set `destructiveHint: true` so hosts can require heightened approval; additive creates and `add-*-to-project-package` tools do not.

## Confirmation Required

These operations should be performed only after explicit user confirmation:

- creating or updating live workflows, actions, configurations, templates, subscriptions, deployments, or packages
- running workflows, because workflow execution may change the target environment
- importing workflows, actions, configurations, packages, or resource elements
- deleting workflows, actions, configurations, resource elements, packages, templates, deployments, or subscriptions
- running deployment day-2 actions

## Two-Phase Target Confirmation

For high-risk live mutations, prefer a two-phase flow:

1. Discover the live target with the matching list/get tool or prepare the artifact with `prepare-artifact-promotion`.
2. Confirm the exact target and impact with the user.
3. Pass `confirm: true` plus supported expected target fields such as `expectedName`, `expectedWorkflowName`, `expectedInputNames`, `expectedCategoryId`, `expectedCategoryName`, `expectedPackageName`, `expectedDeploymentName`, `expectedActionName`, `expectedEventTopicId`, or `expectedRunnableId`.
4. Verify with a read-only get/list call after mutation.

Expected fields are optional for backward compatibility. When provided, the handler fetches current live metadata before the mutation and refuses if any expected value does not match. Direct imports remain available for narrow validation and one-off tests, but package-first promotion with preflight, diff, backup, expected fields, and post-change verification is safer for reusable content.

## Artifact Path Safety

Artifact file tools require plain file names under configured artifact directories. They reject:

- absolute paths
- path separators
- traversal such as `../`
- unsafe symlink import sources
- unsafe symlink export targets
- existing export targets unless `overwrite: true`

Export and snapshot tools default `overwrite` to `false`. Pass `overwrite: true` explicitly when replacing an existing local artifact.

## Secrets

Configuration values and workflow/action scripts may contain sensitive information. When summarizing output:

- avoid printing passwords, API tokens, and private keys
- redact sensitive configuration attribute values
- prefer names, types, IDs, and descriptions over raw values

API error messages are sanitized before being surfaced to MCP callers. Only safe diagnostic fields — HTTP status, endpoint, `message`, `statusCode`, `code`, `error`, and `errors` — are included. Raw response bodies are never passed through verbatim, which prevents vRO error responses from echoing sensitive request content such as credentials or tokens.

## Token Refresh

If a request receives a `401` response — or, on the default VCFA platform, a `403` — the server invalidates the token that request used, re-authenticates, and retries the request exactly once. Only that token is invalidated: a `401` whose token a concurrent request has already replaced reuses the fresh one instead of forcing another login. This covers JSON API calls, binary exports, and multipart uploads. A second consecutive failure after re-authentication is surfaced as an error without further retry.

On the default VCFA platform re-authentication repeats the Cloud API session login. In `vra8` mode it exchanges the cached refresh token at `/iaas/api/login` and repeats the full vIDM CSP login only when that refresh token is rejected, so renewing a token does not re-send the password. A `403` in `vra8` mode is retried only when it carries a `WWW-Authenticate` challenge: an expired vRA 8 token answers with `401`, while a `403` from `/vco/api` means the vIDM user lacks the vRO permission, which no amount of re-authentication changes. Neither `vra8` login request follows redirects — the request body carries the credentials, and a `307`/`308` would forward it to the redirect target — so a redirect is reported as a login failure naming that host.

## Destructive Operations

Before deletion, confirm:

- object type
- object ID
- display name
- project/category/package context
- expected impact

For subscriptions, disabling is often safer than deleting during testing.

## Discovery Guardrail

Do not invent environment-specific values. If discovery does not return a required category, action, workflow, project, template, parameter, return type, or schema detail, stop and report the missing fact.

## Live Validation

Keep local repository validation separate from live VCFA validation. `npm run validate` should not contact VCFA.

Use the [live smoke-test checklist](./live-smoke-tests.md) when validating the MCP server against a real sandbox or disposable environment. Live smoke checks may use read-only list/get tools, harmless workflow execution, local artifact exports, and controlled package-first validation. Imports, deletes, deployment day-2 actions, subscription changes, template creation, and package promotion require explicit confirmation and disposable test assets.
