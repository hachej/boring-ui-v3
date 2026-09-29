import test from "node:test";
import assert from "node:assert/strict";
import { boot, type Script } from "./helpers.ts";
import type { ToolDefinition } from "@boring/agent";

/** A script that calls `lookup`, then a gate the test opens, then the output tool. */
function gated() {
  let open!: () => void;
  const gate = new Promise<void>(resolve => { open = resolve; });
  let step = 0;
  const script: Script = async request => {
    step++;
    if (step === 1) return { toolCalls: [{ name: "lookup", arguments: { term: "milk" } }] };
    await gate;
    return { toolCalls: [{ name: request.outputTool!, arguments: { title: "T", summary: "S", tags: [] } }] };
  };
  return { script, open: () => open(), steps: () => step };
}

test("AGENT-6: cancelling mid-run stops before the next effect; committed receipts remain; no output lands", async t => {
  const { script, open } = gated();
  const calls: string[] = [];
  const lookup: ToolDefinition = { name: "lookup", description: "d", input: { type: "object", properties: { term: { type: "string" } } }, handler: async input => { calls.push(String((input as { term: string }).term)); return "milk: a drink"; } };
  const { call, settled, runtime } = await boot({ script, tools: [lookup] });
  t.after(() => runtime.stop());
  const started = (await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body;
  // Wait until the first tool call happened (a receipt exists), then cancel while the model is "thinking".
  while (runtime.store.receiptsOf(started.id).length === 0) await new Promise(r => setTimeout(r, 10));
  const cancelled = await call("POST", `/runs/${started.id}/cancel`);
  assert.equal(cancelled.status, 200);
  open();
  const run = await settled(started.id);
  assert.equal(run.status, "cancelled");
  assert.equal(run.output, undefined, "the late output was not committed");
  assert.deepEqual(calls, ["milk"], "the effect committed before the cancel stays");
  assert.equal(runtime.store.receiptsOf(started.id).length, 1);
  assert.equal((await call("POST", `/runs/${started.id}/cancel`)).status, 409, "a run ends once");
});

test("AGENT-6: a pending run is cancelled without ever calling the model", async t => {
  const { script, open, steps } = gated();
  const { call, settled, runtime } = await boot({ script, maxConcurrent: 1 });
  t.after(() => runtime.stop());
  const first = (await call("POST", "/agents/summarise/runs", { inputs: { note: "one" } })).body;
  while (steps() === 0) await new Promise(r => setTimeout(r, 10));
  const pending = (await call("POST", "/agents/summarise/runs", { inputs: { note: "two" } })).body;
  assert.equal(pending.status, "pending", "the only slot is taken");
  assert.equal((await call("POST", `/runs/${pending.id}/cancel`)).body.status, "cancelled");
  open();
  assert.equal((await settled(first.id)).status, "completed");
  assert.equal((await settled(pending.id)).status, "cancelled");
  assert.equal(steps(), 2, "only the first run reached the model");
});
