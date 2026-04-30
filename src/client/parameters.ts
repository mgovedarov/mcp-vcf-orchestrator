export function toVroParameters(
  params: { name: string; type: string; value?: string }[]
): { name: string; type: string; value?: Record<string, { value: string }> }[] {
  return params.map((p) => ({
    name: p.name,
    type: p.type,
    value: p.value !== undefined ? { [p.type]: { value: p.value } } : undefined,
  }));
}
