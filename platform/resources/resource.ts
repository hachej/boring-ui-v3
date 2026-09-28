import type { ResourceRef } from "../identity.js";

export function assertResourceRef(ref: ResourceRef): void {
  if (!ref || ![ref.kind, ref.id, ref.revision].every(value => typeof value === "string" && value.length > 0)) {
    throw new Error("a versioned Resource reference is required");
  }
}
export function sameRef(a: ResourceRef, b: ResourceRef): boolean {
  return a.kind === b.kind && a.id === b.id && a.revision === b.revision;
}

/** Attribution every accepted effect carries; issued by admission, never by payload. */
export type EffectContext = Readonly<{ environmentId: string; jobId: string; actorId: string; actorKind: string }>;

/** The mutation contract every authoritative Resource kind shares: explicit create, or the observed revision. */
export type WriteCondition = { create: true; expectedRevision?: never } | { create?: false; expectedRevision: string };
export function assertWriteCondition(input: WriteCondition): void {
  if (input.create === true) {
    if (input.expectedRevision !== undefined) throw new Error("create cannot carry an expected revision");
  } else if ((input.create !== undefined && input.create !== false) || typeof input.expectedRevision !== "string" || !input.expectedRevision) {
    throw new Error("update requires expectedRevision");
  }
}
export function assertExpectedRevision(input: { expectedRevision: unknown }, operation: string): void {
  if (typeof input.expectedRevision !== "string" || !input.expectedRevision) throw new Error(`${operation} requires expectedRevision`);
}

/** Canonical relative names: policy and storage address the same thing, and no segment can escape its space. */
export function safeName(value: unknown): string | null {
  if (typeof value !== "string" || !value || /[\\\x00*]/.test(value)) return null;
  return value.split("/").some(part => !part || part === "." || part === "..") ? null : value;
}
