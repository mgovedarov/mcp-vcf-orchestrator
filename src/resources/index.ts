import { readFile } from "node:fs/promises";
import {
  ResourceTemplate,
  type McpServer,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ReadResourceResult } from "@modelcontextprotocol/sdk/types.js";
import type { VroClient } from "../vro-client.js";

const README_URL = new URL("../../README.md", import.meta.url);
const ARTIFACT_AUTHORING_URL = new URL(
  "../../docs/vro-artifact-authoring.md",
  import.meta.url,
);

function textResource(
  uri: string,
  mimeType: string,
  text: string,
): ReadResourceResult {
  return {
    contents: [{ uri, mimeType, text }],
  };
}

function jsonResource(uri: string, value: unknown): ReadResourceResult {
  return textResource(uri, "application/json", JSON.stringify(value, null, 2));
}

async function markdownFileResource(
  uri: URL,
  fileUrl: URL,
): Promise<ReadResourceResult> {
  const text = await readFile(fileUrl, "utf8");
  return textResource(uri.href, "text/markdown", text);
}

function singleVariable(
  variables: Record<string, string | string[]>,
  name: string,
): string {
  const value = variables[name];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

export function registerVcfaResources(
  server: McpServer,
  client: VroClient,
): void {
  server.registerResource(
    "vcfa-docs-artifact-authoring",
    "vcfa://docs/artifact-authoring",
    {
      title: "vRO Artifact Authoring Guide",
      description:
        "Repository guidance for authoring, validating, importing, and exporting vRO artifacts.",
      mimeType: "text/markdown",
    },
    (uri) => markdownFileResource(uri, ARTIFACT_AUTHORING_URL),
  );

  server.registerResource(
    "vcfa-docs-readme",
    "vcfa://docs/readme",
    {
      title: "VCFA MCP Server README",
      description:
        "Top-level README for available VCFA MCP server tools, examples, and configuration.",
      mimeType: "text/markdown",
    },
    (uri) => markdownFileResource(uri, README_URL),
  );

  server.registerResource(
    "vcfa-workflow",
    new ResourceTemplate("vcfa://workflows/{id}", { list: undefined }),
    {
      title: "VCFA Workflow",
      description: "Read a workflow definition by workflow ID.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      jsonResource(
        uri.href,
        await client.getWorkflow(singleVariable(variables, "id")),
      ),
  );

  server.registerResource(
    "vcfa-action",
    new ResourceTemplate("vcfa://actions/{id}", { list: undefined }),
    {
      title: "VCFA Action",
      description: "Read an action definition by action ID or fully qualified name.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      jsonResource(
        uri.href,
        await client.getAction(singleVariable(variables, "id")),
      ),
  );

  server.registerResource(
    "vcfa-deployment",
    new ResourceTemplate("vcfa://deployments/{id}", { list: undefined }),
    {
      title: "VCFA Deployment",
      description: "Read a deployment by deployment ID.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      jsonResource(
        uri.href,
        await client.getDeployment(singleVariable(variables, "id")),
      ),
  );

  server.registerResource(
    "vcfa-package",
    new ResourceTemplate("vcfa://packages/{name}", { list: undefined }),
    {
      title: "vRO Package",
      description: "Read package metadata by fully qualified package name.",
      mimeType: "application/json",
    },
    async (uri, variables) =>
      jsonResource(
        uri.href,
        await client.getPackage(singleVariable(variables, "name")),
      ),
  );
}
