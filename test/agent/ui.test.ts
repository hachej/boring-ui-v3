import test from "node:test";
import assert from "node:assert/strict";
import { bootEmbed } from "./embed.ts";
import type { Script } from "./helpers.ts";
import type { Event, UiRequestView } from "@boring/agent/wire";

const commands = [
  { name: "open_record", description: "Open a record on the page", input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] } },
  { name: "highlight", description: "Highlight a field", input: { type: "object", properties: { field: { type: "string" } }, required: ["field"] } },
];
const opener: Script = request => request.messages.some(m => m.role === "tool") ? { text: "Opened it." } : { toolCalls: [{ name: "open_record", arguments: { id: "r1" } }] };

/** Follows a run's stream until a ui request appears, from the wire alone. */
async function firstUiRequest(wire: { fetch: (r: Request) => Promise<Response> }, run: string): Promise<UiRequestView> {
  const response = await wire.fetch(new Request(`http://app.local/agent/runs/${run}/events`));
  const reader = response.body!.getReader(); const decoder = new TextDecoder(); let buffer = "";
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (const line of buffer.split("\n").filter(Boolean)) { const event = JSON.parse(line) as Event; if (event.kind === "ui" && event.ui.state === "requested") { await reader.cancel(); return event.ui; } }
  }
  throw new Error("no ui request in the stream");
}

test("CHAT-3 / UI-BOUNDARY-4,5: a page registers commands, the agent's call is a request event, the page answers once through the wire", async t => {
  const { call, wire, runtime, settled } = await bootEmbed({ script: opener });
  t.after(() => runtime.stop());
  const thread = (await call("POST", "/agents/operator/runs", { inputs: { text: "warm up" } })).body.thread;
  await runtime.idle();
  const registered = await call("PUT", `/threads/${thread}/ui/page-1`, { commands, target: { kind: "record", id: "r0", version: "3" } });
  assert.equal(registered.status, 200);
  const started = (await call("POST", "/conversations/chat/messages", { text: "open r1", thread })).body.run;
  const request = await firstUiRequest(wire, started.id);
  assert.equal(request.command, "open_record"); assert.deepEqual(request.input, { id: "r1" }); assert.equal(request.page, "page-1");
  assert.deepEqual(request.target, { kind: "record", id: "r0", version: "3" }, "the request binds the target the page reported");
  assert.equal((await call("POST", `/runs/${started.id}/ui/${request.id}`, { page: "page-2", result: { outcome: "applied" } })).status, 404, "another page instance cannot answer");
  assert.equal((await call("POST", `/runs/${started.id}/ui/${request.id}`, { page: "page-1", result: { outcome: "applied" } }, { "x-test-actor": "bob" })).status, 404, "another actor cannot answer");
  const answered = await call("POST", `/runs/${started.id}/ui/${request.id}`, { page: "page-1", result: { outcome: "applied", detail: { opened: "r1" } } });
  assert.equal(answered.status, 200); assert.equal(answered.body.state, "answered");
  assert.equal((await call("POST", `/runs/${started.id}/ui/${request.id}`, { page: "page-1", result: { outcome: "committed" } })).status, 409, "one answer per request");
  const run = await settled(started.id);
  assert.equal(run.status, "completed", run.error);
  const receipt = runtime.store.receiptsOf(started.id)[0];
  assert.equal(receipt.tool, "open_record"); assert.equal(receipt.ok, true); assert.deepEqual(receipt.revisions, [], "a page command carries no file revision: local interaction is not a durable effect");
  const parts = runtime.store.eventsOf({ run: started.id }).flatMap(e => e.kind === "message" ? e.message.parts : []).filter(p => p.type === "tool") as any[];
  assert.deepEqual(parts[0].output, { outcome: "applied", detail: { opened: "r1" } });
  const ui = (await call("GET", `/threads/${thread}/ui`)).body;
  assert.deepEqual(ui.map((r: any) => r.page), ["page-1"]);
});

