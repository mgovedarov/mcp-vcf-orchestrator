---
description: List VCF Automation deployments, optionally filter by name or project ID.
trigger: "list-deployments"
type: "prompt"
---

Use the `list-deployments` MCP tool to retrieve deployments. Optionally provide a `search` argument to match deployment names or keywords, or a `projectId` argument to filter by project ID.

**Example usage**

```json
{
  "search": "test"
}
```

or

```json
{
  "projectId": "my-project"
}
```

This will list all deployments matching the criteria.