/**
 * @boring/files — the file contract and its providers.
 *
 * A file lives under a mount. Everything that touches a file (the tree, the HTTP endpoints,
 * an agent's tools) goes through one FileProvider, so one law set covers every transport
 * (BORING-3). The contract is asynchronous because a provider may be a directory, a remote
 * repository or a sandbox (FILES-8).
 *
 * Mounts: an agent sees `/code` (the application's, read-only by default), `/workspace`
 * (the person's), `/shared` when the host offers it, and any attached mount `/mnt/<name>`.
 * The host builds the mount table; this package routes and confines (FILES-5).
 */

export { canonicalPath, parseAddress, formatAddress, isMountName, MOUNTS, attachedMount } from "./address.ts";
export { mountRouter, type MountTable } from "./mounts.ts";
export { memoryProvider, type MemoryProviderOptions } from "./memory.ts";
export { directoryProvider, snapshotDirectory, type DirectoryProviderOptions } from "./directory.ts";
export { githubProvider, type GithubProviderOptions } from "./github.ts";
export { readonly } from "./readonly.ts";
export { memoryReceipts, type ReceiptLog } from "./receipts.ts";

/** A canonical relative path inside one mount (FILES-5). */
export type FileAddress = Readonly<{ mount: string; path: string }>;

/** Identity plus the revision a read observed (FILES-1). Opaque strings; only equality matters. */
export type FileRef = Readonly<{ id: string; revision: string }>;

/** Who is acting, for the receipt (FILES-7). Issued by the host, never by a caller's payload. */
export type Effect = Readonly<{ actor: string; thread?: string; run?: string; tool?: string }>;

/**
 * The three mutation intentions are never confused by an omitted argument (SPEC §2.2):
 * an update carries the revision it saw; a create carries `create: true` and no revision (FILES-2, FILES-3).
 */
export type WriteCondition = Readonly<{ expectedRevision: string } | { create: true }>;

export type Entry = Readonly<{ path: string; kind: "file" | "dir"; ref?: FileRef }>;

/** Exact resolution (SPEC §2.2): a read pinned to a revision returns that revision or refuses; it never reads a later one. */
export type ReadOptions = Readonly<{ revision?: string }>;

export interface FileProvider {
  stat(address: FileAddress): Promise<FileRef | null>;
  read(address: FileAddress, options?: ReadOptions): Promise<{ ref: FileRef; content: string }>;
  list(address: FileAddress): Promise<readonly Entry[]>;
  /** An accepted write returns its receipt: the revision before and the one now current (FILES-7). */
  write(address: FileAddress, content: string, condition: WriteCondition, effect: Effect): Promise<Receipt>;
  /** Removal carries the current revision (FILES-4); the receipt's `after` is null. */
  remove(address: FileAddress, expectedRevision: string, effect: Effect): Promise<Receipt>;
}

/** What a receipt records for each accepted mutation (FILES-7, BORING-2). */
export type Receipt = Readonly<{
  address: FileAddress;
  id: string;
  before: string | null;
  after: string | null;
  effect: Effect;
  at: string;
}>;

/** A provider that cannot honour a condition or a receipt says so with this error, never with a success (FILES-8). */
export type FileError =
  | { code: "conflict"; current: string | null }
  | { code: "exists" }
  | { code: "missing" }
  | { code: "bad-address" }
  | { code: "readonly" }
  | { code: "unavailable"; requested: string; current: string | null }
  | { code: "unverified" };

export class FileProviderError extends Error {
  readonly error: FileError;
  constructor(error: FileError, detail?: string) {
    super(detail ? `${error.code}: ${detail}` : error.code);
    this.error = error;
  }
  get code(): FileError["code"] { return this.error.code; }
}

export const isFileError = (value: unknown, code?: FileError["code"]): value is FileProviderError =>
  value instanceof FileProviderError && (code === undefined || value.code === code);
