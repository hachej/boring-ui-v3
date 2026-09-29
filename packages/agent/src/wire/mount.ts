/**
 * The HTTP wire: a web-standard `fetch` handler (Hono) an application mounts under a prefix of its
 * own server. Identity comes from `Host.resolveActor(request)` on every request; nothing in a
 * header or a body names the actor (BORING-1, CHAT-4). Events stream as NDJSON: replay after the
 * cursor, then live until the run ends or the client goes away (CHAT-1).
 */
import { Hono } from "hono";
import type { Actor, Host } from "../index.ts";
import type { Event, UiCommandSpec, UiResult, UiTarget, WireError } from "../wire.ts";
import { RuntimeError, type Runtime } from "../runtime/runtime.ts";
import { isTerminal, runView } from "../runtime/store.ts";

export type WireOptions = Readonly<{ host: Host; runtime: Runtime; /** Path prefix the app mounts under, e.g. "/agent". Default "". */ basePath?: string }>;

type Env = { Variables: { actor: Actor } };

const failure = (status: number, error: string): Response => Response.json({ error, status } satisfies WireError, { status });

async function body(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (!text.trim()) return {};
  try { const parsed = JSON.parse(text); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}; }
  catch { throw new RuntimeError(400, "the body must be a JSON object"); }
}
const str = (value: unknown): string | undefined => (typeof value === "string" && value ? value : undefined);
const obj = (value: unknown): Record<string, unknown> | undefined => (value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined);

/** NDJSON: the replayed events, then live ones until `done(event)` or the client disconnects. */
function stream(replay: readonly Event[], subscribe: (listener: (event: Event) => void) => () => void, done: (event: Event | null) => boolean, signal: AbortSignal): Response {
  const encoder = new TextEncoder();
  let unsubscribe = () => {};
  const readable = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (event: Event) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      const close = () => { unsubscribe(); try { controller.close(); } catch { /* already closed */ } };
      // Subscribe before replaying so nothing between the two is lost; duplicates are impossible because cursors are monotonic.
      let last = replay.length ? Number(replay[replay.length - 1].cursor) : 0;
      unsubscribe = subscribe(event => { if (Number(event.cursor) <= last) return; last = Number(event.cursor); push(event); if (done(event)) close(); });
      for (const event of replay) push(event);
      if (done(null)) close();
      signal.addEventListener("abort", close, { once: true });
    },
    cancel() { unsubscribe(); },
  });
  return new Response(readable, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" } });
}

export function mountWire({ host, runtime, basePath = "" }: WireOptions): { fetch: (request: Request) => Promise<Response>; app: Hono<Env> } {
  const app = new Hono<Env>().basePath(basePath);
  app.onError((error, c) => {
    if (error instanceof RuntimeError) return failure(error.status, error.message);
    console.error(`[boring wire] ${c.req.method} ${c.req.path}:`, error);
    return failure(500, "internal error");
  });
  app.notFound(() => failure(404, "no such endpoint"));

  app.get("/.well-known/boring.json", c => c.json(runtime.manifest()));

  app.use("*", async (c, next) => {
    if (c.req.path.endsWith("/.well-known/boring.json")) return next();
    const actor = await host.resolveActor(c.req.raw);
    if (!actor) return failure(401, "not authenticated");
    c.set("actor", actor);
    await next();
  });

  app.post("/agents/:agent/runs", async c => {
    const b = await body(c.req.raw);
    const run = await runtime.startRun(c.get("actor"), { agent: c.req.param("agent"), message: str(b.message), inputs: obj(b.inputs), thread: str(b.thread), idempotencyKey: str(b.idempotencyKey) });
    return c.json(runView(run), 202);
  });
  app.get("/runs/:id", c => c.json(runView(runtime.run(c.get("actor"), c.req.param("id")))));
  app.get("/runs/:id/events", c => {
    const id = c.req.param("id");
    const { replay, subscribe } = runtime.events(c.get("actor"), { run: id }, c.req.query("cursor"));
    return stream(replay, subscribe, event => (event ? event.kind === "run" && isTerminal(event.run.status as never) : isTerminal(runtime.run(c.get("actor"), id).status)), c.req.raw.signal);
  });
  app.post("/runs/:id/cancel", async c => c.json(runView(await runtime.cancel(c.get("actor"), c.req.param("id")))));

  app.post("/jobs/:job/start", async c => {
    const b = await body(c.req.raw);
    const job = await runtime.startJob(c.get("actor"), { job: c.req.param("job"), inputs: obj(b.inputs), thread: str(b.thread), idempotencyKey: str(b.idempotencyKey) });
    return c.json(runtime.store.jobView(job), 202);
  });
  app.get("/jobs/:id", c => c.json(runtime.store.jobView(runtime.job(c.get("actor"), c.req.param("id")))));

  app.post("/conversations/:conversation/messages", async c => {
    const b = await body(c.req.raw);
    const { thread, run } = await runtime.say(c.get("actor"), { conversation: c.req.param("conversation"), text: String(b.text ?? ""), thread: str(b.thread), inputs: obj(b.inputs), idempotencyKey: str(b.idempotencyKey) });
    return c.json({ thread: thread.id, run: runView(run) }, 202);
  });

  // The page-command bridge (CHAT-3): a page registers what it offers, follows the thread's `ui` events and answers once.
  app.put("/threads/:id/ui/:page", async c => {
    const b = await body(c.req.raw);
    const commands = Array.isArray(b.commands) ? b.commands as UiCommandSpec[] : null;
    if (!commands) throw new RuntimeError(400, "commands must be a list of { name, description, input }");
    const target = obj(b.target);
    if (target && (typeof target.kind !== "string" || typeof target.id !== "string")) throw new RuntimeError(400, "target must be { kind, id, version? }");
    return c.json(runtime.registerUi(c.get("actor"), c.req.param("id"), { page: c.req.param("page"), commands, ...(target ? { target: target as unknown as UiTarget } : {}) }));
  });
  app.delete("/threads/:id/ui/:page", c => { runtime.unregisterUi(c.get("actor"), c.req.param("id"), c.req.param("page")); return c.json({ page: c.req.param("page"), removed: true }); });
  app.get("/threads/:id/ui", c => c.json(runtime.uiRegistrations(c.get("actor"), c.req.param("id"))));
  app.post("/runs/:id/ui/:requestId", async c => {
    const b = await body(c.req.raw);
    const result = obj(b.result);
    if (!str(b.page) || !result) throw new RuntimeError(400, "page and result are required");
    return c.json(runtime.answerUi(c.get("actor"), c.req.param("id"), c.req.param("requestId"), { page: str(b.page)!, result: result as unknown as UiResult }));
  });

  app.post("/threads", c => { const t = runtime.createThread(c.get("actor")); return c.json({ id: t.id, createdAt: t.createdAt }, 201); });
  app.get("/threads/:id", c => { const t = runtime.thread(c.get("actor"), c.req.param("id")); return c.json({ id: t.id, createdAt: t.createdAt }); });
  app.get("/threads/:id/events", c => {
    const { replay, subscribe } = runtime.events(c.get("actor"), { thread: c.req.param("id") }, c.req.query("cursor"));
    const live = c.req.query("live") !== "0";
    return stream(replay, subscribe, () => !live, c.req.raw.signal);
  });

  return { fetch: async request => app.fetch(request), app };
}
