# Safety

The server includes read-only discovery tools and write-capable tools. Treat every live write operation as an environment change.

## Confirmation Required

These operations should be performed only after explicit user confirmation:

- creating or updating live workflows, actions, configurations, templates, subscriptions, deployments, or packages
- running workflows, because workflow execution may change the target environment
- importing workflows, actions, configurations, packages, or resource elements
- deleting workflows, actions, configurations, resource elements, packages, templates, deployments, or subscriptions
- running deployment day-2 actions
- overwriting local artifact export targets

## Artifact Path Safety

Artifact file tools require plain file names under configured artifact directories. They reject:

- absolute paths
- path separators
- traversal such as `../`
- unsafe symlink import sources
- unsafe symlink export targets
- existing export targets unless `overwrite: true`

## Secrets

Configuration values and workflow/action scripts may contain sensitive information. When summarizing output:

- avoid printing passwords, API tokens, and private keys
- redact sensitive configuration attribute values
- prefer names, types, IDs, and descriptions over raw values

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

Keep local repository validation separate from live VCFA validation. `npm run validate` should not contact VCFA. Live smoke checks may use read-only list/get tools against a sandbox environment, but imports, deletes, deployment day-2 actions, subscription changes, and template creation require explicit confirmation and disposable test assets.
