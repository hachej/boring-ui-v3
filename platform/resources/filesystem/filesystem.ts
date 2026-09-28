import type { ResourceRef } from "../../identity.js";
import { safeName, type EffectContext, type WriteCondition } from "../resource.js";

export type FileRef = ResourceRef & { kind: "file" };
export type FileAddress = Readonly<{ mount: string; path: string }>;
export type WriteInput = FileAddress & WriteCondition & { content: string };
export type RemoveInput = FileAddress & { expectedRevision: string };

/** Trusted, synchronous storage boundary. A remote provider needs its own commit-time admission protocol. */
export interface FilesystemProvider {
  stat(mount: string, path: string): FileRef | null;
  read(mount: string, path: string): { ref: FileRef; content: string };
  write(mount: string, path: string, content: string, options: WriteCondition & { context: EffectContext }): FileRef;
  remove(mount: string, path: string, options: { expectedRevision: string; context: EffectContext }): FileRef;
  /** The address a ref issued by this provider names, or null when the ref is foreign. Identity only; it grants nothing. */
  address(ref: ResourceRef): FileAddress | null;
}

/** Accept only canonical relative paths, so policy and storage use exactly the same address. */
export const safeRelativePath = safeName;
/** A mount is a grant space. The prefix keeps mounts and record kinds apart whatever they are named. */
export const fileSpace = (mount: string): string => `file:${mount}`;
