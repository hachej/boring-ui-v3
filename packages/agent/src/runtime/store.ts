/**
 * The runtime's records in SQLite (node:sqlite): threads, runs, jobs, events, usage, receipts and
 * idempotency keys. Everything the wire shows is a projection of these rows (BORING-4); a run is
 * recorded before it starts and ends once (AGENT-1). Live subscribers are in-process only; a
 * reconnecting client replays by cursor and misses nothing.
 */
import { DatabaseSync } from "node:sqlite";
import { randomUUID, createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import type { Event, JobView, Message, RunView, UiRequestView, UiResult, UiTarget } from "../wire.ts";
import type { RunStatus, Usage } from "../index.ts";

export type ThreadRecord = Readonly<{ id: string; actor: string; createdAt: string }>;
export type RunRecord = Readonly<{
  id: string; thread: string; agent: string; actor: string; job: string | null; status: RunStatus;
  input: Record<string, unknown>; output: unknown; error: string | null; model: string | null; attempts: number;
  cancelRequested: boolean; createdAt: string; endedAt: string | null;
}>;
export type JobRecord = Readonly<{
  id: string; definition: string; actor: string; thread: string; status: RunStatus;
  input: Record<string, unknown>; output: unknown; error: string | null; createdAt: string; endedAt: string | null;
}>;
export type UsageRow = Usage & Readonly<{ id: string }>;
export type ReceiptRow = Readonly<{ id: string; actor: string; thread: string; run: string; tool: string; inputHash: string; ok: boolean; revisions: unknown; at: string }>;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY, actor TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, thread TEXT NOT NULL, agent TEXT NOT NULL, actor TEXT NOT NULL, job TEXT, status TEXT NOT NULL,
  input TEXT NOT NULL, output TEXT, error TEXT, model TEXT, attempts INTEGER NOT NULL DEFAULT 0, cancel_requested INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL, ended_at TEXT);
CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY, definition TEXT NOT NULL, actor TEXT NOT NULL, thread TEXT NOT NULL, status TEXT NOT NULL,
  input TEXT NOT NULL, output TEXT, error TEXT, created_at TEXT NOT NULL, ended_at TEXT);
CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT, thread TEXT NOT NULL, run TEXT, kind TEXT NOT NULL, payload TEXT NOT NULL, at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS events_thread ON events(thread, seq);
CREATE INDEX IF NOT EXISTS events_run ON events(run, seq);
CREATE TABLE IF NOT EXISTS usage(id TEXT PRIMARY KEY, actor TEXT NOT NULL, thread TEXT NOT NULL, run TEXT NOT NULL, agent TEXT NOT NULL, model TEXT NOT NULL,
  input INTEGER NOT NULL, output INTEGER NOT NULL, cached INTEGER NOT NULL DEFAULT 0, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY, actor TEXT NOT NULL, thread TEXT NOT NULL, run TEXT NOT NULL, tool TEXT NOT NULL, input_hash TEXT NOT NULL,
  ok INTEGER NOT NULL, revisions TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency(actor TEXT NOT NULL, key TEXT NOT NULL, request_hash TEXT NOT NULL, target TEXT NOT NULL, PRIMARY KEY(actor, key));
CREATE TABLE IF NOT EXISTS ui_requests(id TEXT PRIMARY KEY, run TEXT NOT NULL, thread TEXT NOT NULL, page TEXT NOT NULL, command TEXT NOT NULL, input TEXT NOT NULL,
  target TEXT, state TEXT NOT NULL, result TEXT, at TEXT NOT NULL, answered_at TEXT);
`;

const TERMINAL: readonly RunStatus[] = ["completed", "failed", "cancelled"];
export const isTerminal = (status: RunStatus) => TERMINAL.includes(status);
const now = () => new Date().toISOString();
const json = (value: unknown) => JSON.stringify(value ?? null);
const parse = (text: unknown) => (typeof text === "string" ? JSON.parse(text) : null);
export const hashOf = (value: unknown) => createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex");

type Row = Record<string, unknown>;
const runOf = (row: Row): RunRecord => ({
  id: row.id as string, thread: row.thread as string, agent: row.agent as string, actor: row.actor as string, job: (row.job as string | null) ?? null,
  status: row.status as RunStatus, input: parse(row.input) ?? {}, output: parse(row.output), error: (row.error as string | null) ?? null,
  model: (row.model as string | null) ?? null, attempts: Number(row.attempts), cancelRequested: !!row.cancel_requested,
  createdAt: row.created_at as string, endedAt: (row.ended_at as string | null) ?? null,
});
const jobOf = (row: Row): JobRecord => ({
  id: row.id as string, definition: row.definition as string, actor: row.actor as string, thread: row.thread as string, status: row.status as RunStatus,
  input: parse(row.input) ?? {}, output: parse(row.output), error: (row.error as string | null) ?? null, createdAt: row.created_at as string, endedAt: (row.ended_at as string | null) ?? null,
});

export const runView = (run: RunRecord): RunView => ({
  id: run.id, thread: run.thread, agent: run.agent, ...(run.job ? { job: run.job } : {}), status: run.status,
  ...(run.output !== null && run.output !== undefined ? { output: run.output } : {}), ...(run.error ? { error: run.error } : {}),
  ...(run.model ? { model: run.model } : {}), attempts: run.attempts, createdAt: run.createdAt, ...(run.endedAt ? { endedAt: run.endedAt } : {}),
});

export class Store {
  private readonly db: DatabaseSync;
  private readonly live = new EventEmitter();

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(SCHEMA);
    this.live.setMaxListeners(0);
  }

  close() { this.db.close(); }

  /** Runs and jobs still open when the process died cannot resume: they fail explicitly (AGENT-1). */
  failInterrupted(reason = "interrupted: the process that ran this stopped"): readonly RunRecord[] {
    const open = this.db.prepare("SELECT * FROM runs WHERE status IN ('pending','running')").all() as Row[];
    const failed: RunRecord[] = [];
    for (const row of open) {
      this.finishRun(row.id as string, { status: "failed", error: reason });
      failed.push(this.run(row.id as string)!);
    }
    for (const row of this.db.prepare("SELECT id FROM jobs WHERE status IN ('pending','running')").all() as Row[]) this.finishJob(row.id as string, { status: "failed", error: reason });
    return failed;
  }

  // Threads
  createThread(actor: string): ThreadRecord {
    const thread = { id: randomUUID(), actor, createdAt: now() };
    this.db.prepare("INSERT INTO threads(id, actor, created_at) VALUES(?,?,?)").run(thread.id, thread.actor, thread.createdAt);
    return thread;
  }
  thread(id: string): ThreadRecord | null {
    const row = this.db.prepare("SELECT * FROM threads WHERE id = ?").get(id) as Row | undefined;
    return row ? { id: row.id as string, actor: row.actor as string, createdAt: row.created_at as string } : null;
  }

  // Idempotency (SPEC §4.3): same key and request → the recorded target; same key, other request → conflict.
  idempotent(actor: string, key: string, request: unknown): { target: string } | { conflict: true } | null {
    const row = this.db.prepare("SELECT request_hash, target FROM idempotency WHERE actor = ? AND key = ?").get(actor, key) as Row | undefined;
    if (!row) return null;
    return row.request_hash === hashOf(request) ? { target: row.target as string } : { conflict: true };
  }
  rememberKey(actor: string, key: string, request: unknown, target: string) {
    this.db.prepare("INSERT INTO idempotency(actor, key, request_hash, target) VALUES(?,?,?,?)").run(actor, key, hashOf(request), target);
  }

  // Runs
  createRun(fields: { thread: string; agent: string; actor: string; job?: string | null; input: Record<string, unknown>; model: string }): RunRecord {
    const id = randomUUID();
    this.db.prepare("INSERT INTO runs(id, thread, agent, actor, job, status, input, model, created_at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id, fields.thread, fields.agent, fields.actor, fields.job ?? null, "pending", json(fields.input), fields.model, now());
    const run = this.run(id)!;
    this.emit({ thread: run.thread, run: run.id, kind: "run", payload: { run: runView(run) } });
    return run;
  }
  run(id: string): RunRecord | null {
    const row = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
    return row ? runOf(row) : null;
  }
  runsOfJob(job: string): readonly RunRecord[] {
    return (this.db.prepare("SELECT * FROM runs WHERE job = ? ORDER BY created_at, id").all(job) as Row[]).map(runOf);
  }
  /** pending → running. Returns false when the run is no longer pending (cancelled before it started). */
  startRun(id: string): boolean {
    const changed = this.db.prepare("UPDATE runs SET status = 'running' WHERE id = ? AND status = 'pending'").run(id).changes > 0;
    if (changed) { const run = this.run(id)!; this.emit({ thread: run.thread, run: id, kind: "run", payload: { run: runView(run) } }); }
    return changed;
  }
  /** Records the wish to stop; the loop makes no further effect after it (AGENT-6). */
  requestCancel(id: string): RunRecord | null {
    this.db.prepare("UPDATE runs SET cancel_requested = 1 WHERE id = ? AND status IN ('pending','running')").run(id);
    return this.run(id);
  }
  /** The single terminal transition: a run ends once (AGENT-1). Returns false if it already ended. */
  finishRun(id: string, end: { status: "completed" | "failed" | "cancelled"; output?: unknown; error?: string; attempts?: number }): boolean {
    const changed = this.db.prepare("UPDATE runs SET status = ?, output = ?, error = ?, attempts = COALESCE(?, attempts), ended_at = ? WHERE id = ? AND status IN ('pending','running')")
      .run(end.status, end.output === undefined ? null : json(end.output), end.error ?? null, end.attempts ?? null, now(), id).changes > 0;
    if (changed) { const run = this.run(id)!; this.emit({ thread: run.thread, run: id, kind: "run", payload: { run: runView(run) } }); }
    return changed;
  }

  // Jobs
  createJob(fields: { definition: string; actor: string; thread: string; input: Record<string, unknown> }): JobRecord {
    const id = randomUUID();
    this.db.prepare("INSERT INTO jobs(id, definition, actor, thread, status, input, created_at) VALUES(?,?,?,?,?,?,?)").run(id, fields.definition, fields.actor, fields.thread, "running", json(fields.input), now());
    return this.job(id)!;
  }
  job(id: string): JobRecord | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE id = ?").get(id) as Row | undefined;
    return row ? jobOf(row) : null;
  }
  finishJob(id: string, end: { status: "completed" | "failed" | "cancelled"; output?: unknown; error?: string }): boolean {
    return this.db.prepare("UPDATE jobs SET status = ?, output = ?, error = ?, ended_at = ? WHERE id = ? AND status IN ('pending','running')")
      .run(end.status, end.output === undefined ? null : json(end.output), end.error ?? null, now(), id).changes > 0;
  }
  jobView(job: JobRecord): JobView {
    return { id: job.id, definition: job.definition, thread: job.thread, status: job.status, children: this.runsOfJob(job.id).map(runView),
      ...(job.output !== null && job.output !== undefined ? { output: job.output } : {}), ...(job.error ? { error: job.error } : {}), createdAt: job.createdAt, ...(job.endedAt ? { endedAt: job.endedAt } : {}) };
  }

  // Events: the projection every chat and page rebuilds from (CHAT-1).
  addMessage(thread: string, run: string | null, message: Omit<Message, "id" | "at">): Message {
    const full: Message = { id: randomUUID(), at: now(), ...message };
    this.emit({ thread, run, kind: "message", payload: { message: full } });
    return full;
  }
  private emit(event: { thread: string; run: string | null; kind: Event["kind"]; payload: Record<string, unknown> }) {
    const at = now();
    const seq = this.db.prepare("INSERT INTO events(thread, run, kind, payload, at) VALUES(?,?,?,?,?)").run(event.thread, event.run, event.kind, json(event.payload), at).lastInsertRowid;
    const full = { cursor: String(seq), kind: event.kind, ...event.payload } as Event;
    this.live.emit("event", { thread: event.thread, run: event.run, event: full });
  }
  eventsOf(scope: { thread?: string; run?: string }, cursor?: string): readonly Event[] {
    const after = cursor && /^\d+$/.test(cursor) ? Number(cursor) : 0;
    const rows = scope.run
      ? this.db.prepare("SELECT * FROM events WHERE run = ? AND seq > ? ORDER BY seq").all(scope.run, after)
      : this.db.prepare("SELECT * FROM events WHERE thread = ? AND seq > ? ORDER BY seq").all(scope.thread!, after);
    return (rows as Row[]).map(row => ({ cursor: String(row.seq), kind: row.kind, ...parse(row.payload) }) as Event);
  }
  /** Live events for a thread or a run. Returns the unsubscribe function. */
  subscribe(scope: { thread?: string; run?: string }, listener: (event: Event) => void): () => void {
    const handler = (item: { thread: string; run: string | null; event: Event }) => {
      if (scope.run ? item.run === scope.run : item.thread === scope.thread) listener(item.event);
    };
    this.live.on("event", handler);
    return () => this.live.off("event", handler);
  }

  // Usage and receipts
  addUsage(usage: Usage): UsageRow {
    const id = randomUUID();
    this.db.prepare("INSERT INTO usage(id, actor, thread, run, agent, model, input, output, cached, at) VALUES(?,?,?,?,?,?,?,?,?,?)")
      .run(id, usage.actor, usage.thread, usage.run, usage.agent, usage.model, usage.input, usage.output, usage.cached ?? 0, usage.at);
    return { id, ...usage };
  }
  usageOf(run: string): readonly UsageRow[] {
    return (this.db.prepare("SELECT * FROM usage WHERE run = ? ORDER BY at, id").all(run) as Row[]).map(row => ({
      id: row.id as string, actor: row.actor as string, thread: row.thread as string, run: row.run as string, agent: row.agent as string, model: row.model as string,
      input: Number(row.input), output: Number(row.output), cached: Number(row.cached), at: row.at as string,
    }));
  }
  // UI requests (CHAT-3, UI-BOUNDARY-4/5): a request to the bound page is a record; it is answered once by compare-and-set.
  private uiOf(row: Row): UiRequestView {
    return { id: row.id as string, run: row.run as string, thread: row.thread as string, page: row.page as string, command: row.command as string, input: parse(row.input),
      ...(row.target ? { target: parse(row.target) as UiTarget } : {}), state: row.state as UiRequestView["state"], ...(row.result ? { result: parse(row.result) as UiResult } : {}),
      at: row.at as string, ...(row.answered_at ? { answeredAt: row.answered_at as string } : {}) };
  }
  createUiRequest(fields: { run: string; thread: string; page: string; command: string; input: unknown; target?: UiTarget }): UiRequestView {
    const id = randomUUID();
    this.db.prepare("INSERT INTO ui_requests(id, run, thread, page, command, input, target, state, at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(id, fields.run, fields.thread, fields.page, fields.command, json(fields.input), fields.target ? json(fields.target) : null, "requested", now());
    const view = this.uiRequest(id)!;
    this.emit({ thread: view.thread, run: view.run, kind: "ui", payload: { ui: view } });
    return view;
  }
  uiRequest(id: string): UiRequestView | null {
    const row = this.db.prepare("SELECT * FROM ui_requests WHERE id = ?").get(id) as Row | undefined;
    return row ? this.uiOf(row) : null;
  }
  /** requested → answered | expired | unavailable, once. Returns null when the request already left `requested`. */
  settleUiRequest(id: string, end: { state: "answered" | "expired" | "unavailable"; result?: UiResult }): UiRequestView | null {
    const changed = this.db.prepare("UPDATE ui_requests SET state = ?, result = ?, answered_at = ? WHERE id = ? AND state = 'requested'")
      .run(end.state, end.result ? json(end.result) : null, now(), id).changes > 0;
    if (!changed) return null;
    const view = this.uiRequest(id)!;
    this.emit({ thread: view.thread, run: view.run, kind: "ui", payload: { ui: view } });
    return view;
  }
  openUiRequests(scope: { page?: string; run?: string }): readonly UiRequestView[] {
    const rows = scope.page
      ? this.db.prepare("SELECT * FROM ui_requests WHERE page = ? AND state = 'requested'").all(scope.page)
      : this.db.prepare("SELECT * FROM ui_requests WHERE run = ? AND state = 'requested'").all(scope.run!);
    return (rows as Row[]).map(row => this.uiOf(row));
  }

  addReceipt(receipt: Omit<ReceiptRow, "id" | "at">): ReceiptRow {
    const full = { id: randomUUID(), at: now(), ...receipt };
    this.db.prepare("INSERT INTO receipts(id, actor, thread, run, tool, input_hash, ok, revisions, at) VALUES(?,?,?,?,?,?,?,?,?)")
      .run(full.id, full.actor, full.thread, full.run, full.tool, full.inputHash, full.ok ? 1 : 0, json(full.revisions), full.at);
    return full;
  }
  receiptsOf(run: string): readonly ReceiptRow[] {
    return (this.db.prepare("SELECT * FROM receipts WHERE run = ? ORDER BY at, id").all(run) as Row[]).map(row => ({
      id: row.id as string, actor: row.actor as string, thread: row.thread as string, run: row.run as string, tool: row.tool as string,
      inputHash: row.input_hash as string, ok: !!row.ok, revisions: parse(row.revisions), at: row.at as string,
    }));
  }
}

export function openStore(path: string): Store { return new Store(path); }
