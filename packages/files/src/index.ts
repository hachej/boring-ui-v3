/**
 * @boring/files — the file contract.
 *
 * A file lives under a mount. Everything that touches a file (the tree, the HTTP endpoints,
 * an agent's tools) goes through one FileProvider, so one law set covers every transport
 * (BORING-3). The contract is asynchronous because a provider may be a directory, a SQLite
 * store or a remote sandbox (FILES-8).
 */

/** A canonical relative path inside one mount (FILES-5). */
export type FileAddress = Readonly<{ mount: string; path: string }>;

/** Identity plus the revision a read observed (FILES-1). Opaque strings; only equality matters. */
export type FileRef = Readonly<{ id: string; revision: string }>;

/** Who is acting, for the receipt (FILES-7). Issued by the host, never by a caller's payload. */
export type Effect = Readonly<{ actor: string; thread?: string; run?: string; tool?: string }>;

/** An update carries the revision it saw; a create carries `create: true` and no revision (FILES-2, FILES-3). */
export type WriteCondition = Readonly<{ expectedRevision: string } | { create: true }>;

export type Entry = Readonly<{ path: string; kind: "file" | "dir"; ref?: FileRef }>;

export interface FileProvider {
  stat(address: FileAddress): Promise<FileRef | null>;
  read(address: FileAddress): Promise<{ ref: FileRef; content: string }>;
  list(address: FileAddress): Promise<readonly Entry[]>;
  write(address: FileAddress, content: string, condition: WriteCondition, effect: Effect): Promise<FileRef>;
  remove(address: FileAddress, expectedRevision: string, effect: Effect): Promise<FileRef>;
}

/** What a receipt records for each accepted mutation (FILES-7). */
export type Receipt = Readonly<{
  address: FileAddress;
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
  | { code: "unverified" };
