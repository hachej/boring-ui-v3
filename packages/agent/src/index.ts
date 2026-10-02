/**
 * @boring/agent — the public contract of the agent runtime.
 *
 * An application owns and runs its agents inside its own process. It defines them as files
 * (agents/, jobs/, conversations/), loads them with `loadApp`, runs them with `createRuntime`
 * on Flue, and exposes them with `mountWire` (a web-standard fetch handler) and the manifest at
 * `/.well-known/boring.json`. The application keeps its database, its auth and its deploy;
 * the Host contract is the only way authority enters (AGENT-8).
 */
import type { Effect, FileAddress, FileProvider, MountTable } from "@boring/files";
import type { UiCommandSpec, UiResult, UiTarget } from "./wire.ts";

export { loadApp, loadAgentDefinition, loadJobDefinition, loadConversationDefinition } from "./definitions/load.ts";
export { DefinitionError, parseFrontMatter, inputSchema, type InputSchema, type InputProperty } from "./definitions/front-matter.ts";
import type { InputSchema } from "./definitions/front-matter.ts";
import type { FileNeed } from "./runtime/files.ts";
export { createRuntime, type Runtime, type StartRunRequest, type StartJobRequest, type ConversationMessageRequest } from "./runtime/runtime.ts";
export { openStore, type Store, type RunRecord, type JobRecord, type ThreadRecord, type UsageRow, type ReceiptRow } from "./runtime/store.ts";
export { mountWire, type WireOptions } from "./wire/mount.ts";
export { manifestOf, type Manifest } from "./wire/manifest.ts";
export { FILE_TOOLS, fileTools, grantsFor, type FileNeed } from "./runtime/files.ts";
export type { UiCommandSpec, UiRequestView, UiResult, UiOutcome, UiTarget } from "./wire.ts";

/**
 * Roles are the application's own strings; the library never interprets them (AGENT-9). `scope` carries
 * whatever the host wants handed back to it with every question (a tenant, a team); opaque here.
 */
export type Actor = Readonly<{ id: string; name?: string; roles?: readonly string[]; scope?: Readonly<Record<string, string>> }>;

/** A conversation between one actor and the agent. Durable (AGENT-1). */
export type Thread = Readonly<{ id: string; actor: string; createdAt: string }>;

export type RunStatus = "pending" | "running" | "completed" | "failed" | "cancelled";

/** One pass of the loop over a thread. Recorded before it starts; ends exactly once (AGENT-1). */
export type Run = Readonly<{ id: string; thread: string; status: RunStatus; error?: string }>;

/**
 * What a tool handler may touch. Issued by the loop after admission, never a raw provider (AGENT-2).
 * `files` routes `{ mount, path }` addresses to the host's mount table for this actor, confined to the
 * run's grants: a mount or a mode the grants do not cover is refused before any provider call.
 */
export type Operations = Readonly<{
  effect: Effect;
  files: FileProvider;
  /** The mount names this run may address (from its grants), for tools that format `/mount/path`. */
  mounts: readonly string[];
}>;

export type ToolDefinition<Input = unknown, Output = unknown> = Readonly<{
  name: string;
  description: string;
  /** JSON schema of the arguments (an object schema). */
  input: Record<string, unknown>;
  mutates?: boolean;
  handler: (input: Input, operations: Operations) => Promise<Output>;
}>;

/**
 * A grant names what a run may touch: one mount, a path prefix ("" for the whole mount) and a mode.
 * Derived from the definition's `files:` needs against the host's mount table, then admitted by the
 * host per run through `mayRequest` (AGENT-8). A tool's arguments can never widen one (BORING-1).
 */
export type Grant = Readonly<{ mount: string; path: string; mode: "read" | "write" }>;

/**
 * The Host contract: the only way authority enters the loop (AGENT-8). The application implements
 * it over its own session, permissions and configuration.
 */
