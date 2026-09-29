// The notes app's own server: it mounts the wire under /agent with its dev host and serves the
// built chat page. Run `node examples/notes/server.mjs` (fake model) or with OPENROUTER_API_KEY set.
import { createServer } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime, loadApp, mountWire } from "@boring/agent";
import { devHost, tools } from "./host.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const app = await loadApp(dir);
const model = process.env.OPENROUTER_API_KEY
  ? { kind: "openrouter", apiKey: process.env.OPENROUTER_API_KEY }
  : { kind: "fake", script: request => request.outputTool
      ? { toolCalls: [{ name: request.outputTool, arguments: { title: "A scripted title", summary: "A scripted summary of the note.", tags: ["fake"] } }] }
      : { text: `Scripted answer to: ${request.messages.at(-1)?.content.split("# Question").pop()?.trim()}` } };
const host = devHost({ log: usage => console.log("[usage]", usage.agent, usage.model, usage.input, usage.output) });
const runtime = await createRuntime({ host, app, tools, store: process.env.STORE ?? path.join(dir, "data", "agent.sqlite"), model });
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
server.listen(Number(process.env.PORT ?? 8787), () => console.log(`notes: http://localhost:${server.address().port}/  manifest: /agent/.well-known/boring.json`));
process.on("SIGINT", async () => { await runtime.stop(); server.close(); process.exit(0); });
