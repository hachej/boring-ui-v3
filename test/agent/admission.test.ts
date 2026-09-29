import test from "node:test";
import assert from "node:assert/strict";
import { boot, makeHost, type Script } from "./helpers.ts";
import type { Operations, ToolDefinition } from "@boring/agent";

const forging: Script = request => request.messages.some(m => m.role === "tool")
  ? { toolCalls: [{ name: request.outputTool!, arguments: { title: "T", summary: "S", tags: [] } }] }
  : { toolCalls: [{ name: "lookup", arguments: { term: "x", actor: "someone-else", thread: "t-forged", run: "r-forged" } }] };

test("AGENT-2 / BORING-1: a tool's arguments cannot name the actor, thread or run; the effect is issued by the loop", async t => {
  const effects: Operations["effect"][] = [];
  const lookup: ToolDefinition = { name: "lookup", description: "d", mutates: true, input: { type: "object", properties: { term: { type: "string" }, actor: { type: "string" }, thread: { type: "string" }, run: { type: "string" } } },
    handler: async (_input, operations) => { effects.push(operations.effect); return "ok"; } };
  const { call, settled, runtime } = await boot({ script: forging, tools: [lookup] });
  t.after(() => runtime.stop());
  const run = await settled((await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body.id);
  assert.equal(run.status, "completed");
  assert.deepEqual(effects, [{ actor: "ana", thread: run.thread, run: run.id, tool: "lookup" }]);
  const receipts = runtime.store.receiptsOf(run.id);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].actor, "ana");
});

test("AGENT-2: a mutating tool runs only while the host says the run is active; a refusal leaves a refused receipt", async t => {
  let handled = 0;
  const lookup: ToolDefinition = { name: "lookup", description: "d", mutates: true, input: { type: "object", properties: { term: { type: "string" } } }, handler: async () => { handled++; return "ok"; } };
  const host = makeHost({ async isActive() { return false; } });
  const { call, settled, runtime } = await boot({ script: forging, tools: [lookup], host });
  t.after(() => runtime.stop());
  const run = await settled((await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body.id);
  assert.equal(handled, 0, "the handler never ran");
  const receipts = runtime.store.receiptsOf(run.id);
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].ok, false);
  assert.equal(run.status, "failed", "the host revoked the run before its output could land");
});

test("AGENT-8: a host that refuses the request is obeyed and nothing is recorded", async t => {
  const host = makeHost({ async mayRequest() { return false; } });
  const { call, runtime } = await boot({ host });
  t.after(() => runtime.stop());
  const response = await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } });
  assert.equal(response.status, 403);
  assert.equal(runtime.store.eventsOf({ thread: "" }).length, 0);
});
