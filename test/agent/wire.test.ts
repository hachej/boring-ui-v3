import test from "node:test";
import assert from "node:assert/strict";
import { boot, goodScript, type Script } from "./helpers.ts";

test("the wire drives the notes app: manifest, run, events, dedupe, job, conversation", async t => {
  const seen: string[] = [];
  const script: Script = request => { seen.push(request.model); return goodScript(request); };
  const { call, events, settled, runtime } = await boot({ script });
  t.after(() => runtime.stop());

  const manifest = (await call("GET", "/.well-known/boring.json")).body;
  assert.equal(manifest.name, "notes");
  assert.deepEqual(manifest.agents.map((a: { name: string }) => a.name), ["answer", "summarise"]);
  assert.deepEqual(manifest.jobs[0].children, ["summarise"]);
  assert.equal(manifest.conversations[0].agent, "answer");
  assert.equal(manifest.agents[1].outputs.schema.type, "object");
  assert.deepEqual(manifest.agents[1].inputs, { type: "object", properties: { note: { type: "string", description: "The text of the note to summarise" } }, required: ["note"] });
  assert.deepEqual(manifest.jobs[0].inputs, { type: "object", properties: { notes: { type: "array", items: { type: "string" }, description: "The notes to digest, one summary each" } }, required: ["notes"] });
  assert.deepEqual(manifest.conversations[0].inputs.properties.notes.type, "array");
  assert.deepEqual(manifest.agents[0].outputs, { markdown: "the agent's answer as markdown" });

  const started = await call("POST", "/agents/summarise/runs", { inputs: { note: "Buy milk tomorrow." }, idempotencyKey: "k1" });
  assert.equal(started.status, 202);
  assert.equal(started.body.status, "pending");
  const run = await settled(started.body.id);
  assert.equal(run.status, "completed");
  assert.deepEqual(run.output, { title: "A note", summary: "It says something.", tags: ["note"] });
  assert.deepEqual(seen, ["fake/summarise"]);

  const again = await call("POST", "/agents/summarise/runs", { inputs: { note: "Buy milk tomorrow." }, idempotencyKey: "k1" });
  assert.equal(again.body.id, started.body.id, "same key and request returns the recorded run");
  const other = await call("POST", "/agents/summarise/runs", { inputs: { note: "Something else." }, idempotencyKey: "k1" });
  assert.equal(other.status, 409, "same key with another request is a conflict");

  const replay = await events(`/runs/${run.id}/events`);
  assert.deepEqual(replay.map(e => e.kind), ["run", "message", "run", "message", "run"], "recorded, the person's message, running, the answer, completed");
  const answerEvent = replay[3];
  assert.equal(answerEvent.kind === "message" ? answerEvent.message.role : null, "agent");
  const tail = await events(`/runs/${run.id}/events?cursor=${replay[2].cursor}`);
  assert.deepEqual(tail.map(e => e.cursor), replay.slice(3).map(e => e.cursor));

  const job = await call("POST", "/jobs/digest/start", { inputs: { notes: ["one", "two"] } });
  assert.equal(job.status, 202);
  assert.equal(job.body.children.length, 2);
  await runtime.idle();
  const done = (await call("GET", `/jobs/${job.body.id}`)).body;
  assert.equal(done.status, "completed");
  assert.equal(done.output.summaries.length, 2);
  const forbidden = await call("POST", "/jobs/digest/start", { inputs: { notes: [] } });
  assert.equal(forbidden.status, 400);

  const say = await call("POST", "/conversations/questions/messages", { text: "What did I buy?", inputs: { notes: ["Buy milk."] } });
  assert.equal(say.status, 202);
  const answer = await settled(say.body.run.id);
  assert.match(answer.output, /^Answer to: What did I buy\?/);
  const follow = await call("POST", "/conversations/questions/messages", { text: "And when?", thread: say.body.thread, inputs: { notes: ["Buy milk."] } });
  await runtime.idle();
  const thread = await events(`/threads/${say.body.thread}/events?live=0`);
  assert.deepEqual(thread.filter(e => e.kind === "message").map(e => e.kind === "message" && e.message.role), ["person", "agent", "person", "agent"]);
  assert.equal(follow.body.thread, say.body.thread);

  assert.equal((await call("GET", "/runs/nope")).status, 404);
  assert.equal((await call("POST", "/agents/missing/runs", {})).status, 404);
  assert.equal((await call("GET", "/runs/x", undefined, { "x-test-actor": "" })).status, 404);
});

test("an unauthenticated request is refused before anything is recorded", async t => {
  const { call, runtime, host } = await boot();
  t.after(() => runtime.stop());
  host.actor = null;
  assert.equal((await call("POST", "/agents/summarise/runs", { inputs: { note: "x" } })).status, 401);
  assert.equal((await call("GET", "/.well-known/boring.json")).status, 200, "the manifest is public");
});

test("AGENT-12: a job's children are listed in plan order, and wait resolves when a run ends", async t => {
  const { runtime, host } = await boot();
  t.after(() => runtime.stop());
  const actor = host.actor!;
  const job = await runtime.startJob(actor, { job: "digest", inputs: { notes: ["a", "b"] } });
  const children = runtime.children(actor, job.id);
  assert.deepEqual(children.map(c => c.agent), ["summarise", "summarise"]);
  const ended = await Promise.all(children.map(c => runtime.wait(actor, c.id)));
  assert.deepEqual(ended.map(r => r.status), ["completed", "completed"]);
  assert.equal((await runtime.wait(actor, children[0].id)).status, "completed", "an ended run resolves at once");
  assert.throws(() => runtime.children({ id: "someone-else" }, job.id), /unknown job/);
});
