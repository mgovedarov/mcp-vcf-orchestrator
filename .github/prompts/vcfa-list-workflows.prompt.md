---
description: List VCF Automation workflows, optionally filter by name substring.
trigger: "list-workflows"
type: "prompt"
---

Use the `list-workflows` MCP tool to retrieve workflow definitions. Optionally provide a `filter` argument to match workflow names.

**Example usage**

```json
{
  "filter": "backup"
}
```

This will list all workflows whose name contains "backup".