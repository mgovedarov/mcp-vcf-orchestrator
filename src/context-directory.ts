import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export interface ContextDirectoryClient {
  getContextDirectory(): string;
}

export async function resolveEffectiveContextDirectory(
  server: McpServer,
  client: ContextDirectoryClient,
): Promise<string> {
  if (process.env["VCFA_CONTEXT_DIR"]) return client.getContextDirectory();

  const workspaceDir = await resolveWorkspaceContextDirectory(server);
  return workspaceDir ?? client.getContextDirectory();
}

async function resolveWorkspaceContextDirectory(
  server: McpServer,
): Promise<string | undefined> {
  try {
    const result = await server.server.listRoots();
    const root = result.roots.find((candidate) =>
      candidate.uri.startsWith("file://"),
    );
    if (!root) return undefined;
    return join(fileURLToPath(root.uri), "artifacts", "context");
  } catch {
    return undefined;
  }
}
