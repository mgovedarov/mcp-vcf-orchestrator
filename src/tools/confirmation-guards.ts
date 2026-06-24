import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface ExpectedField {
  label: string;
  expected?: unknown;
  actual?: unknown;
}

export function hasExpectedValue(value: unknown): boolean {
  return value !== undefined;
}

export function hasAnyExpectedValue(
  values: Record<string, unknown | undefined>,
): boolean {
  return Object.values(values).some(hasExpectedValue);
}

export function guardExpectedFields(
  target: string,
  fields: ExpectedField[],
): CallToolResult | undefined {
  const mismatches = fields.filter(
    (field) =>
      hasExpectedValue(field.expected) && field.actual !== field.expected,
  );

  if (mismatches.length === 0) {
    return undefined;
  }

  const lines = mismatches.map(
    (field) =>
      `• ${field.label}: expected ${formatGuardValue(field.expected)}, found ${formatGuardValue(field.actual)}`,
  );

  return {
    content: [
      {
        type: "text",
        text: [
          `Target confirmation failed for ${target}.`,
          "",
          ...lines,
          "",
          "No live mutation was performed. Re-run discovery and pass expected fields that match the current target before confirming again.",
        ].join("\n"),
      },
    ],
    isError: true,
  };
}

export function guardExpectedStringList(
  target: string,
  label: string,
  expected: string[] | undefined,
  actual: string[],
): CallToolResult | undefined {
  if (expected === undefined) {
    return undefined;
  }

  if (arraysEqual(expected, actual)) {
    return undefined;
  }

  return {
    content: [
      {
        type: "text",
        text: [
          `Target confirmation failed for ${target}.`,
          "",
          `• ${label}: expected ${formatGuardValue(expected)}, found ${formatGuardValue(actual)}`,
          "",
          "No live mutation was performed. Re-run discovery and pass expected fields that match the current target before confirming again.",
        ].join("\n"),
      },
    ],
    isError: true,
  };
}

export function appendGuardGuidance(text: string): string {
  return `${text}\n\nSafety note: for two-phase confirmation, run discovery or prepare-artifact-promotion first and pass expected target fields such as expectedName, expectedCategoryName, or expectedPackageName before confirming live mutations.`;
}

export async function guardExpectedCategory(
  target: string,
  categoryType: string,
  categoryId: string,
  expectedCategoryName: string | undefined,
  listCategories: (
    categoryType: string,
    filter?: string,
  ) => Promise<{ link?: { id?: string; name?: string }[] }>,
): Promise<CallToolResult | undefined> {
  if (!hasExpectedValue(expectedCategoryName)) {
    return undefined;
  }

  const categories = (await listCategories(categoryType, expectedCategoryName))
    .link;
  const category = categories?.find((candidate) => candidate.id === categoryId);
  return guardExpectedFields(target, [
    {
      label: "category name",
      expected: expectedCategoryName,
      actual: category?.name,
    },
  ]);
}

/**
 * Verify an action import target against live state. Action modules are not vRO
 * categories (the ActionCategory type returns nothing from list-categories), so
 * the only live signal is the set of modules already present in list-actions.
 *
 * When `expectedModuleName` is supplied this both (a) rejects a mismatch against
 * the caller-supplied `moduleName` and (b) reports whether the module already
 * exists live. A not-yet-existing module is not an error — vRO creates the module
 * on import — but the caller should surface that a new module will be created.
 */
export async function guardExpectedActionModule(
  target: string,
  moduleName: string,
  expectedModuleName: string | undefined,
  listActions: () => Promise<{
    link?: { module?: string }[];
    truncated?: boolean;
  }>,
): Promise<{ guard?: CallToolResult; moduleIsNew: boolean }> {
  if (!hasExpectedValue(expectedModuleName)) {
    return { moduleIsNew: false };
  }

  const mismatch = guardExpectedFields(target, [
    { label: "module name", expected: expectedModuleName, actual: moduleName },
  ]);
  if (mismatch) {
    return { guard: mismatch, moduleIsNew: false };
  }

  const actions = await listActions();
  const modules = new Set(
    (actions.link ?? [])
      .map((action) => action.module)
      .filter((module): module is string => typeof module === "string"),
  );
  // A truncated list can't prove a module is absent, so only claim "new" when the
  // full module set was observed.
  const moduleIsNew = !actions.truncated && !modules.has(moduleName);
  return { moduleIsNew };
}

function arraysEqual(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function formatGuardValue(value: unknown): string {
  if (value === undefined) return "(missing)";
  const json = JSON.stringify(value);
  return json === undefined ? String(value) : json;
}
