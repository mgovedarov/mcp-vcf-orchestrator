# Configuration And Resource How-Tos

## Create Runtime Configuration

Use configuration elements for runtime data that workflows should read without hard-coding.

Recommended sequence:

1. `list-categories(type: "ConfigurationElementCategory", filter: "Integrations")`
2. `create-configuration(...)`
3. `list-configurations(filter: "...")`
4. `get-configuration(id: "...")`

Avoid dumping sensitive values in docs, issue comments, or generated context. Prefer redaction when summarizing configuration attributes.

## Import Resource Files

Resource element imports read local files from the configured resource artifact directory.

Recommended sequence:

1. Put the file under `VCFA_RESOURCE_DIR` or `VCFA_ARTIFACT_DIR/resources`.
2. `list-categories(type: "ResourceElementCategory", filter: "Assets")`
3. `import-resource-element(categoryId: "...", fileName: "portal-logo.png", confirm: true)`
4. `list-resource-elements(filter: "portal-logo")`

## Update Shared Runtime Data

To rotate a value or replace a shared binary resource:

1. `list-configurations(filter: "...")` or `list-resource-elements(filter: "...")`
2. `update-configuration(...)` or `update-resource-element(..., confirm: true)`
3. Re-read the object to verify the change.
