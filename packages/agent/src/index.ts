/**
 * @boring/agent — the public contract of the agent runtime.
 *
 * An application owns and runs its agents inside its own process. It defines them as files
 * (agents/, jobs/, conversations/), loads them with `loadApp`, runs them with `createRuntime`
 * on Flue, and exposes them with `mountWire` (a web-standard fetch handler) and the manifest at
 * `/.well-known/boring.json`. The application keeps its database, its auth and its deploy;
 * the Host contract is the only way authority enters (AGENT-8).
 */
import type { Effect, FileAddress, FileProvider } from "@boring/files";

export { loadApp, loadAgentDefinition, loadJobDefinition, loadConversationDefinition } from "./definitions/load.ts";
export { DefinitionError, parseFrontMatter, inputSchema, type InputSchema, type InputProperty } from "./definitions/front-matter.ts";
import type { InputSchema } from "./definitions/front-matter.ts";
export { createRuntime, type Runtime, type StartRunRequest, type StartJobRequest, type ConversationMessageRequest } from "./runtime/runtime.ts";
export { openStore, type Store, type RunRecord, type JobRecord, type ThreadRecord, type UsageRow, type ReceiptRow } from "./runtime/store.ts";
export { mountWire, type WireOptions } from "./wire/mount.ts";
export { manifestOf, type Manifest } from "./wire/manifest.ts";

/** Roles are the application's own strings; the library never interprets them (AGENT-9). */
export type Actor = Readonly<{ id: string; name?: string; roles?: readonly string[] }>;

/** A conversation between one actor and the agent. Durable (AGENT-1). */
export type Thread = Readonly<{ id: string; actor: string; createdAt: string }>;

export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/** One pass of the loop over a thread. Recorded before it starts; ends exactly once (AGENT-1). */
export type Run = Readonly<{ id: string; thread: string; status: RunStatus; error?: string }>;

/** What a tool handler may touch. Issued by the loop after admission, never a raw provider (AGENT-2). */
export type Operations = Readonly<{
  effect: Effect;
  files: Pick<FileProvider, "stat" | "read" | "list" | "write" | "remove">;
}>;

export type ToolDefinition<Input = unknown, Output = unknown> = Readonly<{
  name: string;
  description: string;
  /** JSON schema of the arguments (an object schema). */
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

/** The output tool of a structured agent (agents/<name>/tool.json). */
export type OutputTool = Readonly<{ name: string; description: string; input: Record<string, unknown> }>;

export type Effort = "minimal" | "low" | "medium" | "high" | "xhigh";

/** A validator refuses an output with this error; the message goes back to the model for a repair. */
export class OutputError extends Error {}

/** agents/<name>: the front matter of agent.md, its prompt, its output tool and the module's contract. */
export type AgentDefinition = Readonly<{
  kind: "agent";
  name: string;
  title: string;
  description?: string;
  /** provider/model, the default the host may override. */
  model: string;
  effort?: Effort;
  maxTokens: number;
  output: "tool" | "markdown";
  tool: OutputTool | null;
  /** rules.md, handed to buildMessage as `rules`. */
  rules: string;
  /** The system prompt: the body of agent.md. */
  system: string;
  /** Names of helper tools the agent may call; the application registers their handlers. */
  helperTools: readonly string[];
  /** JSON schema of the inputs, derived from the `inputs:` block; a client can build a form from it. */
  inputs: InputSchema;
  outputs: Readonly<Record<string, string>>;
  dir: string;
  buildMessage: (input: Record<string, unknown>) => string;
  validate: (output: unknown) => unknown;
  asText: (output: unknown) => string;
  /** Optional: helper tools the definition itself brings, on top of the application's registered ones. */
  tools?: (context: { dir: string }) => readonly ToolDefinition[];
}>;

/** jobs/<name>: a job starts predeclared children (agent runs) and collects one output. */
export type JobDefinition = Readonly<{
  kind: "job";
  name: string;
  title: string;
  description: string;
  /** The agents this job may start; the composition is frozen when the job starts. */
  children: readonly string[];
  inputs: InputSchema;
  outputs: Readonly<Record<string, string>>;
  dir: string;
  plan: (input: Record<string, unknown>) => readonly { agent: string; input: Record<string, unknown> }[] | Promise<readonly { agent: string; input: Record<string, unknown> }[]>;
  collect: (results: readonly { agent: string; output: unknown }[], input: Record<string, unknown>) => unknown;
}>;

/** conversations/<name>: history plus one agent; each message is one run of that agent. */
export type ConversationDefinition = Readonly<{
  kind: "conversation";
  name: string;
  title: string;
  description: string;
  agent: string;
  /** How many earlier turns the agent sees. */
  history: number;
  inputs: InputSchema;
  dir: string;
  context?: (input: Record<string, unknown>) => Record<string, unknown> | Promise<Record<string, unknown>>;
}>;

export type AppRegistry = Readonly<{
  name: string;
  version: string;
  description?: string;
  dir: string;
  agents: ReadonlyMap<string, AgentDefinition>;
  jobs: ReadonlyMap<string, JobDefinition>;
  conversations: ReadonlyMap<string, ConversationDefinition>;
}>;

/** What the fake provider is asked and what it answers, for tests and scripted runs. */
export type FakeRequest = Readonly<{ model: string; system: string; messages: readonly { role: "user" | "assistant" | "tool"; content: string }[]; tools: readonly { name: string }[]; outputTool: string | null }>;
export type FakeReply = Readonly<{ text?: string; toolCalls?: readonly { id?: string; name: string; arguments: unknown }[] }>;

/**
 * Model access, supplied by the host at mount time and never stored (AGENT-7).
 * `fake` answers from a script and routes every agent to `fake/<agent>`.
 */
export type ModelAccess =
  | Readonly<{ kind: "fake"; script: (request: FakeRequest) => FakeReply | Promise<FakeReply> }>
  | Readonly<{ kind: "openrouter"; apiKey: string }>
  | Readonly<{ kind: "openai-codex"; credentialsFile: string }>;

export type RuntimeOptions = Readonly<{
  host: Host;
  app: AppRegistry;
  /** Handlers for the helper tools the definitions declare, by name. */
  tools?: readonly ToolDefinition[];
  /** Path of the SQLite file that holds threads, runs, events, receipts and usage; ":memory:" for tests. */
  store: string;
  model: ModelAccess;
  /** Per-agent model override, the application's setting; default is the definition's. */
  models?: Readonly<Record<string, { model?: string; effort?: Effort }>>;
  maxConcurrent?: number;
  /** How many times an invalid output is sent back for repair. */
  repairs?: number;
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
