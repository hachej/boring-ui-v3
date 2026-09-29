/**
 * Where a provider records its receipts. `record` is synchronous on purpose: a provider calls it inside
 * the same critical section as the mutation, so the two cannot be separated by a crash between them
 * in memory or by an interleaved writer (FILES-7). A host that wants receipts in its own database wraps
 * the provider's log in the same transaction it uses for the file.
 */
import type { Receipt } from "./index.ts";

export interface ReceiptLog {
  record(receipt: Receipt): void;
}

/** An in-memory log, for tests and for hosts that read receipts back after a run. */
export function memoryReceipts(): ReceiptLog & { readonly entries: readonly Receipt[] } {
  const entries: Receipt[] = [];
  return { entries, record: receipt => { entries.push(receipt); } };
}
