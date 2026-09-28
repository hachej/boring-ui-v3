/**
 * The JSON-schema subset the platform enforces itself, for declarations that arrive as data (an app's tool inputs).
 * A declaration using any other keyword is refused, so a schema can never promise more than this checks.
 */
export type Schema = Readonly<{
  type?: "string" | "number" | "boolean" | "null" | "object" | "array";
  enum?: readonly (string | number | boolean | null)[];
  properties?: Readonly<Record<string, Schema>>;
  required?: readonly string[];
  /** false forbids undeclared keys; a schema validates every undeclared value; absent allows anything. */
  additionalProperties?: boolean | Schema;
  items?: Schema;
}>;

const TYPES = ["string", "number", "boolean", "null", "object", "array"] as const;

/** Rejects a schema the validator would not fully enforce, so a kind cannot promise more than it checks. */
export function assertSchema(schema: unknown, at = "schema"): asserts schema is Schema {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new Error(`${at}: must be an object`);
  const s = schema as Record<string, unknown>;
  for (const key of Object.keys(s)) if (!["type", "enum", "properties", "required", "additionalProperties", "items"].includes(key)) throw new Error(`${at}: unsupported keyword ${key}`);
  if (s.type !== undefined && !TYPES.includes(s.type as never)) throw new Error(`${at}: unknown type`);
  if (s.enum !== undefined && (!Array.isArray(s.enum) || !s.enum.length || s.enum.some(v => v !== null && !["string", "number", "boolean"].includes(typeof v)))) throw new Error(`${at}: enum must list scalars`);
  if (s.required !== undefined && (!Array.isArray(s.required) || s.required.some(k => typeof k !== "string"))) throw new Error(`${at}: required must list keys`);
  if (s.properties !== undefined) {
    if (!s.properties || typeof s.properties !== "object" || Array.isArray(s.properties)) throw new Error(`${at}: properties must be an object`);
    for (const [key, value] of Object.entries(s.properties)) assertSchema(value, `${at}.${key}`);
  }
  if (s.additionalProperties !== undefined && typeof s.additionalProperties !== "boolean") assertSchema(s.additionalProperties, `${at}.additionalProperties`);
  if (s.items !== undefined) assertSchema(s.items, `${at}.items`);
}

function typeOf(value: unknown): Schema["type"] {
  return value === null ? "null" : Array.isArray(value) ? "array" : typeof value === "object" ? "object" : typeof value === "string" ? "string" : typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : undefined;
}

/** Throws the first violation with its JSON path; a passing value is unchanged. */
export function validate(schema: Schema, value: unknown, at = "$"): void {
  const actual = typeOf(value);
  if (actual === undefined) throw new Error(`${at}: not JSON`);
  if (schema.type !== undefined && actual !== schema.type) throw new Error(`${at}: expected ${schema.type}, got ${actual}`);
  if (schema.enum !== undefined && !schema.enum.includes(value as never)) throw new Error(`${at}: not one of ${schema.enum.map(v => JSON.stringify(v)).join(", ")}`);
  if (actual === "object") {
    const record = value as Record<string, unknown>;
    for (const key of schema.required ?? []) if (!(key in record)) throw new Error(`${at}.${key}: required`);
    for (const [key, item] of Object.entries(record)) {
      const declared = schema.properties?.[key];
      if (declared) validate(declared, item, `${at}.${key}`);
      else if (schema.additionalProperties === false) throw new Error(`${at}.${key}: not allowed`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === "object") validate(schema.additionalProperties, item, `${at}.${key}`);
    }
  }
  if (actual === "array" && schema.items) (value as unknown[]).forEach((item, index) => validate(schema.items!, item, `${at}[${index}]`));
}
