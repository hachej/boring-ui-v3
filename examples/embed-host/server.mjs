// A tiny existing application (Hono) that mounts the runtime in its own process under /agent and keeps
// its records API beside it. `node examples/embed-host/server.mjs` runs it on :8788 with a scripted
// model; the page under web/ registers two commands the agent can request.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { createRuntime, loadApp, mountWire } from "@boring/agent";
import { createHost, createRecords } from "./host.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));

/** The scripted model: opens the record the person names, notes it under /workspace, then answers. */
export const scriptedModel = {
  kind: "fake",
  script: request => {
    const asked = (request.messages.filter(m => m.role === "user").at(-1)?.content ?? "").split("# Request").pop() ?? "";
    const id = /r\d+/.exec(asked)?.[0] ?? "r1";
    const results = request.messages.filter(m => m.role === "tool");
    if (results.length === 0) return { toolCalls: [{ name: "open_record", arguments: { id } }] };
    if (results.length === 1) return { toolCalls: [{ name: "write_file", arguments: { path: `/workspace/notes/${id}.md`, content: `opened ${id}`, mode: "create" } }] };
    return { text: `Opened ${id} on your page and noted it under /workspace/notes/${id}.md.` };
  },
};

export async function startServer({ port = 0, model = scriptedModel, store = ":memory:", log } = {}) {
  const app = await loadApp(dir);
  const records = createRecords();
  const { host, tools, receipts, workspaceOf } = createHost({ records, log });
  const runtime = await createRuntime({ host, app, tools, store, model, uiTimeout: 10_000 });
  const wire = mountWire({ host, runtime, basePath: "/agent" });

  const web = new Hono();
  web.get("/api/records", c => c.json(records.list()));
  web.get("/api/records/:id", c => { const row = records.get(c.req.param("id")); return row ? c.json(row) : c.json({ error: "not found" }, 404); });
  web.post("/api/records/:id/status", async c => {
    const body = await c.req.json();
    const actor = await host.resolveActor(c.req.raw);
    if (!actor) return c.json({ error: "not authenticated" }, 401);
    return c.json(records.setStatus(c.req.param("id"), body.status, body.version, actor.id));
  });
  web.all("/agent/*", c => wire.fetch(c.req.raw));
  const dist = path.join(dir, "web", "dist");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };
  web.get("/*", c => {
    const file = path.join(dist, c.req.path === "/" ? "index.html" : c.req.path);
    if (!file.startsWith(dist) || !existsSync(file)) return c.text("build the page first: npx vite build examples/embed-host/web", 404);
    return new Response(readFileSync(file), { headers: { "content-type": types[path.extname(file)] ?? "application/octet-stream" } });
  });

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    if (!headers.has("x-dev-actor")) headers.set("x-dev-actor", "dev"); // the app's own dev auth
    const response = await web.fetch(new Request(url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) return res.end();
    for await (const chunk of response.body) res.write(chunk);
    res.end();
  });
  await new Promise(resolve => server.listen(port, resolve));
  const url = `http://localhost:${server.address().port}`;
  return { url, records, runtime, wire, receipts, workspaceOf, async stop() { await runtime.stop(); server.closeAllConnections(); await new Promise(r => server.close(r)); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const started = await startServer({ port: Number(process.env.PORT ?? 8788), store: process.env.STORE ?? path.join(dir, "data", "agent.sqlite"), log: u => console.log("[usage]", u.agent, u.model, u.input, u.output) });
  console.log(`embed-host: ${started.url}/  manifest: ${started.url}/agent/.well-known/boring.json`);
  process.on("SIGINT", async () => { await started.stop(); process.exit(0); });
}
