/**
 * The subset of JSON schema a page command declares (object, string, number, integer, boolean, array,
 * enum, required, nested objects). The bridge checks a request's input against it before the page's
 * handler runs (CHAT-3); the runtime checks the same schema before the request is even made.
 */
export type Schema = Readonly<Record<string, unknown>>;

export function validateInput(schema: Schema, value: unknown, at = "input"): string[] {
  const errors: string[] = [];
  const type = schema.type as string | undefined;
  if (Array.isArray(schema.enum)) { if (!schema.enum.some(v => v === value)) errors.push(`${at} must be one of ${schema.enum.map(v => JSON.stringify(v)).join(", ")}`); return errors; }
  if (type === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [`${at} must be an object`];
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    const record = value as Record<string, unknown>;
    for (const key of (schema.required as string[] | undefined) ?? []) if (record[key] === undefined) errors.push(`${at}.${key} is required`);
    for (const [key, sub] of Object.entries(properties)) if (record[key] !== undefined) errors.push(...validateInput(sub, record[key], `${at}.${key}`));
    if (schema.additionalProperties === false) for (const key of Object.keys(record)) if (!(key in properties)) errors.push(`${at}.${key} is not allowed`);
    return errors;
  }
  if (type === "array") {
    if (!Array.isArray(value)) return [`${at} must be an array`];
    if (schema.items) value.forEach((item, i) => errors.push(...validateInput(schema.items as Schema, item, `${at}[${i}]`)));
    return errors;
  }
  if (type === "string" && typeof value !== "string") errors.push(`${at} must be a string`);
  if ((type === "number" || type === "integer") && (typeof value !== "number" || Number.isNaN(value) || (type === "integer" && !Number.isInteger(value)))) errors.push(`${at} must be a${type === "integer" ? "n integer" : " number"}`);
  if (type === "boolean" && typeof value !== "boolean") errors.push(`${at} must be a boolean`);
  return errors;
}
