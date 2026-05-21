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
