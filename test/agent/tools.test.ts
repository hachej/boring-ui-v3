import test from "node:test";
import assert from "node:assert/strict";
import { boot, makeHost, type Script } from "./helpers.ts";
import type { ToolDefinition } from "@boring/agent";

const recordTools = (seen: string[][]): Script => request => { seen.push(request.tools.map(t => t.name).filter(n => n !== request.outputTool)); return { toolCalls: [{ name: request.outputTool!, arguments: { title: "T", summary: "S", tags: [] } }] }; };
const extra: ToolDefinition = { name: "note_write", description: "registered but declared by no agent", input: { type: "object", properties: {} }, handler: async () => "x" };

test("AGENT-3 / AGENT-9: the model sees declared tools intersected with what the host allows; a registered-only tool never appears", async t => {
  const seen: string[][] = [];
  let allowed = ["lookup", "note_write"];
  const host = makeHost({ async allowedTools() { return allowed; } });
  const { call, settled, runtime } = await boot({ script: recordTools(seen), host, tools: [{ name: "lookup", description: "d", input: { type: "object", properties: {} }, handler: async () => "x" }, extra] });
  t.after(() => runtime.stop());
  await settled((await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body.id);
  allowed = [];
  await settled((await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body.id);
  allowed = ["note_write"];
  await settled((await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body.id);
  assert.deepEqual(seen, [["lookup"], [], []]);
});

test("AGENT-3: a declared helper tool without a registered handler is refused at load time", async t => {
  await assert.rejects(boot({ tools: [] }), /agent "summarise" declares helper tool "lookup" but no handler is registered/);
  t.diagnostic("load refused");
});

test("AGENT-9: the runtime compares no role strings", async () => {
  const { readdirSync, readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const root = path.resolve(new URL("../../packages/agent/src", import.meta.url).pathname);
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  for (const file of walk(root)) {
    if (file.endsWith("index.ts")) continue; // the Actor type declares roles as opaque strings
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\.roles\b/, `${file} reads actor roles`);
  }
});
