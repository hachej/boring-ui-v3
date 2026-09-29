import test from "node:test";
import assert from "node:assert/strict";
import { bootEmbed } from "./embed.ts";
import { makeHost, type Script } from "./helpers.ts";
import type { Grant } from "@boring/agent";

/** The fake provider hands tool results back as JSON text of the tool's JSON string: parse until an object appears. */
const toolResult = (request: Parameters<Script>[0], name: string) => request.messages.filter(m => m.role === "tool").map(m => { let v: unknown = m.content; try { while (typeof v === "string") v = JSON.parse(v); } catch { return null; } return v as any; }).find(r => r && (r.path ?? "").includes(name));

/** Reads /code, writes a note in /workspace at the observed revision, then answers. */
const writer: Script = request => {
  const results = request.messages.filter(m => m.role === "tool");
  if (results.length === 0) return { toolCalls: [{ name: "read_file", arguments: { path: "/code/README.md" } }] };
  if (results.length === 1) return { toolCalls: [{ name: "read_file", arguments: { path: "/workspace/notes/today.md" } }] };
  if (results.length === 2) { const seen = toolResult(request, "today.md"); return { toolCalls: [{ name: "write_file", arguments: { path: "/workspace/notes/today.md", content: "read the README", mode: "update", revision: seen.revision } }] }; }
  return { text: "Noted." };
};

test("FILES / AGENT-8: `files:` needs become grants the host admits per run, and the tools address /mount/path", async t => {
  const admitted: { tools: readonly string[]; grants: readonly Grant[] }[] = [];
  const { call, settled, runtime, receipts } = await bootEmbed({ script: writer, host: { async mayRequest(_actor, request) { admitted.push(request); return true; } } });
  t.after(() => runtime.stop());
  const run = await settled((await call("POST", "/conversations/chat/messages", { text: "Read the readme and note it" })).body.run.id);
  assert.equal(run.status, "completed", run.error);
  assert.deepEqual(admitted[0].grants, [{ mount: "code", path: "", mode: "read" }, { mount: "workspace", path: "", mode: "read" }, { mount: "workspace", path: "", mode: "write" }]);
  assert.ok(admitted[0].tools.includes("read_file") && admitted[0].tools.includes("write_file"));
  assert.equal(receipts.entries.length, 1);
  assert.equal(receipts.entries[0].effect.run, run.id);
  const rows = runtime.store.receiptsOf(run.id);
  assert.equal(rows.length, 3);
  const write = rows.find(r => r.tool === "write_file")!;
  assert.deepEqual(write.revisions, [{ mount: "workspace", path: "notes/today.md", before: receipts.entries[0].before, after: receipts.entries[0].after }], "the receipt names mount, path and both revisions");
  assert.ok(write.revisions && (write.revisions as any)[0].before !== (write.revisions as any)[0].after);
});

test("BORING-1 / FILES-5: a tool argument cannot reach a mount the grants do not cover, nor leave one", async t => {
  const attempts: Script = request => {
    const n = request.messages.filter(m => m.role === "tool").length;
    if (n === 0) return { toolCalls: [{ name: "write_file", arguments: { path: "/code/README.md", content: "x", mode: "create" } }] };
    if (n === 1) return { toolCalls: [{ name: "read_file", arguments: { path: "/shared/secret.md" } }] };
    if (n === 2) return { toolCalls: [{ name: "read_file", arguments: { path: "/workspace/../code/README.md" } }] };
    if (n === 3) return { toolCalls: [{ name: "list_files", arguments: { path: "/" } }] };
    return { text: "gave up" };
  };
  // The host also offers /shared; the definition never asked for it, so no grant covers it.
  const first = await bootEmbed({ script: attempts });
  await first.runtime.stop();
  const { call, settled, runtime, receipts } = await bootEmbed({ script: attempts, mounts: () => ({ code: first.code, workspace: first.workspace, shared: first.workspace }) });
  t.after(() => runtime.stop());
  const run = await settled((await call("POST", "/conversations/chat/messages", { text: "try" })).body.run.id);
  assert.equal(run.status, "completed", run.error);
  assert.equal(runtime.store.receiptsOf(run.id).length, 4);
  const parts = runtime.store.eventsOf({ run: run.id }).flatMap(e => e.kind === "message" ? e.message.parts : []).filter(p => p.type === "tool") as any[];
  assert.match(JSON.stringify(parts[0].output), /no write grant on \/code\/README.md/);
  assert.match(JSON.stringify(parts[1].output), /names no mount available here \(code, workspace\)/);
  assert.match(JSON.stringify(parts[2].output), /traverses/);
  assert.deepEqual(parts[3].output.entries.map((e: any) => e.path), ["/code", "/workspace"], "the model sees only the granted mounts");
  assert.equal(receipts.entries.length, 0, "nothing was written");
});

test("AGENT-3 / AGENT-9: the file tools are offered only when the definition declares files and the host allows them", async t => {
  let offered: readonly string[] = [];
  const { call, settled, runtime } = await bootEmbed({ script: () => ({ text: "ok" }), allowed: ["open_record"], host: { async mayRequest(_a, r) { offered = r.tools; return true; } } });
  t.after(() => runtime.stop());
  await settled((await call("POST", "/conversations/chat/messages", { text: "hi" })).body.run.id);
  assert.deepEqual(offered, [], "a host that allows no file tool offers none, whatever the definition declares");
});

test("FILES-8 via the runtime: /code is read-only at the provider, so a write grant could not make it writable", async t => {
  const { call, settled, runtime, receipts, code, workspace } = await bootEmbed({
    script: request => request.messages.some(m => m.role === "tool") ? { text: "done" } : { toolCalls: [{ name: "write_file", arguments: { path: "/code/new.md", content: "x", mode: "create" } }] },
    mounts: () => ({ code, workspace }),
  });
  t.after(() => runtime.stop());
  // Even if a definition asked for write on code (it asks read), the readonly wrapper refuses; here the grant already refuses first.
  const run = await settled((await call("POST", "/conversations/chat/messages", { text: "write into code" })).body.run.id);
  assert.equal(run.status, "completed");
  assert.equal(receipts.entries.length, 0);
  await assert.rejects(code.write({ mount: "code", path: "new.md" }, "x", { create: true }, { actor: "ana" }), /readonly/);
  assert.equal(runtime.store.receiptsOf(run.id)[0].ok, true, "a refused file operation is the tool's answer, not a crash");
});
