# MCP Client Setup

Both clients below hand the server its settings through `env`. The blocks show the four required variables and `VCFA_IGNORE_TLS`; the full table, including the platform selector and the artifact directories, is in [Configuration](./configuration.md).

## VS Code

Add the server to your VS Code `settings.json`:

```jsonc
{
  "mcp": {
    "servers": {
      "vcfa": {
        "command": "npx",
        "args": ["-y", "@mgovedarov/mcp-vcf-orchestrator"],
        "env": {
          "VCFA_HOST": "vcfa.example.com",
          "VCFA_USERNAME": "administrator",
          "VCFA_ORGANIZATION": "vsphere.local",
          "VCFA_PASSWORD": "your-password",
          "VCFA_IGNORE_TLS": "false"
          // External vRO appliance only: uncomment the next line and add a comma to the line above.
          // "VCFA_VRO_HOST": "vro.example.com"
        }
      }
    }
  }
}
```

VS Code reads `settings.json` as JSONC, so the two comment lines can stay in place.

## Claude Desktop

Add the server to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "vcfa": {
      "command": "npx",
      "args": ["-y", "@mgovedarov/mcp-vcf-orchestrator"],
      "env": {
        "VCFA_HOST": "vcfa.example.com",
        "VCFA_USERNAME": "administrator",
        "VCFA_ORGANIZATION": "vsphere.local",
        "VCFA_PASSWORD": "your-password",
        "VCFA_IGNORE_TLS": "false"
      }
    }
  }
}
```

That file is strict JSON and does not accept comments, so the block above carries none. When the organization's vRO runs on its own appliance rather than embedded in the VCF Automation appliance, add `VCFA_VRO_HOST` to `env`; leave it out for the embedded vRO, which is the default. With the variable, the `env` object reads:

```json
{
  "VCFA_HOST": "vcfa.example.com",
  "VCFA_USERNAME": "administrator",
  "VCFA_ORGANIZATION": "vsphere.local",
  "VCFA_PASSWORD": "your-password",
  "VCFA_IGNORE_TLS": "false",
  "VCFA_VRO_HOST": "vro.example.com"
}
```

## External vRO Appliance

`VCFA_VRO_HOST` moves only the vRO `/vco/api` requests to that host. The login, the `GET /api/versions` probe, and the catalog, deployment, template, project, and event-broker services stay on `VCFA_HOST`, and the token issued there is reused as-is, so no second set of credentials is involved. Left unset in an environment whose vRO is external, every vRO tool fails with a `403` and an HTML body while the Automation-service tools keep working, and the error carries a hint naming this variable. The mechanism is described in [External vRO Appliance](./configuration.md#external-vro-appliance) and the failure signatures in [Troubleshooting](../operations/troubleshooting.md#external-vro-appliance).

## MCP Inspector

Build the project first, then inspect the server:

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
```
