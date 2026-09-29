import test from "node:test";
import assert from "node:assert/strict";
import { createChatClient, ndjson } from "@boring/chat/client";
import { boot } from "../agent/helpers.ts";

test("ndjson splits chunks on lines, whatever the chunk boundaries", async () => {
  const lines = ['{"cursor":"1","kind":"run","run":{"id":"a"}}', '{"cursor":"2","kind":"decision","decision":"d","answered":false}'];
  const bytes = new TextEncoder().encode(lines.join("\n") + "\n");
  const stream = new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7)); c.close(); } });
  const events = [];
  for await (const event of ndjson(stream)) events.push(event);
  assert.deepEqual(events.map(e => e.cursor), ["1", "2"]);
});

test("the client says, follows a thread by cursor, and cancels, through the wire alone", async t => {
  const { wire, runtime } = await boot();
  t.after(() => runtime.stop());
  const client = createChatClient({ endpoint: "http://app.local/agent", fetch: (input, init) => wire.fetch(new Request(input, init)) });
  const { thread, run } = await client.say("questions", "What?", { inputs: { notes: ["Milk"] } });
  assert.equal(run.status, "pending");
  const seen = [];
  for await (const event of client.follow({ run: run.id })) seen.push(event);
  assert.equal(seen.at(-1)?.kind, "run", "the run stream ends at the terminal run event");
  assert.ok(seen.some(e => e.kind === "message" && e.message.role === "agent"), "and the answer is in it");
  const replay = [];
  for await (const event of client.follow({ thread }, { live: false })) replay.push(event);
  assert.deepEqual(replay.map(e => e.cursor), seen.map(e => e.cursor), "a reload rebuilds the same transcript");
  const later = [];
  for await (const event of client.follow({ thread }, { live: false, cursor: replay[1].cursor })) later.push(event);
  assert.deepEqual(later.map(e => e.cursor), replay.slice(2).map(e => e.cursor));
  await assert.rejects(client.cancel(run.id), /already ended/);
  assert.equal((await client.run(run.id)).status, "completed");
});
