/**
 * Shared MCP tool annotation for operations that overwrite or delete live
 * VCFA/vRO state (imports with overwrite semantics, updates, deletes, and
 * workflow/deployment-action executions), or that provision real
 * infrastructure. Hosts may use `destructiveHint` to require heightened
 * confirmation before invoking these tools.
 *
 * `create-deployment` is the one additive tool that carries this, and it is
 * deliberate rather than drift (VCFO-084). Provisioning is strictly neither an
 * overwrite nor a delete, so the taxonomy alone would exclude it; what decides
 * it is what the annotation *does*. It is a host-side elevated-approval gate,
 * and allocating billable compute, storage and address space is what such a
 * gate exists for. The premise behind excluding additive creates -- that they
 * are cheap and a delete restores the prior state exactly -- does not hold
 * here, because `delete-deployment` is itself a destructive day-2 operation
 * rather than an undo.
 */
export const DESTRUCTIVE_LIVE_WRITE = {
  readOnlyHint: false,
  destructiveHint: true,
} as const;