test("CHAT-3 / AGENT-3: a command the definition did not name, the host did not allow, or no page registered is never offered; a registration cannot shadow a backend tool", async t => {
  let offered: readonly string[] = [];
  const { call, runtime, settled } = await bootEmbed({ script: () => ({ text: "ok" }), allowed: ["open_record", "read_file"], host: { async mayRequest(_a, r) { offered = r.tools; return true; } } });
  t.after(() => runtime.stop());
  const thread = (await call("POST", "/agents/operator/runs", { inputs: { text: "warm up" } })).body.thread;
  await runtime.idle();
  assert.deepEqual(offered, ["read_file"], "no page yet: no page command");
  await call("PUT", `/threads/${thread}/ui/p`, { commands: [...commands, { name: "evaluate", description: "not in ui:", input: { type: "object", properties: {} } }] });
  await settled((await call("POST", "/conversations/chat/messages", { text: "x", thread })).body.run.id);
  assert.deepEqual(offered, ["read_file", "open_record"], "highlight is not host-allowed, evaluate is not declared");
  assert.equal((await call("PUT", `/threads/${thread}/ui/p`, { commands: [{ name: "read_file", description: "shadow", input: { type: "object" } }] })).status, 409);
  assert.equal((await call("PUT", `/threads/${thread}/ui/p`, { commands: [{ name: "bad name", description: "", input: { type: "object" } }] })).status, 400);
  assert.equal((await call("PUT", `/threads/${thread}/ui/p`, { commands: [{ name: "open_record", description: "no schema", input: { type: "string" } }] })).status, 400);
  assert.equal((await call("PUT", `/threads/other/ui/p`, { commands })).status, 404);
});

test("UI-BOUNDARY-4: a request expires when the page does not answer, ends unavailable when the page leaves, and is stale when the page moves target", async t => {
  const { call, wire, runtime, settled } = await bootEmbed({ script: opener, uiTimeout: 150 });
  t.after(() => runtime.stop());
  const thread = (await call("POST", "/agents/operator/runs", { inputs: { text: "warm up" } })).body.thread;
  await runtime.idle();
  await call("PUT", `/threads/${thread}/ui/p1`, { commands });
  const first = (await call("POST", "/conversations/chat/messages", { text: "open", thread })).body.run;
  const request = await firstUiRequest(wire, first.id);
  const ended = await settled(first.id);
  assert.equal(ended.status, "completed");
  assert.equal(runtime.store.uiRequest(request.id)!.state, "expired");
  assert.equal((await call("POST", `/runs/${first.id}/ui/${request.id}`, { page: "p1", result: { outcome: "applied" } })).status, 409, "a late answer is refused");
  const parts = () => runtime.store.eventsOf({ thread }).flatMap(e => e.kind === "message" ? e.message.parts : []).filter(p => p.type === "tool") as any[];
  assert.equal(parts().at(-1).output.outcome, "unavailable");

  // The page unmounts while a request is open.
  const second = (await call("POST", "/conversations/chat/messages", { text: "open again", thread })).body.run;
  const open = await firstUiRequest(wire, second.id);
  await call("DELETE", `/threads/${thread}/ui/p1`);
  await settled(second.id);
  assert.equal(runtime.store.uiRequest(open.id)!.state, "unavailable");

  // The page moves to another target while a request is open: the request bound the old one.
  await call("PUT", `/threads/${thread}/ui/p1`, { commands, target: { kind: "record", id: "a", version: "1" } });
  const third = (await call("POST", "/conversations/chat/messages", { text: "open once more", thread })).body.run;
  const bound = await firstUiRequest(wire, third.id);
  assert.deepEqual(bound.target, { kind: "record", id: "a", version: "1" });
  await call("PUT", `/threads/${thread}/ui/p1`, { commands, target: { kind: "record", id: "b", version: "1" } });
  await settled(third.id);
  assert.equal(runtime.store.uiRequest(bound.id)!.result?.outcome, "stale");
  assert.equal(parts().at(-1).output.outcome, "unavailable");
});

test("BORING-4 / CHAT-1: a page reconnecting rebuilds the open request from the thread's replay and can still answer it", async t => {
  const { call, events, runtime, settled, wire } = await bootEmbed({ script: opener, uiTimeout: 5000 });
  t.after(() => runtime.stop());
  const thread = (await call("POST", "/agents/operator/runs", { inputs: { text: "warm up" } })).body.thread;
  await runtime.idle();
  await call("PUT", `/threads/${thread}/ui/p1`, { commands });
  const run = (await call("POST", "/conversations/chat/messages", { text: "open", thread })).body.run;
  await firstUiRequest(wire, run.id);
  const replay = await events(`/threads/${thread}/events?live=0`);
  const pending = replay.filter(e => e.kind === "ui" && e.ui.state === "requested").map(e => (e as { ui: UiRequestView }).ui);
  assert.equal(pending.length, 1);
  assert.equal((await call("POST", `/runs/${run.id}/ui/${pending[0].id}`, { page: "p1", result: { outcome: "committed", evidence: { revision: "7" } } })).status, 200);
  assert.equal((await settled(run.id)).status, "completed");
  const again = await events(`/threads/${thread}/events?live=0`);
  assert.deepEqual(again.filter(e => e.kind === "ui").map(e => (e as any).ui.state), ["requested", "answered"], "both states are records, replayed in order");
});
