import test from "node:test";
import assert from "node:assert/strict";
import { boot, makeHost } from "./helpers.ts";

test("AGENT-11: two concurrent requests with one key create one run, one job, one message; the key is reserved before any await", async t => {
  // A slow host makes the window between the key check and the record wide open.
  const host = makeHost({ async mayRequest() { await new Promise(r => setTimeout(r, 30)); return true; } });
  const { call, runtime } = await boot({ host });
  t.after(() => runtime.stop());
  const runs = await Promise.all([1, 2, 3].map(() => call("POST", "/agents/summarise/runs", { inputs: { note: "n" }, idempotencyKey: "k-run" })));
  assert.deepEqual(runs.map(r => r.status), [202, 202, 202]);
  assert.equal(new Set(runs.map(r => r.body.id)).size, 1, "one run for one key");
  const jobs = await Promise.all([1, 2].map(() => call("POST", "/jobs/digest/start", { inputs: { notes: ["a", "b"] }, idempotencyKey: "k-job" })));
  assert.equal(new Set(jobs.map(r => r.body.id)).size, 1, "one job for one key");
  const said = await Promise.all([1, 2].map(() => call("POST", "/conversations/questions/messages", { text: "hi", idempotencyKey: "k-say" })));
  assert.equal(new Set(said.map(r => r.body.run.id)).size, 1, "one message for one key");
  assert.equal(new Set(said.map(r => r.body.thread)).size, 1);
  await runtime.idle();
  assert.equal(runtime.store.eventsOf({ thread: said[0].body.thread }).filter(e => e.kind === "message" && e.message.role === "person").length, 1);
});

test("AGENT-11: a request that fails after reserving its key frees the key; a different body under a reserved key is a conflict", async t => {
  let refuse = true;
  const host = makeHost({ async mayRequest() { await new Promise(r => setTimeout(r, 20)); return !refuse; } });
  const { call, runtime } = await boot({ host });
  t.after(() => runtime.stop());
  const [first, other] = await Promise.all([
    call("POST", "/agents/summarise/runs", { inputs: { note: "n" }, idempotencyKey: "k" }),
    call("POST", "/agents/summarise/runs", { inputs: { note: "different" }, idempotencyKey: "k" }),
  ]);
  assert.equal(first.status, 403);
  assert.equal(other.status, 409, "another body under the reserved key is refused");
  refuse = false;
  const retry = await call("POST", "/agents/summarise/runs", { inputs: { note: "n" }, idempotencyKey: "k" });
  assert.equal(retry.status, 202, "the failed request left the key free");
  const again = await call("POST", "/agents/summarise/runs", { inputs: { note: "n" }, idempotencyKey: "k" });
  assert.equal(again.body.id, retry.body.id);
});
