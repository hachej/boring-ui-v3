import test from "node:test";
import assert from "node:assert/strict";
import { boot, type Script } from "./helpers.ts";
import type { ToolDefinition } from "@boring/agent";

test("AGENT-4: every tool effect leaves a receipt with actor, thread, run and tool; a transcript alone changes nothing", async t => {
  let step = 0;
  const script: Script = request => { step++; return step === 1 ? { toolCalls: [{ name: "lookup", arguments: { term: "a" } }] } : { toolCalls: [{ name: request.outputTool!, arguments: { title: "I called lookup twice", summary: "S", tags: [] } }] }; };
  const calls: unknown[] = [];
  const lookup: ToolDefinition = { name: "lookup", description: "d", input: { type: "object", properties: { term: { type: "string" } } }, handler: async input => { calls.push(input); return "ok"; } };
  const { call, settled, runtime } = await boot({ script, tools: [lookup] });
  t.after(() => runtime.stop());
  const run = await settled((await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body.id);
  const receipts = runtime.store.receiptsOf(run.id);
  assert.equal(receipts.length, 1, "the text claims two calls; one effect happened");
  assert.deepEqual({ actor: receipts[0].actor, thread: receipts[0].thread, run: receipts[0].run, tool: receipts[0].tool, ok: receipts[0].ok }, { actor: "ana", thread: run.thread, run: run.id, tool: "lookup", ok: true });
  assert.deepEqual(calls, [{ term: "a" }]);
});

test("AGENT-4: a tool that throws leaves a refused receipt", async t => {
  let step = 0;
  const script: Script = request => { step++; return step === 1 ? { toolCalls: [{ name: "lookup", arguments: { term: "a" } }] } : { toolCalls: [{ name: request.outputTool!, arguments: { title: "T", summary: "S", tags: [] } }] }; };
  const lookup: ToolDefinition = { name: "lookup", description: "d", input: { type: "object", properties: { term: { type: "string" } } }, handler: async () => { throw new Error("boom"); } };
  const { call, settled, runtime } = await boot({ script, tools: [lookup] });
  t.after(() => runtime.stop());
  const run = await settled((await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body.id);
  assert.equal(runtime.store.receiptsOf(run.id)[0].ok, false);
});
