/**
 * @boring/agent — the public contract of the agent loop.
 *
 * An application mounts one agent in its own backend. It keeps its database, its auth and its
 * deploy; the loop adds threads, runs, tools that are admitted before they run, receipts for
 * every effect, and questions and approvals as records. Files go through @boring/files.
 */
import type { Effect, FileAddress, FileProvider } from "@boring/files";

/** Roles are the application's own strings; the library never interprets them (AGENT-9). */
export type Actor = Readonly<{ id: string; name?: string; roles?: readonly string[] }>;

/** A conversation between one actor and the agent. Durable (AGENT-1). */
export type Thread = Readonly<{ id: string; actor: string; createdAt: string }>;

/** One pass of the loop over a thread. Recorded before it starts; ends exactly once (AGENT-1). */
export type Run = Readonly<{ id: string; thread: string; status: "pending" | "running" | "completed" | "failed" | "cancelled"; error?: string }>;

/** What a tool handler may touch. Issued by the loop after admission, never a raw provider (AGENT-2). */
export type Operations = Readonly<{
  effect: Effect;
  files: Pick<FileProvider, "stat" | "read" | "list" | "write" | "remove">;
}>;

export type ToolDefinition<Input = unknown, Output = unknown> = Readonly<{
  name: string;
  description: string;
  input: Record<string, unknown>;
  mutates?: boolean;
  handler: (input: Input, operations: Operations) => Promise<Output>;
}>;

/** A grant names what a run may touch. Issued per run by the host (AGENT-8). */
export type Grant = Readonly<{ mount: string; path: string; mode: "read" | "write" }>;

/**
 * The Host contract: the only way authority enters the loop (AGENT-8). The application implements
 * it over its own session, permissions and configuration.
 */
export interface Host {
  /** Who is talking, from the request the application authenticated. Null means 401. */
  resolveActor(request: unknown): Promise<Actor | null>;
  /** May this actor start a run on this thread with these tools and grants? */
  mayRequest(actor: Actor, request: { thread: string; tools: readonly string[]; grants: readonly Grant[] }): Promise<boolean>;
  /** Is this run still allowed to act? Checked before every effect (AGENT-6). */
  isActive(run: Run): Promise<boolean>;
  /** Mounts the actor may see, mapped to providers the host owns (AGENT-7). */
  mounts(actor: Actor): Promise<Readonly<Record<string, FileProvider>>>;
  /** Tools this actor may be offered, decided by the application's roles (AGENT-3, AGENT-9). */
  allowedTools(actor: Actor): Promise<readonly string[]>;
  /** May this actor answer this question or give this approval? Decided by the application's roles (AGENT-5, AGENT-9). */
  mayAnswer(actor: Actor, decision: Decision): Promise<boolean>;
  /** Every model call is reported here, attributed, before the run continues (AGENT-10). */
  onUsage(usage: Usage): Promise<void>;
}

/** One model call, metered (AGENT-10). Written to the store and handed to the host. */
export type Usage = Readonly<{
  actor: string;
  thread: string;
  run: string;
  agent: string;
  model: string;
  input: number;
  output: number;
  cached?: number;
  at: string;
}>;

export type AgentDefinition = Readonly<{
  id: string;
  instructions: string;
  tools: readonly string[];
}>;

export type AgentOptions = Readonly<{
  host: Host;
  agents: readonly AgentDefinition[];
  tools: readonly ToolDefinition[];
  /** Path of the SQLite file that holds threads, runs, decisions and receipts. */
  store: string;
  /** Supplied by the host; never stored (AGENT-7). */
  model: unknown;
}>;

/** A question or an approval, answered once by compare-and-set from the person's session (AGENT-5). */
export type Decision = Readonly<{
  id: string;
  thread: string;
  run: string;
  kind: "ask" | "approve";
  subject?: FileAddress & { revision: string };
  answer?: { by: string; value: unknown; at: string };
}>;
