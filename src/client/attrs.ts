export interface Attribute {
  name: string;
  value: string;
}

export interface AttributeLink {
  href?: string;
  attribute?: Attribute[];
  attributes?: Attribute[];
}

/**
 * The vRO list endpoints return items where metadata is stored in an
 * `attributes: [{name, value}]` array rather than as direct properties.
 * This helper converts that array to a plain key/value object.
 */
export function parseAttrs(
  attrs: Attribute[] | undefined,
): Record<string, string> {
  const obj: Record<string, string> = {};
  for (const a of attrs ?? []) {
    obj[a.name] = a.value;
  }
  return obj;
}

export function getLinkAttrs(item: AttributeLink): Record<string, string> {
  return parseAttrs(item.attribute ?? item.attributes);
}
