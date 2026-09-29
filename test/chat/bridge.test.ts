import test from "node:test";
import assert from "node:assert/strict";
import { createChatClient, type ChatClient } from "@boring/chat/client";
import { createUiBridge, validateInput } from "@boring/chat/bridge";
import type { Event, UiRequestView } from "@boring/agent/wire";
import { bootEmbed } from "../agent/embed.ts";

const open = { name: "open_record", description: "Open a record", input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } };

test("CHAT-3: the bridge registers the page's commands, answers the agent's request through the wire alone, and the run gets the page's result", async t => {
  const { wire, runtime, call, settled } = await bootEmbed({ script: r => r.messages.some(m => m.role === "tool") ? { text: "Opened." } : { toolCalls: [{ name: "open_record", arguments: { id: "r7" } }] } });
  t.after(() => runtime.stop());
  const client = createChatClient({ endpoint: "http://app.local/agent", fetch: (input, init) => wire.fetch(new Request(input, init)) });
  const thread = (await call("POST", "/agents/operator/runs", { inputs: { text: "warm up" } })).body.thread;
  await runtime.idle();
  const opened: string[] = [];
  let shown = { kind: "record", id: "r1", version: "1" };
  const bridge = createUiBridge({ client, thread, page: "page-a", target: () => shown, commands: [{ ...open, handler: async input => { opened.push((input as { id: string }).id); return { outcome: "applied", detail: { now: (input as { id: string }).id } }; } }] });
  await bridge.start();
  assert.deepEqual((await client.uiRegistrations(thread)).map(r => [r.page, r.commands.map(c => c.name), r.target]), [["page-a", ["open_record"], shown]]);
  const run = await settled((await client.say("chat", "open r7", { thread })).run.id);
  assert.equal(run.status, "completed", run.error);
  assert.deepEqual(opened, ["r7"]);
  const parts = runtime.store.eventsOf({ run: run.id }).flatMap(e => e.kind === "message" ? e.message.parts : []).filter(p => p.type === "tool") as any[];
  assert.deepEqual(parts[0].output, { outcome: "applied", detail: { now: "r7" } });
  // The page navigates: a request bound to the earlier target is answered stale, the handler never runs.
  shown = { kind: "record", id: "r2", version: "1" };
  const stale = await settled((await client.say("chat", "open again", { thread })).run.id);
  assert.equal(stale.status, "completed");
  assert.deepEqual(opened, ["r7"]);
  const last = runtime.store.eventsOf({ run: stale.id }).flatMap(e => e.kind === "message" ? e.message.parts : []).filter(p => p.type === "tool") as any[];
  assert.equal(last[0].output.outcome, "stale");
  await bridge.stop();
  assert.deepEqual(await client.uiRegistrations(thread), []);
});

test("CHAT-3: an unregistered command or an input outside the schema is refused in the bridge before the handler; another page's request is ignored", async () => {
  const answers: { run: string; request: string; page: string; result: unknown }[] = [];
  const registrations: unknown[] = [];
  const fake: ChatClient = {
    say: async () => { throw new Error("unused"); }, cancel: async () => { throw new Error("unused"); }, run: async () => { throw new Error("unused"); }, job: async () => { throw new Error("unused"); },
    async *follow() { /* fed through handle */ }, createThread: async () => ({ id: "t", createdAt: "" }),
    async registerUi(thread, page, registration) { registrations.push({ thread, page, ...registration }); return { page, commands: registration.commands }; },
    async unregisterUi() {}, async uiRegistrations() { return []; },
    async answerUi(run, request, answer) { answers.push({ run, request, ...answer }); return { id: request, run, thread: "t", page: answer.page, command: "x", input: null, state: "answered", result: answer.result, at: "" }; },
  };
  let ran = 0;
  const bridge = createUiBridge({ client: fake, thread: "t", page: "me", commands: [{ ...open, handler: async () => { ran++; return { outcome: "applied" }; } }] });
  await bridge.start();
  const request = (over: Partial<UiRequestView>): Event => ({ cursor: "1", kind: "ui", ui: { id: "q1", run: "r", thread: "t", page: "me", command: "open_record", input: { id: "x" }, state: "requested", at: "", ...over } });
  await bridge.handle(request({ id: "q1", command: "evaluate" }));
  await bridge.handle(request({ id: "q2", input: { id: 42 } }));
  await bridge.handle(request({ id: "q3", input: {} }));
  await bridge.handle(request({ id: "q4", page: "someone-else" }));
  await bridge.handle(request({ id: "q5", state: "answered" }));
  assert.equal(ran, 0, "the handler never ran");
  assert.deepEqual(answers.map(a => [a.request, (a.result as { outcome: string }).outcome]), [["q1", "denied"], ["q2", "denied"], ["q3", "denied"]]);
  await bridge.handle(request({ id: "q6" }));
  await bridge.handle(request({ id: "q6" }));
  assert.equal(ran, 1, "a valid request runs once, whatever the replay repeats");
  assert.equal(answers.length, 4);
  assert.deepEqual(validateInput(open.input, { id: "a", extra: 1 }), []);
  assert.deepEqual(validateInput({ ...open.input, additionalProperties: false }, { id: "a", extra: 1 }), ["input.extra is not allowed"]);
  assert.deepEqual(validateInput({ type: "object", properties: { n: { type: "integer" }, k: { enum: ["a", "b"] } } }, { n: 1.5, k: "c" }), ["input.n must be an integer", 'input.k must be one of "a", "b"']);
});
