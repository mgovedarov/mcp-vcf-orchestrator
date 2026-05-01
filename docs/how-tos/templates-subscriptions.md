# Templates And Subscriptions How-Tos

## Review And Create Blueprint Templates

Start from existing Cloud Assembly templates when possible.

```text
User: Show me the current Ubuntu template YAML, then create a starter template.
```

Recommended sequence:

1. `list-templates(search: "Ubuntu")`
2. `get-template(id: "<ubuntu-template-id>")`
3. Draft YAML using discovered resource types, inputs, and project conventions.
4. `create-template(name: "...", projectId: "...", content: "...")`
5. `get-template(id: "<new-template-id>")`

Do not invent provider-specific YAML properties. If no reliable example or user-provided schema exists, report the missing facts.

## Wire A Workflow To An Event Topic

Use subscriptions to connect Event Broker topics to vRO workflows or ABX actions.

```text
User: Run the workflow "Post-Provision Hardening" whenever compute provisioning completes.
```

Recommended sequence:

1. `list-event-topics()`
2. `list-workflows(filter: "Post-Provision Hardening")`
3. `create-subscription(...)`
4. `list-subscriptions()` or `get-subscription(id: "...")`

If blocking behavior matters, verify the event topic supports it before setting `blocking: true`.

## Disable Instead Of Delete

For temporary testing, prefer `update-subscription(id: "...", disabled: true)` over `delete-subscription`. Delete only when the hook is no longer needed.
