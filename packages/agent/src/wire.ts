/**
 * The wire between the agent endpoint and a chat. Types only: @boring/chat depends on this file
 * and on nothing else in the package (BORING-6). Every event is replayable by cursor (CHAT-1).
 *
 * Endpoints (mounted by `mountWire`, relative to the mount):
 *   GET  /.well-known/boring.json                 the manifest
 *   POST /agents/:agent/runs                      { message?, inputs?, thread?, idempotencyKey? } → RunView
 *   GET  /runs/:id                                RunView
 *   GET  /runs/:id/events?cursor=                 NDJSON of Event: replay after cursor, then live until terminal
 *   POST /runs/:id/cancel                         RunView
 *   POST /jobs/:job/start                         { inputs?, thread?, idempotencyKey? } → JobView
 *   GET  /jobs/:id                                JobView
 *   POST /conversations/:conversation/messages    { text, thread?, inputs?, idempotencyKey? } → { thread, run }
 *   GET  /threads/:id                             ThreadView
 *   GET  /threads/:id/events?cursor=              NDJSON of Event: replay after cursor, then live
 */
export type Cursor = string;

export type Part =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: unknown; state: "running" | "done" | "error"; output?: unknown; error?: string }
  | { type: "ask"; decision: string; question: string; answered?: boolean }
  | { type: "approve"; decision: string; subject: { mount: string; path: string; revision: string }; answered?: boolean }
  | { type: "artefact"; mount: string; path: string; revision: string };

export type Message = Readonly<{ id: string; role: "person" | "agent"; run?: string; parts: readonly Part[]; at: string }>;

export type RunView = Readonly<{
  id: string;
  thread: string;
  agent: string;
  job?: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  output?: unknown;
  error?: string;
  model?: string;
  attempts?: number;
  createdAt: string;
  endedAt?: string;
}>;

export type JobView = Readonly<{
  id: string;
  definition: string;
  thread: string;
  status: "pending" | "running" | "completed" | "failed" | "cancelled";
  children: readonly RunView[];
  output?: unknown;
  error?: string;
  createdAt: string;
  endedAt?: string;
}>;

export type ThreadView = Readonly<{ id: string; createdAt: string }>;

export type Event =
  | { cursor: Cursor; kind: "message"; message: Message }
  | { cursor: Cursor; kind: "run"; run: RunView }
  | { cursor: Cursor; kind: "decision"; decision: string; answered: boolean };

/** What a chat sends. The actor is never in the body; it comes from the session (CHAT-4). */
export type Inbound =
  | { type: "say"; conversation: string; thread?: string; text: string }
  | { type: "answer"; decision: string; value: unknown }
  | { type: "cancel"; run: string };

/** The error body every endpoint returns on failure. */
export type WireError = Readonly<{ error: string; status: number }>;
