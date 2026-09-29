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
export { fileRoutes, httpFiles, type FileRoutesOptions, type HttpFilesOptions } from "./http.ts";

export type { FileAddress, FileRef, Effect, WriteCondition, Entry, ReadOptions, FileProvider, Receipt } from "./contract.ts";

export { FileProviderError, isFileError, type FileError } from "./errors.ts";
