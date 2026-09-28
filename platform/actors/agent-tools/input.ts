import type { WriteCondition } from "../../resources/resource.js";

/** Model-supplied tool input is untrusted: shape is checked here, authority is checked by the admitted operation. */
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("tool input must be an object");
  return value as Record<string, unknown>;
}
export function string(input: Record<string, unknown>, key: string): string {
  if (typeof input[key] !== "string") throw new Error(`${key} must be a string`);
  return input[key];
}
/** `{ create: true }` or `{ expected_revision }`, never both, never neither. */
export function writeCondition(input: Record<string, unknown>): WriteCondition {
  if (input.create !== undefined && typeof input.create !== "boolean") throw new Error("create must be a boolean");
  if (input.create === true && input.expected_revision !== undefined) throw new Error("create cannot carry an expected revision");
  return input.create === true ? { create: true } : { expectedRevision: string(input, "expected_revision") };
}
export const conditionSchema = {
  create: { type: "boolean", description: "true to create; the address must not exist" },
  expected_revision: { type: "string", description: "the revision you observed; required unless create is true" }
} as const;
