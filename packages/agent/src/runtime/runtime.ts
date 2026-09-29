/**
 * The runtime an application creates once: it loads nothing itself (the registry comes from
 * `loadApp`), starts Flue with the host's model access, opens the store, and answers the
 * request-work operations the wire exposes. Every authority question goes to the Host (AGENT-8):
 * who the actor is, whether they may request, which tools they may see, whether a run may still act.
 */
import type { FileAddress, FileProvider } from "@boring/files";
import type { Actor, AgentDefinition, ConversationDefinition, Effort, JobDefinition, Run, RuntimeOptions, ToolDefinition, Usage } from "../index.ts";
import { OutputError } from "../index.ts";
import type { Event } from "../wire.ts";
import { Store, hashOf, isTerminal, type JobRecord, type RunRecord, type ThreadRecord } from "./store.ts";
import { providersFor } from "./providers.ts";
import { CancelledError, abortRun, runAgent, startFlue, stopFlue, type OfferedTool } from "./flue.ts";
import { manifestOf, type Manifest } from "../wire/manifest.ts";

export class RuntimeError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

export type StartRunRequest = Readonly<{ agent: string; message?: string; inputs?: Record<string, unknown>; thread?: string; idempotencyKey?: string }>;
export type StartJobRequest = Readonly<{ job: string; inputs?: Record<string, unknown>; thread?: string; idempotencyKey?: string }>;
export type ConversationMessageRequest = Readonly<{ conversation: string; text: string; thread?: string; inputs?: Record<string, unknown>; idempotencyKey?: string }>;

export interface Runtime {
  readonly store: Store;
  manifest(): Manifest;
  startRun(actor: Actor, request: StartRunRequest): Promise<RunRecord>;
  run(actor: Actor, id: string): RunRecord;
  cancel(actor: Actor, id: string): Promise<RunRecord>;
  startJob(actor: Actor, request: StartJobRequest): Promise<JobRecord>;
  job(actor: Actor, id: string): JobRecord;
  say(actor: Actor, request: ConversationMessageRequest): Promise<{ thread: ThreadRecord; run: RunRecord }>;
  thread(actor: Actor, id: string): ThreadRecord;
  /** Replay after the cursor, then live events until `until` says stop or the unsubscribe is called. */
  events(actor: Actor, scope: { run?: string; thread?: string }, cursor?: string): { replay: readonly Event[]; subscribe: (listener: (event: Event) => void) => () => void };
  /** Resolves when no run is in flight (tests, graceful stop). */
  idle(): Promise<void>;
  stop(): Promise<void>;
}

type History = { role: "user" | "assistant"; content: string }[];

/** Routes file operations to the providers the host mapped for this actor; the handler never sees the map (AGENT-2). */
function mountRouter(mounts: Readonly<Record<string, FileProvider>>): Pick<FileProvider, "stat" | "read" | "list" | "write" | "remove"> {
  const of = (address: FileAddress) => {
    const provider = mounts[address.mount];
    if (!provider) throw new Error(`mount "${address.mount}" is not available to this actor`);
    return provider;
  };
  return {
    stat: address => of(address).stat(address),
    read: address => of(address).read(address),
    list: address => of(address).list(address),
    write: (address, content, condition, effect) => of(address).write(address, content, condition, effect),
    remove: (address, expected, effect) => of(address).remove(address, expected, effect),
  };
}

