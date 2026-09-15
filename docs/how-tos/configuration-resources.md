# Configuration And Resource How-Tos

## Create Runtime Configuration

Use configuration elements for runtime data that workflows should read without hard-coding.

Recommended sequence:

1. `list-categories(type: "ConfigurationElementCategory", filter: "Integrations")`
2. `create-configuration(..., confirm: true)`
3. `list-configurations(categoryId: "...", filter: "...")`
4. `get-configuration(id: "...")`

Avoid dumping sensitive values in docs, issue comments, or generated context. Prefer redaction when summarizing configuration attributes.

## Read Then Update An Attribute

Use this flow to change one plain attribute on an existing configuration element while keeping the rest.

```text
User: Show me the api-endpoints configuration, then point its region attribute at eu-west-1.
```

Recommended sequence:

1. `list-configurations(filter: "api-endpoints")`
2. `get-configuration(id: "...")`
3. `update-configuration(id: "...", expectedName: "api-endpoints", attributes: [...], confirm: false)` — the discovery pass. It names the element and the fields that will change, and reports any refusal, without touching the element.
4. The same call with `confirm: true`.
5. `get-configuration(id: "...")` to verify.

`get-configuration` prints attribute values, not the vRO type envelope they arrive in: a `string` attribute reads `"eu-west-1"`, an `Array/string` reads `["one"]`, an attribute vRO returned with no value reads `(no value)`, and a secure-typed value reads `[redacted]`. The values are JSON-encoded so that an empty string is visible as `""`, which means the quotes around a string belong to the rendering, not to the value.

That is the round-trip trap. `update-configuration` takes each attribute `value` as a plain string and stores it verbatim, so send `eu-west-1`, not `"eu-west-1"`. The quoted form stores the quote characters as part of the value, and the next `get-configuration` shows it as `"\"eu-west-1\""`.

`attributes` replaces the whole set. Re-send every attribute you want to keep, each with its `name` and `type`, and pass an empty array only to clear them deliberately. Secure values cannot be read back and must be supplied fresh; a secure-typed attribute sent without a `value` is refused rather than stored as an empty secret. The full rules, including what an omitted `attributes` does, are under `update-configuration` in the [tools reference](../reference/tools.md#update-configuration).

## Import Resource Files

Resource element imports read local files from the configured resource artifact directory.

Recommended sequence:

1. Put the file under `VCFA_RESOURCE_DIR` or `VCFA_ARTIFACT_DIR/resources`.
2. `list-categories(type: "ResourceElementCategory", filter: "Assets")`
3. `import-resource-element(categoryId: "...", fileName: "portal-logo.png", confirm: true)`
4. `list-resource-elements(filter: "portal-logo")`

## Update Shared Runtime Data

To rotate a value or replace a shared binary resource:

1. `list-configurations(categoryId: "...", filter: "...")` or `list-resource-elements(filter: "...")`
2. `update-configuration(..., confirm: true)` or `update-resource-element(..., confirm: true)`
3. Re-read the object to verify the change.

For a configuration element, follow [Read Then Update An Attribute](#read-then-update-an-attribute): read the current attributes first, and send plain values rather than the quoted rendering.
