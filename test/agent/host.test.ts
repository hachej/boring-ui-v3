import test from "node:test";
import assert from "node:assert/strict";
import { boot, makeHost } from "./helpers.ts";

test("AGENT-8: every authority answer is asked of the host at the operation, never cached", async t => {
  const asked: string[] = [];
  let allow = true;
  const host = makeHost({
    async mayRequest() { asked.push("mayRequest"); return allow; },
    async allowedTools() { asked.push("allowedTools"); return ["lookup"]; },
    async isActive() { asked.push("isActive"); return true; },
  });
  const { call, settled, runtime } = await boot({ host });
  t.after(() => runtime.stop());
  await settled((await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body.id);
  assert.deepEqual(asked, ["allowedTools", "mayRequest", "isActive"]);
  allow = false;
  assert.equal((await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).status, 403, "the host's new answer is obeyed at the next operation");
  assert.deepEqual(asked.slice(3), ["allowedTools", "mayRequest"]);
});

test("AGENT-8: an actor sees only their own threads, runs and jobs", async t => {
  const { call, settled, runtime } = await boot();
  t.after(() => runtime.stop());
  const run = await settled((await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body.id);
  const job = (await call("POST", "/jobs/digest/start", { inputs: { notes: ["a"] } })).body;
  await runtime.idle();
  for (const route of [`/runs/${run.id}`, `/runs/${run.id}/events`, `/threads/${run.thread}`, `/jobs/${job.id}`]) {
    assert.equal((await call("GET", route, undefined, { "x-test-actor": "bob" })).status, 404, `${route} is invisible to another actor`);
    assert.equal((await call("GET", route)).status, 200);
  }
  assert.equal((await call("POST", `/agents/summarise/runs`, { inputs: { note: "n" }, thread: run.thread }, { "x-test-actor": "bob" })).status, 404, "another actor cannot write to the thread");
});
