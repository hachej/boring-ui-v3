/**
 * `@boring/files/web`: everything in this package that runs wherever `fetch` runs — a browser, a worker, Node —
 * without the directory or GitHub providers. The contract and its law set are the same (BORING-3); this entry
 * only leaves out what needs `node:fs`.
 */
export { canonicalPath, parseAddress, formatAddress, isMountName, MOUNTS, attachedMount } from "./address.ts";
export { mountRouter, type MountTable } from "./mounts.ts";
export { memoryProvider, type MemoryProviderOptions } from "./memory.ts";
export { readonly } from "./readonly.ts";
export { memoryReceipts, type ReceiptLog } from "./receipts.ts";
export { fileRoutes, httpFiles, type FileRoutesOptions, type HttpFilesOptions } from "./http.ts";
export { FileProviderError, isFileError, type FileError } from "./errors.ts";
export type { FileAddress, FileRef, Effect, WriteCondition, Entry, ReadOptions, FileProvider, Receipt } from "./contract.ts";
