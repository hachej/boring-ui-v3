/**
 * The runtime an application creates once: it loads nothing itself (the registry comes from
 * `loadApp`), starts Flue with the host's model access, opens the store, and answers the
 * request-work operations the wire exposes. Every authority question goes to the Host (AGENT-8):
 * who the actor is, whether they may request, which tools they may see, whether a run may still act.
 */
import type { Receipt } from "@boring/files";
import type { Actor, AgentDefinition, ConversationDefinition, Effort, Grant, JobDefinition, Run, RuntimeOptions, ToolDefinition, UiAnswer, UiRegistration, Usage } from "../index.ts";
import { OutputError } from "../errors.ts";
import { phrasesFor } from "../phrases.ts";
import type { Event, UiCommandSpec, UiRegistrationView, UiRequestView } from "../wire.ts";
import { FILE_TOOLS, fileTools, grantsFor, guardedFiles } from "./files.ts";
import { Store, hashOf, isTerminal, type JobRecord, type RunRecord, type ThreadRecord } from "./store.ts";
import { providersFor } from "./providers.ts";
import { CancelledError, abortRun, runAgent, startFlue, stopFlue, type OfferedTool } from "./flue.ts";
import { manifestOf, type Manifest } from "../wire/manifest.ts";
import { READ_IMAGES, ReadImagesRefused, describeImages, readAll, resolveReading, type ReadImagesRequest, type ReadImagesResult } from "./images.ts";

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
  /** The runs a job started, in plan order (AGENT-12). */
  children(actor: Actor, job: string): readonly RunRecord[];
  /** Resolves with the run once it has ended (completed, failed or cancelled); at once if it already has. */
  wait(actor: Actor, run: string): Promise<RunRecord>;
  say(actor: Actor, request: ConversationMessageRequest): Promise<{ thread: ThreadRecord; run: RunRecord }>;
  thread(actor: Actor, id: string): ThreadRecord;
  /** An empty thread for this actor, so a page can register its commands before the first message. */
  createThread(actor: Actor): ThreadRecord;
  /** Replay after the cursor, then live events until `until` says stop or the unsubscribe is called. */
  events(actor: Actor, scope: { run?: string; thread?: string }, cursor?: string): { replay: readonly Event[]; subscribe: (listener: (event: Event) => void) => () => void };
  /** A page instance registers the commands the agent may request of it on this thread (CHAT-3). Registering grants nothing (UI-BOUNDARY-1). */
  registerUi(actor: Actor, thread: string, registration: UiRegistration): UiRegistrationView;
  /** The page goes away: its open requests end `unavailable` (UI-BOUNDARY-4). */
  unregisterUi(actor: Actor, thread: string, page: string): void;
  uiRegistrations(actor: Actor, thread: string): readonly UiRegistrationView[];
  /** One answer per request, from the run's actor and the bound page; a second answer or a wrong page is refused. */
  answerUi(actor: Actor, run: string, requestId: string, answer: UiAnswer): UiRequestView;
  /**
   * Reads images with one model call each (AGENT-15): admitted by the host, recorded as a run of
   * `read-images` on the actor's thread, every call metered (AGENT-10). Resolves once the run ended,
   * with one reading per image in order. A malformed request or a model without image input is 400.
   */
  readImages(actor: Actor, request: ReadImagesRequest): Promise<ReadImagesResult>;
  /** Resolves when no run is in flight (tests, graceful stop). */
  idle(): Promise<void>;
  stop(): Promise<void>;
}

type History = { role: "user" | "assistant"; content: string }[];

