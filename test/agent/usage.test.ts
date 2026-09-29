import test from "node:test";
import assert from "node:assert/strict";
import { boot, makeHost, type Script } from "./helpers.ts";

test("AGENT-10: each model response writes one usage row and the host receives it before the next step", async t => {
  let calls = 0;
  const script: Script = request => { calls++; return calls === 1 ? { text: "not the tool" } : { toolCalls: [{ name: request.outputTool!, arguments: { title: "T", summary: "S", tags: [] } }] }; };
  const order: string[] = [];
  const host = makeHost({ async onUsage(row) { order.push(`usage:${calls}`); host.usage.push(row); } });
  const { call, settled, runtime } = await boot({ script, host });
  t.after(() => runtime.stop());
  const run = await settled((await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body.id);
  assert.equal(run.status, "completed");
  assert.equal(calls, 2);
  assert.deepEqual(order, ["usage:1", "usage:2"], "the host saw the first response's usage before the second model call");
  const rows = runtime.store.usageOf(run.id);
  assert.equal(rows.length, 2);
  for (const row of rows) { assert.equal(row.actor, "ana"); assert.equal(row.thread, run.thread); assert.equal(row.run, run.id); assert.equal(row.agent, "summarise"); assert.equal(row.model, "fake/summarise"); }
  assert.deepEqual(host.usage.map(u => u.run), [run.id, run.id]);
});

test("AGENT-10: a host that refuses the usage stops the run before the next model call", async t => {
  let calls = 0;
  const script: Script = () => { calls++; return { text: "never the tool" }; };
  const host = makeHost({ async onUsage() { throw new Error("budget exhausted"); } });
  const { call, settled, runtime } = await boot({ script, host });
  t.after(() => runtime.stop());
  const run = await settled((await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body.id);
  assert.equal(run.status, "failed");
  assert.match(run.error, /budget exhausted/);
  assert.equal(calls, 1, "no second model call after the refusal");
  assert.equal(runtime.store.usageOf(run.id).length, 1, "the refused call is still metered");
});
