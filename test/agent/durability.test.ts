import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { openStore } from "@boring/agent";
import { boot, tempDir } from "./helpers.ts";

test("AGENT-1: a run is recorded before it starts, ends exactly once, and an interrupted run fails from its records on restart", async t => {
  const store = path.join(tempDir(), "agent.sqlite");
  let calls = 0;
  const first = await boot({ store, script: request => { calls++; return { toolCalls: [{ name: request.outputTool!, arguments: { title: "T", summary: "S", tags: [] } }] }; } });
  const completed = await first.settled((await first.call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body.id);
  assert.equal(completed.status, "completed");
  assert.equal(first.runtime.store.finishRun(completed.id, { status: "failed", error: "again" }), false, "a second terminal transition is refused");
  // Simulate a process that died mid-run: a running row with no process behind it.
  const thread = first.runtime.store.createThread("ana");
  const orphan = first.runtime.store.createRun({ thread: thread.id, agent: "summarise", actor: "ana", input: {}, model: "fake/summarise" });
  first.runtime.store.startRun(orphan.id);
  first.runtime.store.close();

  const reopened = openStore(store);
  assert.equal(reopened.run(orphan.id)!.status, "running");
  reopened.close();
  const second = await boot({ store, script: () => { calls++; return { text: "" }; } });
  t.after(() => second.runtime.stop());
  const failed = second.runtime.store.run(orphan.id)!;
  assert.equal(failed.status, "failed");
  assert.match(failed.error!, /interrupted/);
  assert.equal(second.runtime.store.run(completed.id)!.status, "completed", "the completed run is untouched");
  assert.equal(calls, 1, "nothing was re-executed on restart");
  const events = (await second.call("GET", `/runs/${orphan.id}`)).body;
  assert.equal(events.status, "failed");
});