export async function createRuntime(options: RuntimeOptions): Promise<Runtime> {
  const { host, app } = options;
  const repairs = options.repairs ?? 2;
  const uiTimeout = options.uiTimeout ?? 30_000;
  const store = new Store(options.store);
  const phrases = phrasesFor(options.language, options.phrases);
  const interrupted = store.failInterrupted(phrases.interrupted);
  for (const run of interrupted) store.addMessage(run.thread, run.id, { role: "agent", run: run.id, parts: [{ type: "text", text: run.error ?? "interrupted" }] });

  // Helper tools: the application's handlers plus the ones a definition brings. A name declared without a handler is a load error, not a runtime surprise (AGENT-3).
  const registered = new Map<string, ToolDefinition>();
  for (const tool of options.tools ?? []) registered.set(tool.name, tool);
  for (const definition of app.agents.values()) for (const tool of definition.tools?.({ dir: definition.dir }) ?? []) if (!registered.has(tool.name)) registered.set(tool.name, tool);
  for (const definition of app.agents.values()) for (const name of definition.helperTools) if (!registered.has(name)) throw new Error(`agent "${definition.name}" declares helper tool "${name}" but no handler is registered for it`);
  // The library's file tools: offered when a definition declares `files:` and the host allows them for the actor (AGENT-3).
  const library = new Map<string, ToolDefinition>(fileTools().map(tool => [tool.name, tool]));
  for (const name of library.keys()) if (registered.has(name)) throw new Error(`tool "${name}" is a library file tool; an application cannot register a handler under that name`);

  // Page registrations: thread → page → what the page offers. Presentation state, rebuilt by the page on reconnect (BORING-4).
  const pages = new Map<string, Map<string, UiRegistration>>();
  const waiting = new Map<string, { resolve: (view: UiRequestView) => void; timer: NodeJS.Timeout }>();
  const settleUi = (id: string, end: { state: "answered" | "expired" | "unavailable"; result?: UiRequestView["result"] }) => {
    const view = store.settleUiRequest(id, end);
    const waiter = waiting.get(id);
    if (waiter) { clearTimeout(waiter.timer); waiting.delete(id); if (view) waiter.resolve(view); }
    return view;
  };
  const declared = [...app.agents.values()];
  if (app.agents.has(READ_IMAGES)) throw new Error(`"${READ_IMAGES}" is the runtime's own run name for reading images; an agent cannot take it`);
  const { providers, models, modelFor } = providersFor(options.model, [...declared.map(d => d.name), READ_IMAGES], declared.flatMap(d => (d.tool ? [d.tool.name] : [])));
  await startFlue({ providers, dbFile: options.store === ":memory:" ? undefined : `${options.store}.flue` });

  const maxConcurrent = options.maxConcurrent ?? 6;
  let active = 0;
  const queue: (() => void)[] = [];
  const slot = () => new Promise<void>(resolve => { if (active < maxConcurrent) { active++; resolve(); } else queue.push(resolve); });
  const release = () => { const next = queue.shift(); if (next) next(); else active--; };
  const pending = new Set<Promise<unknown>>();
  const track = <T>(promise: Promise<T>) => { pending.add(promise); promise.finally(() => pending.delete(promise)).catch(() => {}); return promise; };

  const settingsFor = (definition: AgentDefinition): { model: string; effort?: Effort } => {
    // A function is asked at every run: the application's setting as it stands now (AGENT-8).
    const models = options.models;
    const override = (typeof models === "function" ? models(definition.name) : models?.[definition.name]) ?? {};
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

  /**
   * The tools offered to the model (AGENT-3): the definition's helper tools, the file tools when it declares
   * `files:`, and the page commands it names under `ui:` that a page registered on this thread; each
   * intersected with what the host allows this actor. A page command shadows no other tool.
   */
  async function offeredTools(definition: AgentDefinition, actor: Actor, thread: string): Promise<readonly ToolDefinition[]> {
    const allowed = new Set(await host.allowedTools(actor));
    const tools: ToolDefinition[] = definition.helperTools.filter(name => allowed.has(name)).map(name => registered.get(name)!);
    if (definition.files.length) for (const name of FILE_TOOLS) if (allowed.has(name)) tools.push(library.get(name)!);
    const taken = new Set(tools.map(t => t.name));
    for (const [page, registration] of pages.get(thread) ?? []) for (const command of registration.commands) {
      if (!definition.uiCommands.includes(command.name) || !allowed.has(command.name) || taken.has(command.name)) continue;
      taken.add(command.name);
      tools.push(uiTool(command, page, thread));
    }
    return tools;
  }

  /** A page command as a tool of kind `ui`: running it is a request to the page, answered once or expired (UI-BOUNDARY-4, -5). */
  function uiTool(command: UiCommandSpec, page: string, thread: string): ToolDefinition {
    return {
      name: command.name, description: `${command.description} (a request to the page; the result says whether it was applied locally, committed by the application, or refused)`, input: command.input, mutates: true,
      handler: async (input, operations) => {
        const registration = pages.get(thread)?.get(page);
        if (!registration || !registration.commands.some(c => c.name === command.name)) return { outcome: "unavailable", detail: "the page that offered this command is gone" };
        const request = store.createUiRequest({ run: operations.effect.run!, thread, page, command: command.name, input, target: registration.target });
        const settled = await new Promise<UiRequestView>(resolve => {
          const timer = setTimeout(() => settleUi(request.id, { state: "expired" }), uiTimeout);
          timer.unref?.();
          waiting.set(request.id, { resolve, timer });
        });
        return settled.state === "answered" ? settled.result : { outcome: "unavailable", detail: settled.state === "expired" ? `the page did not answer within ${uiTimeout} ms` : "the page went away" };
      },
    };
  }

  /**
   * Wraps a tool for one run: admission before a mutating effect, a receipt after every call, the effect issued by
   * the loop (AGENT-2, AGENT-4). Files come from the host's table at call time, confined to the run's grants; each
   * mutation's receipt (mount, path, revision before and after) lands in the run's receipt row.
   */
  function bindTools(tools: readonly ToolDefinition[], run: RunRecord, actor: Actor, grants: readonly Grant[]): readonly OfferedTool[] {
    return tools.map(tool => ({
      name: tool.name, description: tool.description, input: tool.input,
      run: async (input: Record<string, unknown>) => {
        const current = store.run(run.id)!;
        const effect = { actor: actor.id, thread: run.thread, run: run.id, tool: tool.name };
        if (current.cancelRequested || (tool.mutates && !(await host.isActive(asRun(current))))) {
          store.addReceipt({ ...effect, inputHash: hashOf(input), ok: false, revisions: null });
          throw new Error(`${tool.name}: refused, the run may no longer act`);
        }
        const revisions: Receipt[] = [];
        const files = guardedFiles(await host.mounts(actor), grants);
        const recording: typeof files = {
          ...files,
          write: async (address, content, condition, _effect) => { const receipt = await files.write(address, content, condition, effect); revisions.push(receipt); return receipt; },
          remove: async (address, expected, _effect) => { const receipt = await files.remove(address, expected, effect); revisions.push(receipt); return receipt; },
        };
        const mounts = [...new Set(grants.map(g => g.mount))];
        const record = (ok: boolean, output?: unknown) => {
          store.addReceipt({ ...effect, inputHash: hashOf(input), ok, revisions: revisions.map(r => ({ mount: r.address.mount, path: r.address.path, before: r.before, after: r.after })) });
          store.addMessage(run.thread, run.id, { role: "agent", run: run.id, parts: [{ type: "tool", name: tool.name, input, state: ok ? "done" : "error", ...(ok ? { output } : { error: String(output) }) }] });
        };
        try {
          const output = await tool.handler(input, { effect, files: recording, mounts });
          record(true, output);
          return typeof output === "string" ? output : JSON.stringify(output ?? null);
        } catch (error) {
          record(false, (error as Error).message);
          throw error;
        }
      },
    }));
  }

  /** Runs one recorded run to its single end (AGENT-1); every effect after a stop is refused (AGENT-6). */
  async function execute(run: RunRecord, definition: AgentDefinition, actor: Actor, message: string, history: History, tools: readonly ToolDefinition[], grants: readonly Grant[], settings: { model: string; effort?: Effort }): Promise<RunRecord> {
    await slot();
    try {
      if (!store.startRun(run.id)) { store.finishRun(run.id, { status: "cancelled" }); return store.run(run.id)!; }
      const result = await runAgent(definition, {
        runId: run.id, message, history, tools: bindTools(tools, run, actor, grants), validate: definition.validate, repairs, phrases, ...settings,
        cancelled: () => !!store.run(run.id)?.cancelRequested,
        onUsage: async usage => {
          const row: Usage = { actor: actor.id, thread: run.thread, run: run.id, agent: definition.name, model: usage.model, input: usage.input, output: usage.output, cached: usage.cached, cost: usage.cost, at: new Date().toISOString() };
          store.addUsage(row);
          await host.onUsage(row);
        },
      });
      if (store.run(run.id)!.cancelRequested) { store.finishRun(run.id, { status: "cancelled", attempts: result.attempts }); }
      else if (!(await host.isActive(asRun(store.run(run.id)!)))) { store.finishRun(run.id, { status: "failed", error: phrases.revoked, failure: "revoked", attempts: result.attempts }); }
      else {
        // The answer lands before the terminal transition, so a run's event stream ends with its output in it.
        store.addMessage(run.thread, run.id, { role: "agent", run: run.id, parts: [{ type: "text", text: definition.asText(result.output) }] });
        store.finishRun(run.id, { status: "completed", output: result.output, attempts: result.attempts });
      }
    } catch (error) {
      if (error instanceof CancelledError || store.run(run.id)!.cancelRequested) store.finishRun(run.id, { status: "cancelled" });
      else {
        const invalid = error instanceof OutputError;
        const text = invalid ? error.message : phrases.runFailed((error as Error).message);
        store.addMessage(run.thread, run.id, { role: "agent", run: run.id, parts: [{ type: "text", text }] });
        store.finishRun(run.id, { status: "failed", error: text, failure: invalid ? "invalid_output" : "error" });
      }
    } finally {
      release();
      for (const open of store.openUiRequests({ run: run.id })) settleUi(open.id, { state: "unavailable" });
    }
    return store.run(run.id)!;
  }

  type Launch = { definition: AgentDefinition; actor: Actor; thread: ThreadRecord; input: Record<string, unknown>; personText: string | null; history: History; job?: string | null };
  /** Admission, the record, the person's message, then the background execution. */
  async function launch(request: Launch): Promise<{ run: RunRecord; done: Promise<RunRecord> }> {
    const { definition, actor, thread } = request;
    const tools = await offeredTools(definition, actor, thread.id);
    // Grants: the definition's needs against the mounts the host gives this actor, admitted per run (AGENT-8).
    const grants = definition.files.length ? grantsFor(definition.files, Object.keys(await host.mounts(actor))) : [];
    if (!(await host.mayRequest(actor, { agent: definition.name, thread: thread.id, tools: tools.map(t => t.name), grants }))) throw new RuntimeError(403, "the host does not allow this request");
    const settings = settingsFor(definition);
    const input = { rules: definition.rules, ...request.input };
    let message: string;
    try { message = definition.buildMessage(input); } catch (error) { throw new RuntimeError(400, `${definition.name}: ${(error as Error).message}`); }
    const run = store.createRun({ thread: thread.id, agent: definition.name, actor: actor.id, job: request.job ?? null, input: request.input, model: settings.model });
    if (request.personText !== null) store.addMessage(thread.id, run.id, { role: "person", run: run.id, parts: [{ type: "text", text: request.personText }] });
    const done = track(execute(run, definition, actor, message, request.history, tools, grants, settings));
    return { run, done };
  }

  function threadFor(actor: Actor, id: string | undefined): ThreadRecord { return id ? ownThread(actor, id) : store.createThread(actor.id); }

  /**
   * Same key and same request: the recorded target. Same key, another request: 409 (SPEC §4.3, AGENT-11). The key is
   * reserved synchronously before `create` awaits anything, so a concurrent same-key request finds the reservation and
   * waits for its target instead of creating a second one; a `create` that fails releases the key.
   */
  const inflight = new Map<string, Promise<string>>();
  async function keyed<T>(actor: Actor, key: string | undefined, request: unknown, find: (target: string) => T, create: () => Promise<{ target: string; value: T }>): Promise<T> {
    if (!key) return (await create()).value;
    const slotKey = `${actor.id}\u0000${key}`;
    const reservation = store.reserveKey(actor.id, key, request);
    if (reservation.state === "conflict") throw new RuntimeError(409, `idempotency key "${key}" was used with a different request`);
    if (reservation.state === "recorded") return find(reservation.target);
    if (reservation.state === "pending") {
      const waiting = inflight.get(slotKey);
      if (!waiting) throw new RuntimeError(409, `idempotency key "${key}" is being used by a request still in progress`);
      return find(await waiting);
    }
    let settle!: { resolve: (target: string) => void; reject: (error: unknown) => void };
    const promise = new Promise<string>((resolve, reject) => { settle = { resolve, reject }; });
    promise.catch(() => {});
    inflight.set(slotKey, promise);
    try {
      const { target, value } = await create();
      store.fillKey(actor.id, key, target);
      settle.resolve(target);
      return value;
    } catch (error) {
      store.releaseKey(actor.id, key);
      settle.reject(error);
      throw error;
    } finally { inflight.delete(slotKey); }
  }

  /** Reading runs in flight: a cancel aborts their model calls. */
  const readers = new Map<string, AbortController>();
  let stopped = false;
  const runtime: Runtime = {
    store,
    manifest: () => manifestOf(app),

    async startRun(actor, request) {
      const definition = agentOf(request.agent);
      const body = { agent: request.agent, message: request.message ?? null, inputs: request.inputs ?? {}, thread: request.thread ?? null };
      return keyed(actor, request.idempotencyKey, body, target => store.run(target)!, async () => {
        const thread = threadFor(actor, request.thread);
        const input = { ...(request.inputs ?? {}), ...(request.message !== undefined ? { message: request.message } : {}) };
        const { run } = await launch({ definition, actor, thread, input, personText: request.message ?? JSON.stringify(request.inputs ?? {}), history: [] });
        return { target: run.id, value: run };
      });
    },

    run: (actor, id) => ownRun(actor, id),

    async cancel(actor, id) {
      const run = ownRun(actor, id);
      if (isTerminal(run.status)) throw new RuntimeError(409, `run "${id}" already ended (${run.status})`);
      store.requestCancel(id);
      if (run.status === "pending") store.finishRun(id, { status: "cancelled" });
      else if (run.agent === READ_IMAGES) readers.get(id)?.abort();
      else await abortRun(agentOf(run.agent), id);
      return store.run(id)!;
    },

    async startJob(actor, request) {
      const definition: JobDefinition | undefined = app.jobs.get(request.job);
      if (!definition) throw new RuntimeError(404, `unknown job "${request.job}"`);
      const body = { job: request.job, inputs: request.inputs ?? {}, thread: request.thread ?? null };
      return keyed(actor, request.idempotencyKey, body, target => store.job(target)!, async () => {
        const inputs = request.inputs ?? {};
        let plan: readonly { agent: string; input: Record<string, unknown> }[];
        try { plan = await definition.plan(inputs); } catch (error) { throw new RuntimeError(400, `${definition.name}: ${(error as Error).message}`); }
        // Composition is predeclared: a child the definition did not name is refused before anything is recorded.
        for (const child of plan) if (!definition.children.includes(child.agent)) throw new RuntimeError(400, `job "${definition.name}" cannot start "${child.agent}": not among its declared children`);
        if (!plan.length) throw new RuntimeError(400, `job "${definition.name}" planned no children`);
        const thread = threadFor(actor, request.thread);
        const job = store.createJob({ definition: definition.name, actor: actor.id, thread: thread.id, input: inputs });
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
        return { target: job.id, value: store.job(job.id)! };
      });
    },

    job(actor, id) {
      const job = store.job(id);
      if (!job || job.actor !== actor.id) throw new RuntimeError(404, `unknown job "${id}"`);
      return job;
    },

    children(actor, id) {
      runtime.job(actor, id);
      return store.runsOfJob(id);
    },

    wait(actor, id) {
      const run = ownRun(actor, id);
      if (isTerminal(run.status)) return Promise.resolve(run);
      return new Promise(resolve => {
        let off = () => {};
        off = store.subscribe({ run: id }, event => {
          if (event.kind === "run" && isTerminal((event.run as { status: RunRecord["status"] }).status)) { off(); resolve(store.run(id)!); }
        });
        // It may have ended between the read and the subscription.
        const now = store.run(id)!;
        if (isTerminal(now.status)) { off(); resolve(now); }
      });
    },

    async say(actor, request) {
      const definition: ConversationDefinition | undefined = app.conversations.get(request.conversation);
      if (!definition) throw new RuntimeError(404, `unknown conversation "${request.conversation}"`);
      const text = typeof request.text === "string" ? request.text.trim() : "";
      if (!text) throw new RuntimeError(400, "text is required");
      const body = { conversation: request.conversation, text, inputs: request.inputs ?? {}, thread: request.thread ?? null };
      return keyed(actor, request.idempotencyKey, body, target => { const run = store.run(target)!; return { thread: store.thread(run.thread)!, run }; }, async () => {
      const thread = threadFor(actor, request.thread);
      const history: History = store.eventsOf({ thread: thread.id }).flatMap(event => {
        if (event.kind !== "message") return [];
        const content = event.message.parts.filter(p => p.type === "text").map(p => (p as { text: string }).text).join("\n");
        return content ? [{ role: event.message.role === "person" ? "user" as const : "assistant" as const, content }] : [];
      }).slice(-definition.history);
      const context = definition.context ? await definition.context({ ...(request.inputs ?? {}), thread: thread.id, text }) : {};
      const { run } = await launch({ definition: agentOf(definition.agent), actor, thread, input: { ...context, ...(request.inputs ?? {}), text }, personText: text, history });
      return { target: run.id, value: { thread, run } };
      });
    },

    thread: (actor, id) => ownThread(actor, id),
    createThread: actor => store.createThread(actor.id),

    events(actor, scope, cursor) {
      if (scope.run) { const run = ownRun(actor, scope.run); return { replay: store.eventsOf({ run: run.id }, cursor), subscribe: listener => store.subscribe({ run: run.id }, listener) }; }
      const thread = ownThread(actor, scope.thread ?? "");
      return { replay: store.eventsOf({ thread: thread.id }, cursor), subscribe: listener => store.subscribe({ thread: thread.id }, listener) };
    },

    registerUi(actor, thread, registration) {
      ownThread(actor, thread);
      if (!/^[A-Za-z0-9_-]{1,64}$/.test(registration.page)) throw new RuntimeError(400, "page must be an id of 1-64 letters, digits, - or _");
      const seen = new Set<string>();
      for (const command of registration.commands) {
        if (!/^[a-z][a-z0-9_-]*$/.test(command.name)) throw new RuntimeError(400, `command "${command.name}" is not a valid name`);
        if (seen.has(command.name)) throw new RuntimeError(400, `command "${command.name}" is registered twice`);
        if (registered.has(command.name) || library.has(command.name)) throw new RuntimeError(409, `command "${command.name}" would shadow a backend tool`);
        if (typeof command.description !== "string" || !command.input || (command.input as { type?: string }).type !== "object") throw new RuntimeError(400, `command "${command.name}" needs a description and an object input schema`);
        seen.add(command.name);
      }
      const byPage = pages.get(thread) ?? new Map<string, UiRegistration>();
      const previous = byPage.get(registration.page);
      byPage.set(registration.page, registration);
      pages.set(thread, byPage);
      // A page that changed target while a request was open: the request bound the old target and cannot be answered against the new one.
      if (previous && JSON.stringify(previous.target ?? null) !== JSON.stringify(registration.target ?? null)) for (const open of store.openUiRequests({ page: registration.page })) settleUi(open.id, { state: "unavailable", result: { outcome: "stale", detail: "the page moved to another target" } });
      return { page: registration.page, commands: registration.commands, ...(registration.target ? { target: registration.target } : {}) };
    },
    unregisterUi(actor, thread, page) {
      ownThread(actor, thread);
      const byPage = pages.get(thread);
      if (byPage?.delete(page)) for (const open of store.openUiRequests({ page })) settleUi(open.id, { state: "unavailable" });
    },
    uiRegistrations(actor, thread) {
      ownThread(actor, thread);
      return [...(pages.get(thread)?.values() ?? [])].map(r => ({ page: r.page, commands: r.commands, ...(r.target ? { target: r.target } : {}) }));
    },
    answerUi(actor, runId, requestId, answer) {
      const run = ownRun(actor, runId);
      const request = store.uiRequest(requestId);
      if (!request || request.run !== run.id || request.page !== answer.page) throw new RuntimeError(404, `unknown ui request "${requestId}"`);
      const outcome = answer.result?.outcome;
      if (!["applied", "proposed", "committed", "stale", "conflict", "denied", "unavailable"].includes(outcome as string)) throw new RuntimeError(400, "result.outcome must be applied | proposed | committed | stale | conflict | denied | unavailable");
      const settled = settleUi(requestId, { state: "answered", result: { outcome: outcome!, ...(answer.result.detail !== undefined ? { detail: answer.result.detail } : {}), ...(answer.result.evidence !== undefined ? { evidence: answer.result.evidence } : {}) } });
      if (!settled) throw new RuntimeError(409, `ui request "${requestId}" is already ${store.uiRequest(requestId)!.state}`);
      return settled;
    },

    async readImages(actor, request) {
      const name = modelFor(READ_IMAGES, request.model);
      let model;
      try { model = resolveReading(models, name, request); } catch (error) { if (error instanceof ReadImagesRefused) throw new RuntimeError(error.status, error.message); throw error; }
      const thread = threadFor(actor, request.thread);
      if (!(await host.mayRequest(actor, { agent: READ_IMAGES, thread: thread.id, tools: [], grants: [] }))) throw new RuntimeError(403, "the host does not allow this request");
      const run = store.createRun({ thread: thread.id, agent: READ_IMAGES, actor: actor.id, input: { instruction: request.instruction, images: describeImages(request.images) }, model: name });
      const abort = new AbortController();
      const onAbort = () => abort.abort();
      request.signal?.addEventListener("abort", onAbort, { once: true });
      if (request.signal?.aborted) abort.abort();
      readers.set(run.id, abort);
      const onUsage = async (row: Usage) => host.onUsage(row);
      try { return await track(readAll({ store, models, phrases, onUsage, slot, release }, actor, run, model, name, request, abort)); }
      finally { readers.delete(run.id); request.signal?.removeEventListener("abort", onAbort); }
    },

    async idle() { while (pending.size) await Promise.allSettled([...pending]); },
    async stop() { if (stopped) return; stopped = true; await runtime.idle(); await stopFlue(); store.close(); },
  };
  return runtime;
}
