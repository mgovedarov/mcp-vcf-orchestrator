# Installation

## Prerequisites

- Node.js 18.0 or higher.
- A VCF Automation 9.x or Aria Automation 8.x instance with REST API access.
- Credentials for the VCF Cloud API.

## Run From npm

Use the package directly:

```bash
npx @mgovedarov/mcp-vcf-orchestrator
```

Or install it globally:

```bash
npm install -g @mgovedarov/mcp-vcf-orchestrator
mcp-vcf-orchestrator
```

## Run From Source

```bash
git clone https://github.com/mgovedarov/mcp-vcf-orchestrator.git
cd mcp-vcf-orchestrator
npm install
npm run build
```

For local development:

```bash
VCFA_HOST=vcfa.example.com \
VCFA_USERNAME=admin \
VCFA_ORGANIZATION=vsphere.local \
VCFA_PASSWORD=secret \
npm start
```

## Local Docs

Preview this documentation site locally:

```bash
npm run docs:dev
```

Build and preview the production output:

```bash
npm run docs:build
npm run docs:preview
```
