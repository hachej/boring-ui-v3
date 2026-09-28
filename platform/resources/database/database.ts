import type { ResourceRef } from "../../identity.js";
import type { EffectContext } from "../resource.js";

/**
 * An app's database is one Resource: its own store, its own schema (the app's migrations, shipped as files),
 * one revision that advances on every committed write. Rows are the app's business; the platform owns identity,
 * revision, admission and receipts, exactly as it does for a file.
 */
export type DatabaseRef = ResourceRef & { kind: "database" };
export type Row = Readonly<Record<string, unknown>>;
export type Statement = Readonly<{ sql: string; params?: readonly unknown[] }>;

/** Trusted, synchronous storage boundary for one database. */
export interface DatabaseProvider {
  readonly name: string;
  ref(): DatabaseRef;
  /** Reads never advance the revision; the ref says which revision the rows come from. */
  query(statement: Statement): { ref: DatabaseRef; rows: Row[] };
  /**
   * One transaction: every statement commits, the revision advances by one, the receipt lands in the log.
   * With `expectedRevision`, a stale caller changes nothing (the read-modify-write case, as for files).
   */
  execute(statements: readonly Statement[], options: { context: EffectContext; expectedRevision?: string }): DatabaseRef;
  address(ref: ResourceRef): boolean;
}

/** A database is a grant space; the v0 pattern is `*` (the whole database), table-level grants await a consumer. */
export const databaseSpace = (name: string): string => `db:${name}`;

export function assertStatement(statement: Statement): void {
  if (!statement || typeof statement.sql !== "string" || !statement.sql.trim()) throw new Error("a statement needs sql");
  if (statement.params !== undefined && !Array.isArray(statement.params)) throw new Error("params must be an array");
}
