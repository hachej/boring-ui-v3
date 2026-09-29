// The HTTP file routes and their client pass the same conformance suite as every provider (BORING-3), and the
// session, never the request, names the actor a receipt records (BORING-1).
import test from "node:test";
import assert from "node:assert/strict";
import { fileRoutes, httpFiles, isFileError, memoryProvider, memoryReceipts, readonly } from "@boring/files/web";
import { conformance } from "./suite.ts";

const session = { actor: "ana", thread: "t1", run: "r1", tool: "files-http" };
const over = (routes: { fetch(request: Request): Promise<Response> }) => httpFiles({ endpoint: "/files", fetch: (url, init) => routes.fetch(new Request(`http://app.test${url}`, init)) });

conformance("http", ({ seed, receipts }) => {
  const workspace = memoryProvider({ seed, receipts });
  return over(fileRoutes({ resolve: async () => ({ mounts: { workspace }, effect: session }) }));
}, { history: true, sessionEffect: session });

test("[http] BORING-1: the receipt names the session's actor; a body naming another actor or mount grants nothing", async () => {
  const receipts = memoryReceipts();
  const workspace = memoryProvider({ seed: { "a.md": "x" }, receipts });
  const routes = fileRoutes({ resolve: async request => request.headers.get("x-actor") === "ana" ? { mounts: { workspace, code: readonly(memoryProvider({ seed: { "src.ts": "1" } })) }, effect: { actor: "ana" } } : null });
  const call = (route: string, init: RequestInit = {}, actor = "ana") => routes.fetch(new Request(`http://app.test/files/${route}`, { ...init, headers: { "content-type": "application/json", ...(actor ? { "x-actor": actor } : {}) } }));
  const rev = (await (await call("stat?path=/workspace/a.md")).json()).revision;
  const res = await call("write", { method: "PUT", body: JSON.stringify({ path: "/workspace/a.md", content: "y", condition: { expectedRevision: rev }, effect: { actor: "mallory" }, actor: "mallory" }) });
  assert.equal(res.status, 200);
  assert.equal(receipts.entries.at(-1)!.effect.actor, "ana");
  assert.equal((await call("stat?path=/workspace/a.md", {}, "")).status, 401, "no session, no answer");
  assert.equal((await call("read?path=/other/a.md")).status, 400, "a mount outside the table is a bad address");
  assert.equal((await call("read?path=/workspace/../code/src.ts")).status, 400, "traversal is refused");
  const ro = await call("write", { method: "PUT", body: JSON.stringify({ path: "/code/src.ts", content: "2", condition: { create: true } }) });
  assert.equal(ro.status, 403); assert.equal((await ro.json()).error.code, "readonly");
  const both = await call("write", { method: "PUT", body: JSON.stringify({ path: "/workspace/b.md", content: "2", condition: { create: true, expectedRevision: rev } }) });
  assert.equal(both.status, 400, "a condition is create or update, never both");
  const none = await call("write", { method: "PUT", body: JSON.stringify({ path: "/workspace/a.md", content: "2" }) });
  assert.equal(none.status, 400, "an omitted condition is refused, not an overwrite (FILES-2)");
});

test("[http] FILES-8: the client reports unverified, never success, when the routes do not answer or answer garbage", async () => {
  const down = httpFiles({ endpoint: "/files", fetch: async () => { throw new Error("connection refused"); } });
  await assert.rejects(down.write({ mount: "workspace", path: "a.md" }, "x", { create: true }, { actor: "ana" }), e => isFileError(e, "unverified"));
  const garbage = httpFiles({ endpoint: "/files", fetch: async () => new Response("<html>proxy error</html>", { status: 200 }) });
  await assert.rejects(garbage.stat({ mount: "workspace", path: "a.md" }), e => isFileError(e, "unverified"));
  const conflict = httpFiles({ endpoint: "/files", fetch: async () => new Response(JSON.stringify({ error: { code: "conflict", current: "7" }, message: "conflict: a.md is at 7" }), { status: 409 }) });
  await assert.rejects(conflict.write({ mount: "workspace", path: "a.md" }, "x", { expectedRevision: "3" }, { actor: "ana" }), e => isFileError(e, "conflict") && (e.error as { current: string }).current === "7");
});
