import test from "node:test";
import assert from "node:assert/strict";
import { boot, type Script } from "./helpers.ts";

test("an invalid output goes back to the model and the repaired one is accepted (attempts = 2)", async t => {
  const seen: number[] = [];
  const script: Script = request => {
    seen.push(request.messages.length);
    const bad = { title: "x".repeat(81), summary: "s", tags: ["a"] };
    const good = { title: "Fine", summary: "s", tags: ["a"] };
    return { toolCalls: [{ name: request.outputTool!, arguments: seen.length === 1 ? bad : good }] };
  };
  const { call, settled, runtime } = await boot({ script });
  t.after(() => runtime.stop());
  const run = await settled((await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body.id);
  assert.equal(run.status, "completed");
  assert.equal(run.attempts, 2);
  assert.equal(run.output.title, "Fine");
  assert.deepEqual(seen, [2, 4], "Flue's tool declaration + user, then + tool call + refusal");
});

test("the loop gives up after the repairs with a readable error", async t => {
  const { call, settled, runtime } = await boot({ script: () => ({ text: "I would rather not." }) });
  t.after(() => runtime.stop());
  const run = await settled((await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body.id);
  assert.equal(run.status, "failed");
  assert.match(run.error, /did not produce a valid output: Call the tool summary_save/);
});

test("a markdown agent's empty answer is repaired on the same instance", async t => {
  let calls = 0;
  const { call, settled, runtime } = await boot({ script: () => ({ text: ++calls === 1 ? "   " : "Milk." }) });
  t.after(() => runtime.stop());
  const run = await settled((await call("POST", "/agents/answer/runs", { message: "What?", inputs: { notes: ["Milk"] } })).body.id);
  assert.equal(run.status, "completed");
  assert.equal(run.output, "Milk.");
  assert.equal(run.attempts, 2);
});

test("buildMessage refusing the inputs is a 400 before any run is recorded", async t => {
  const { call, runtime } = await boot();
  t.after(() => runtime.stop());
  const response = await call("POST", "/agents/summarise/runs", { inputs: {} });
  assert.equal(response.status, 400);
  assert.match(response.body.error, /summarise: note is required/);
});
