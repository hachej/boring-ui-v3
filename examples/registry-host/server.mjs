// The registry host's server: the agent's wire under /agent, the file routes under /files, the app's config, and
// the built page. `node examples/registry-host/server.mjs` (fake model by default), or `boring env up --example
// registry-host`. Environment: PORT (8790), HOST, STORE, BORING_MODEL (fake | openrouter[/<provider>/<model>]),
// TLDRAW_LICENSE_KEY (handed to the page at runtime from /config.json, never bundled).
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime, loadApp, mountWire } from "@boring/agent";
import { createHost } from "./host.mjs";
import { scriptedModel } from "./script.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));

export async function startServer({ port = 0, hostname = "localhost", store = ":memory:", spec = "fake", log } = {}) {
  const app = await loadApp(dir);
  let model, models;
  if (spec === "fake") model = scriptedModel;
  else if (spec === "openrouter" || spec.startsWith("openrouter/")) {
    if (!process.env.OPENROUTER_API_KEY) throw new Error(`BORING_MODEL=${spec} needs OPENROUTER_API_KEY`);
    model = { kind: "openrouter", apiKey: process.env.OPENROUTER_API_KEY };
    if (spec.includes("/")) models = Object.fromEntries([...app.agents.keys()].map(name => [name, { model: spec }]));
  } else throw new Error(`unknown BORING_MODEL ${spec}: fake | openrouter | openrouter/<provider>/<model>`);
  const { host, files, receipts, workspaceOf } = createHost({ app, log });
  if (store !== ":memory:") mkdirSync(path.dirname(store), { recursive: true });
  const runtime = await createRuntime({ host, app, store, model, models, uiTimeout: 15_000 });
  const wire = mountWire({ host, runtime, basePath: "/agent" });
  const dist = path.join(dir, "dist");
  const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".json": "application/json" };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const route = url.pathname.startsWith("/agent/") ? wire : url.pathname.startsWith("/files/") ? files : null;
    if (route) {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      if (!headers.has("x-dev-actor")) headers.set("x-dev-actor", "dev"); // the app's own dev auth
      const response = await route.fetch(new Request(url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) return res.end();
      for await (const chunk of response.body) res.write(chunk);
      return res.end();
    }
    if (url.pathname === "/config.json") { res.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }); return res.end(JSON.stringify({ tldrawLicenseKey: process.env.TLDRAW_LICENSE_KEY ?? null })); }
    const file = path.join(dist, url.pathname === "/" ? "index.html" : url.pathname);
    if (file.startsWith(dist) && existsSync(file)) { res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }); return res.end(readFileSync(file)); }
    res.writeHead(404); res.end("build the page first: npx vite build examples/registry-host");
  });
  await new Promise(resolve => server.listen(port, hostname, resolve));
  const url = `http://${hostname}:${server.address().port}`;
  return { url, runtime, wire, files, receipts, workspaceOf, spec, async stop() { await runtime.stop(); server.closeAllConnections(); await new Promise(r => server.close(r)); } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const spec = process.env.BORING_MODEL ?? (process.env.OPENROUTER_API_KEY ? "openrouter" : "fake");
  const started = await startServer({ port: Number(process.env.PORT ?? 8790), hostname: process.env.HOST ?? "localhost", store: process.env.STORE ?? path.join(dir, "data", "agent.sqlite"), spec, log: u => console.log("[usage]", u.agent, u.model, u.input, u.output) });
  console.log(`registry-host: ${started.url}/ pid ${process.pid} model ${spec}  manifest: /agent/.well-known/boring.json`);
  const stop = async () => { await started.stop(); process.exit(0); };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}
