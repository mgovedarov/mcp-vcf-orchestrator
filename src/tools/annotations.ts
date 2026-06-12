/**
 * Shared MCP tool annotation for operations that overwrite or delete live
 * VCFA/vRO state (imports with overwrite semantics, updates, deletes, and
 * workflow/deployment-action executions). Hosts may use `destructiveHint`
 * to require heightened confirmation before invoking these tools.
 */
export const DESTRUCTIVE_LIVE_WRITE = {
  readOnlyHint: false,
  destructiveHint: true,
} as const;