export async function createRuntime(options: RuntimeOptions): Promise<Runtime> {
  const { host, app } = options;
  const repairs = options.repairs ?? 2;
  const store = new Store(options.store);
  const interrupted = store.failInterrupted();
  for (const run of interrupted) store.addMessage(run.thread, run.id, { role: "agent", run: run.id, parts: [{ type: "text", text: run.error ?? "interrupted" }] });

  // Helper tools: the application's handlers plus the ones a definition brings. A name declared without a handler is a load error, not a runtime surprise (AGENT-3).
  const registered = new Map<string, ToolDefinition>();
  for (const tool of options.tools ?? []) registered.set(tool.name, tool);
  for (const definition of app.agents.values()) for (const tool of definition.tools?.({ dir: definition.dir }) ?? []) if (!registered.has(tool.name)) registered.set(tool.name, tool);
  for (const definition of app.agents.values()) for (const name of definition.helperTools) if (!registered.has(name)) throw new Error(`agent "${definition.name}" declares helper tool "${name}" but no handler is registered for it`);

  const declared = [...app.agents.values()];
  const { providers, modelFor } = providersFor(options.model, declared.map(d => d.name), declared.flatMap(d => (d.tool ? [d.tool.name] : [])));
  await startFlue({ providers, dbFile: options.store === ":memory:" ? undefined : `${options.store}.flue` });

  const maxConcurrent = options.maxConcurrent ?? 6;
  let active = 0;
  const queue: (() => void)[] = [];
  const slot = () => new Promise<void>(resolve => { if (active < maxConcurrent) { active++; resolve(); } else queue.push(resolve); });
  const release = () => { const next = queue.shift(); if (next) next(); else active--; };
  const pending = new Set<Promise<unknown>>();
  const track = <T>(promise: Promise<T>) => { pending.add(promise); promise.finally(() => pending.delete(promise)).catch(() => {}); return promise; };

  const settingsFor = (definition: AgentDefinition): { model: string; effort?: Effort } => {
    const override = options.models?.[definition.name] ?? {};
    return { model: modelFor(definition.name, override.model ?? definition.model), effort: override.effort ?? definition.effort };
  };
  const agentOf = (name: string): AgentDefinition => { const d = app.agents.get(name); if (!d) throw new RuntimeError(404, `unknown agent "${name}"`); return d; };
  const ownThread = (actor: Actor, id: string): ThreadRecord => {
    const thread = store.thread(id);
    if (!thread || thread.actor !== actor.id) throw new RuntimeError(404, `unknown thread "${id}"`);
    return thread;
  };
  const ownRun = (actor: Actor, id: string): RunRecord => {
    const run = store.run(id);
    if (!run || run.actor !== actor.id) throw new RuntimeError(404, `unknown run "${id}"`);
    return run;
  };
  const asRun = (run: RunRecord): Run => ({ id: run.id, thread: run.thread, status: run.status, ...(run.error ? { error: run.error } : {}) });

  /** The tools offered to the model: declared by the definition, intersected with what the host allows this actor (AGENT-3). */
  async function offeredTools(definition: AgentDefinition, actor: Actor): Promise<readonly ToolDefinition[]> {
    const allowed = new Set(await host.allowedTools(actor));
    return definition.helperTools.filter(name => allowed.has(name)).map(name => registered.get(name)!);
  }

  /** Wraps a tool for one run: admission before a mutating effect, a receipt after every call, the effect issued by the loop (AGENT-2, AGENT-4). */
  function bindTools(tools: readonly ToolDefinition[], run: RunRecord, actor: Actor): readonly OfferedTool[] {
    return tools.map(tool => ({
      name: tool.name, description: tool.description, input: tool.input,
      run: async (input: Record<string, unknown>) => {
        const current = store.run(run.id)!;
        const effect = { actor: actor.id, thread: run.thread, run: run.id, tool: tool.name };
        if (current.cancelRequested || (tool.mutates && !(await host.isActive(asRun(current))))) {
          store.addReceipt({ ...effect, inputHash: hashOf(input), ok: false, revisions: null });
          throw new Error(`${tool.name}: refused, the run may no longer act`);
        }
        const revisions: unknown[] = [];
        const files = mountRouter(await host.mounts(actor));
        const recording: typeof files = {
          ...files,
          write: async (address, content, condition, _effect) => { const ref = await files.write(address, content, condition, effect); revisions.push({ ...address, revision: ref.revision }); return ref; },
          remove: async (address, expected, _effect) => { const ref = await files.remove(address, expected, effect); revisions.push({ ...address, revision: ref.revision }); return ref; },
        };
        try {
          const output = await tool.handler(input, { effect, files: recording });
          store.addReceipt({ ...effect, inputHash: hashOf(input), ok: true, revisions });
          return typeof output === "string" ? output : JSON.stringify(output ?? null);
        } catch (error) {
          store.addReceipt({ ...effect, inputHash: hashOf(input), ok: false, revisions });
          throw error;
        }
      },
    }));
  }

  /** Runs one recorded run to its single end (AGENT-1); every effect after a stop is refused (AGENT-6). */
  async function execute(run: RunRecord, definition: AgentDefinition, actor: Actor, message: string, history: History, tools: readonly ToolDefinition[], settings: { model: string; effort?: Effort }): Promise<RunRecord> {
    await slot();
    try {
      if (!store.startRun(run.id)) { store.finishRun(run.id, { status: "cancelled" }); return store.run(run.id)!; }
      const result = await runAgent(definition, {
        runId: run.id, message, history, tools: bindTools(tools, run, actor), validate: definition.validate, repairs, ...settings,
        cancelled: () => !!store.run(run.id)?.cancelRequested,
        onUsage: async usage => {
          const row: Usage = { actor: actor.id, thread: run.thread, run: run.id, agent: definition.name, model: usage.model, input: usage.input, output: usage.output, cached: usage.cached, at: new Date().toISOString() };
          store.addUsage(row);
          await host.onUsage(row);
        },
      });
      if (store.run(run.id)!.cancelRequested) { store.finishRun(run.id, { status: "cancelled", attempts: result.attempts }); }
      else if (!(await host.isActive(asRun(store.run(run.id)!)))) { store.finishRun(run.id, { status: "failed", error: "the host no longer allows this run to act", attempts: result.attempts }); }
      else {
        // The answer lands before the terminal transition, so a run's event stream ends with its output in it.
        store.addMessage(run.thread, run.id, { role: "agent", run: run.id, parts: [{ type: "text", text: definition.asText(result.output) }] });
        store.finishRun(run.id, { status: "completed", output: result.output, attempts: result.attempts });
      }
    } catch (error) {
      if (error instanceof CancelledError || store.run(run.id)!.cancelRequested) store.finishRun(run.id, { status: "cancelled" });
      else {
        const text = error instanceof OutputError ? error.message : `run failed: ${(error as Error).message}`;
        store.addMessage(run.thread, run.id, { role: "agent", run: run.id, parts: [{ type: "text", text }] });
        store.finishRun(run.id, { status: "failed", error: text });
      }
    } finally { release(); }
    return store.run(run.id)!;
  }

  type Launch = { definition: AgentDefinition; actor: Actor; thread: ThreadRecord; input: Record<string, unknown>; personText: string | null; history: History; job?: string | null };
  /** Admission, the record, the person's message, then the background execution. */
  async function launch(request: Launch): Promise<{ run: RunRecord; done: Promise<RunRecord> }> {
    const { definition, actor, thread } = request;
    const tools = await offeredTools(definition, actor);
    if (!(await host.mayRequest(actor, { thread: thread.id, tools: tools.map(t => t.name), grants: [] }))) throw new RuntimeError(403, "the host does not allow this request");
    const settings = settingsFor(definition);
    const input = { rules: definition.rules, ...request.input };
    let message: string;
    try { message = definition.buildMessage(input); } catch (error) { throw new RuntimeError(400, `${definition.name}: ${(error as Error).message}`); }
    const run = store.createRun({ thread: thread.id, agent: definition.name, actor: actor.id, job: request.job ?? null, input: request.input, model: settings.model });
    if (request.personText !== null) store.addMessage(thread.id, run.id, { role: "person", run: run.id, parts: [{ type: "text", text: request.personText }] });
    const done = track(execute(run, definition, actor, message, request.history, tools, settings));
    return { run, done };
  }

  function threadFor(actor: Actor, id: string | undefined): ThreadRecord { return id ? ownThread(actor, id) : store.createThread(actor.id); }

  /** Same key and same request: the recorded target. Same key, another request: 409 (SPEC §4.3). */
  function dedupe<T>(actor: Actor, key: string | undefined, request: unknown, find: (target: string) => T): T | null {
    if (!key) return null;
    const seen = store.idempotent(actor.id, key, request);
    if (!seen) return null;
    if ("conflict" in seen) throw new RuntimeError(409, `idempotency key "${key}" was used with a different request`);
    return find(seen.target);
  }

  let stopped = false;
  const runtime: Runtime = {
    store,
    manifest: () => manifestOf(app),

    async startRun(actor, request) {
      const definition = agentOf(request.agent);
      const body = { agent: request.agent, message: request.message ?? null, inputs: request.inputs ?? {}, thread: request.thread ?? null };
      const seen = dedupe(actor, request.idempotencyKey, body, target => store.run(target));
      if (seen) return seen;
      const thread = threadFor(actor, request.thread);
      const input = { ...(request.inputs ?? {}), ...(request.message !== undefined ? { message: request.message } : {}) };
      const { run } = await launch({ definition, actor, thread, input, personText: request.message ?? JSON.stringify(request.inputs ?? {}), history: [] });
      if (request.idempotencyKey) store.rememberKey(actor.id, request.idempotencyKey, body, run.id);
      return run;
    },

    run: (actor, id) => ownRun(actor, id),

    async cancel(actor, id) {
      const run = ownRun(actor, id);
      if (isTerminal(run.status)) throw new RuntimeError(409, `run "${id}" already ended (${run.status})`);
      store.requestCancel(id);
      if (run.status === "pending") store.finishRun(id, { status: "cancelled" });
      else await abortRun(agentOf(run.agent), id);
      return store.run(id)!;
    },

    async startJob(actor, request) {
      const definition: JobDefinition | undefined = app.jobs.get(request.job);
      if (!definition) throw new RuntimeError(404, `unknown job "${request.job}"`);
      const body = { job: request.job, inputs: request.inputs ?? {}, thread: request.thread ?? null };
      const seen = dedupe(actor, request.idempotencyKey, body, target => store.job(target));
      if (seen) return seen;
      const inputs = request.inputs ?? {};
      let plan: readonly { agent: string; input: Record<string, unknown> }[];
      try { plan = await definition.plan(inputs); } catch (error) { throw new RuntimeError(400, `${definition.name}: ${(error as Error).message}`); }
      // Composition is predeclared: a child the definition did not name is refused before anything is recorded.
      for (const child of plan) if (!definition.children.includes(child.agent)) throw new RuntimeError(400, `job "${definition.name}" cannot start "${child.agent}": not among its declared children`);
      if (!plan.length) throw new RuntimeError(400, `job "${definition.name}" planned no children`);
      const thread = threadFor(actor, request.thread);
      const job = store.createJob({ definition: definition.name, actor: actor.id, thread: thread.id, input: inputs });
      if (request.idempotencyKey) store.rememberKey(actor.id, request.idempotencyKey, body, job.id);
      const children: { agent: string; done: Promise<RunRecord> }[] = [];
      try {
        for (const child of plan) {
          const { done } = await launch({ definition: agentOf(child.agent), actor, thread, input: child.input, personText: null, history: [], job: job.id });
          children.push({ agent: child.agent, done });
        }
      } catch (error) {
        store.finishJob(job.id, { status: "failed", error: (error as Error).message });
        throw error;
      }
      // A parent completes only from completed children; a failed or cancelled child fails the parent.
      track(Promise.all(children.map(c => c.done)).then(runs => {
        const bad = runs.find(r => r.status !== "completed");
        if (bad) { store.finishJob(job.id, { status: bad.status === "cancelled" ? "cancelled" : "failed", error: bad.error ?? `child ${bad.agent} ${bad.status}` }); return; }
        try { store.finishJob(job.id, { status: "completed", output: definition.collect(runs.map(r => ({ agent: r.agent, output: r.output })), inputs) }); }
        catch (error) { store.finishJob(job.id, { status: "failed", error: `collect: ${(error as Error).message}` }); }
      }));
      return store.job(job.id)!;
    },

    job(actor, id) {
      const job = store.job(id);
      if (!job || job.actor !== actor.id) throw new RuntimeError(404, `unknown job "${id}"`);
      return job;
    },

    async say(actor, request) {
      const definition: ConversationDefinition | undefined = app.conversations.get(request.conversation);
      if (!definition) throw new RuntimeError(404, `unknown conversation "${request.conversation}"`);
      const text = typeof request.text === "string" ? request.text.trim() : "";
      if (!text) throw new RuntimeError(400, "text is required");
      const body = { conversation: request.conversation, text, inputs: request.inputs ?? {}, thread: request.thread ?? null };
      const seen = dedupe(actor, request.idempotencyKey, body, target => { const run = store.run(target)!; return { thread: store.thread(run.thread)!, run }; });
      if (seen) return seen;
      const thread = threadFor(actor, request.thread);
      const history: History = store.eventsOf({ thread: thread.id }).flatMap(event => {
        if (event.kind !== "message") return [];
        const content = event.message.parts.filter(p => p.type === "text").map(p => (p as { text: string }).text).join("\n");
        return content ? [{ role: event.message.role === "person" ? "user" as const : "assistant" as const, content }] : [];
      }).slice(-definition.history);
      const context = definition.context ? await definition.context({ ...(request.inputs ?? {}), thread: thread.id, text }) : {};
      const { run } = await launch({ definition: agentOf(definition.agent), actor, thread, input: { ...context, ...(request.inputs ?? {}), text }, personText: text, history });
      if (request.idempotencyKey) store.rememberKey(actor.id, request.idempotencyKey, body, run.id);
      return { thread, run };
    },

    thread: (actor, id) => ownThread(actor, id),

    events(actor, scope, cursor) {
      if (scope.run) { const run = ownRun(actor, scope.run); return { replay: store.eventsOf({ run: run.id }, cursor), subscribe: listener => store.subscribe({ run: run.id }, listener) }; }
      const thread = ownThread(actor, scope.thread ?? "");
      return { replay: store.eventsOf({ thread: thread.id }, cursor), subscribe: listener => store.subscribe({ thread: thread.id }, listener) };
    },

    async idle() { while (pending.size) await Promise.allSettled([...pending]); },
    async stop() { if (stopped) return; stopped = true; await runtime.idle(); await stopFlue(); store.close(); },
  };
  return runtime;
}
