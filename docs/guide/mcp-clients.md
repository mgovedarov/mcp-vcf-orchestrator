# MCP Client Setup

## VS Code

Add the server to your VS Code `settings.json`:

```json
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
        }
      }
    }
  }
}
```

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

## MCP Inspector

Build the project first, then inspect the server:

```bash
npm run build
npx @modelcontextprotocol/inspector node dist/index.js
```