export interface Host {
  /** Who is talking, from the request the application authenticated. Null means 401. */
  resolveActor(request: unknown): Promise<Actor | null>;
  /** May this actor start a run of this agent on this thread with these tools and grants? */
  mayRequest(actor: Actor, request: { agent: string; thread: string; tools: readonly string[]; grants: readonly Grant[] }): Promise<boolean>;
  /** Is this run still allowed to act? Checked before every effect (AGENT-6). */
  isActive(run: Run): Promise<boolean>;
  /**
   * The mount table for this actor: `code` (the application's, wrap it in `readonly`), `workspace`
   * (the person's), `shared` if any, and attached mounts `mnt/<name>` (AGENT-7, FILES-5). Asked per
   * effect, never cached past the answer (AGENT-8).
   */
  mounts(actor: Actor): Promise<MountTable>;
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
  /** The provider catalog's price of the call (USD for the built-ins); 0 when it gives none, as on a subscription. */
  cost?: number;
  at: string;
}>;

/** The output tool of a structured agent (agents/<name>/tool.json). */
export type OutputTool = Readonly<{ name: string; description: string; input: Record<string, unknown> }>;

export type Effort = "minimal" | "low" | "medium" | "high" | "xhigh";

/** A validator refuses an output with this error; the message goes back to the model for a repair. */
export { OutputError } from "./errors.ts";
export { PHRASES, phrasesFor, type Language, type Phrases, type RunFailure } from "./phrases.ts";
import type { Language, Phrases } from "./phrases.ts";

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
  /** File needs from `files:`; they become grants per run and offer the file tools (FILE_TOOLS). */
  files: readonly FileNeed[];
  /** Page commands from `ui:` the agent may request of the bound page; offered only when a page registered them. */
  uiCommands: readonly string[];
  /**
   * Other agents of this application the model may hand a focused task to (`subagents:`), each on its own
   * model, instructions and helper tools; only the delegate's final answer returns. One level: a subagent
   * declares no subagents of its own.
   */
  subagents: readonly string[];
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
 * Model access, supplied by the host at mount time and never stored (AGENT-7). Each kind is served
 * by one model adapter (packages/agent/src/adapters/models/<kind>, AGENT-16).
 * `fake` answers from a script and routes every agent to `fake/<agent>`; `baseUrl` points a real
 * provider at a compatible gateway or a test double.
 */
export type ModelAccess =
  | Readonly<{ kind: "fake"; script: (request: FakeRequest) => FakeReply | Promise<FakeReply> }>
  | Readonly<{ kind: "openrouter"; apiKey: string; baseUrl?: string }>
  | Readonly<{ kind: "openai-codex"; credentialsFile: string; baseUrl?: string }>;
export type { ModelAdapter, ModelContext, ModelProviders } from "./runtime/model-port.ts";

export type RuntimeOptions = Readonly<{
  host: Host;
  app: AppRegistry;
  /** Handlers for the helper tools the definitions declare, by name. */
  tools?: readonly ToolDefinition[];
  /** Path of the SQLite file that holds threads, runs, events, receipts and usage; ":memory:" for tests. */
  store: string;
  model: ModelAccess;
  /**
   * Per-agent model override, the application's setting; default is the definition's. A function is
   * asked at every run, so a setting a person changes applies to the next run without a restart (AGENT-8).
   */
  models?: Readonly<Record<string, { model?: string; effort?: Effort }>> | ((agent: string) => { model?: string; effort?: Effort } | undefined);
  /** The language of the library's own words to models and in records (AGENT-14); English by default. */
  language?: Language;
  /** Overrides of single phrases of that language. */
  phrases?: Partial<Phrases>;
  maxConcurrent?: number;
  /** How many times an invalid output is sent back for repair. */
  repairs?: number;
  /** How long a page has to answer a UI request before it is expired and the tool returns `unavailable` (ms, default 30000). */
  uiTimeout?: number;
}>;

/** A page instance's registration on a thread: what the agent may request of it (CHAT-3). Grants nothing (UI-BOUNDARY-1). */
export type UiRegistration = Readonly<{ page: string; commands: readonly UiCommandSpec[]; target?: UiTarget }>;
/** A page's answer to one request; `result` distinguishes local interaction from durable effect (UI-BOUNDARY-5). */
export type UiAnswer = Readonly<{ page: string; result: UiResult }>;

/** A question or an approval, answered once by compare-and-set from the person's session (AGENT-5). */
export type Decision = Readonly<{
  id: string;
  thread: string;
  run: string;
  kind: "ask" | "approve";
  subject?: FileAddress & { revision: string };
  answer?: { by: string; value: unknown; at: string };
}>;
