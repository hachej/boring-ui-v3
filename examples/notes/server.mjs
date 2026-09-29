// The notes app's own server: it mounts the wire under /agent with its dev host and serves the
// built chat page. Run `node examples/notes/server.mjs` (fake model) or with OPENROUTER_API_KEY set.
//
// Environment: PORT (8787), HOST (localhost), STORE (data/agent.sqlite), BORING_MODEL
// (`fake`, `openrouter`, or a full `openrouter/<provider>/<model>` spec every agent then runs).
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime, loadApp, mountWire } from "@boring/agent";
import { devHost, tools } from "./host.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = await loadApp(dir);

/** The scripted model: the summariser consults `lookup` once, then saves; questions get a scripted answer. */
const script = request => {
  if (request.outputTool) {
    const consulted = request.messages.some(m => m.role === "tool");
    if (!consulted && request.tools.some(t => t.name === "lookup")) return { toolCalls: [{ name: "lookup", arguments: { term: "note" } }] };
    return { toolCalls: [{ name: request.outputTool, arguments: { title: "A scripted title", summary: "A scripted summary of the note.", tags: ["fake"] } }] };
  }
  return { text: `Scripted answer to: ${request.messages.at(-1)?.content.split("# Question").pop()?.trim()}` };
};
const spec = process.env.BORING_MODEL ?? (process.env.OPENROUTER_API_KEY ? "openrouter" : "fake");
let model, models;
if (spec === "fake") model = { kind: "fake", script };
else if (spec === "openrouter" || spec.startsWith("openrouter/")) {
  if (!process.env.OPENROUTER_API_KEY) throw new Error(`BORING_MODEL=${spec} needs OPENROUTER_API_KEY`);
  model = { kind: "openrouter", apiKey: process.env.OPENROUTER_API_KEY };
  if (spec.includes("/")) models = Object.fromEntries([...app.agents.keys()].map(name => [name, { model: spec }]));
} else throw new Error(`unknown BORING_MODEL ${spec}: fake | openrouter | openrouter/<provider>/<model>`);

const host = devHost({ log: usage => console.log("[usage]", usage.agent, usage.model, usage.input, usage.output) });
const runtime = await createRuntime({ host, app, tools, store: process.env.STORE ?? path.join(dir, "data", "agent.sqlite"), model, models });
const wire = mountWire({ host, runtime, basePath: "/agent" });
const web = path.join(dir, "web", "dist");
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/agent/")) {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
    if (!headers.has("x-dev-actor")) headers.set("x-dev-actor", "dev"); // the app's own dev auth
    const response = await wire.fetch(new Request(url, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) return res.end();
    for await (const chunk of response.body) res.write(chunk);
    return res.end();
  }
  const file = path.join(web, url.pathname === "/" ? "index.html" : url.pathname);
  if (existsSync(file) && file.startsWith(web)) { res.writeHead(200, { "content-type": types[path.extname(file)] ?? "application/octet-stream" }); return res.end(readFileSync(file)); }
  res.writeHead(404); res.end("build the page first: npx vite build examples/notes/web");
});
const hostname = process.env.HOST ?? "localhost";
server.listen(Number(process.env.PORT ?? 8787), hostname, () => console.log(`notes: http://${hostname}:${server.address().port}/ pid ${process.pid} model ${spec}  manifest: /agent/.well-known/boring.json`));
const stop = async () => { await runtime.stop(); server.close(); process.exit(0); };
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
