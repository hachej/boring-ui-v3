/**
 * The bridge round trip without a page: a headless caller registers the same commands over the wire,
 * the scripted agent calls one and then writes a file, and the receipts say what changed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createChatClient } from "@boring/chat/client";
import { createUiBridge } from "@boring/chat/bridge";
import { startServer } from "../server.mjs";

test("embed-host: a headless page answers the agent's command and the run writes to /workspace with receipts", async t => {
  const server = await startServer();
  t.after(() => server.stop());
  const client = createChatClient({ endpoint: `${server.url}/agent` });
  const first = { thread: (await client.createThread()).id };
  const opened: string[] = [];
  const bridge = createUiBridge({ client, thread: first.thread, commands: [
    { name: "open_record", description: "Open a record", input: { type: "object", properties: { id: { type: "string" } }, required: ["id"] }, handler: async input => { opened.push((input as { id: string }).id); return { outcome: "applied" }; } },
    { name: "highlight", description: "Highlight", input: { type: "object", properties: { field: { type: "string" } }, required: ["field"] }, handler: async () => ({ outcome: "applied" }) },
  ] });
  await bridge.start();
  const { run } = await client.say("chat", "please open r2", { thread: first.thread });
  let final = run;
  for await (const event of client.follow({ run: run.id })) if (event.kind === "run") final = event.run;
  assert.equal(final.status, "completed", final.error);
  assert.deepEqual(opened, ["r2"]);
  assert.match(String(final.output), /Opened r2/);
  const note = await server.workspaceOf({ id: "dev" }).read({ mount: "workspace", path: "notes/r2.md" });
  assert.equal(note.content, "opened r2");
  const mine = server.receipts.entries.filter(r => r.effect.run === run.id);
  assert.equal(mine.length, 1);
  assert.deepEqual([mine[0].before, mine[0].after, mine[0].effect.tool], [null, note.ref.revision, "write_file"]);
  const rows = server.runtime.store.receiptsOf(run.id);
  assert.deepEqual(rows.map(r => [r.tool, r.ok]), [["open_record", true], ["write_file", true]]);
  assert.deepEqual(rows[1].revisions, [{ mount: "workspace", path: "notes/r2.md", before: null, after: note.ref.revision }]);
  // The app's own backend path is the same for a person and an agent: bound to the observed version.
  assert.equal(server.records.setStatus("r2", "done", 99, "dev").outcome, "conflict");
  assert.equal(server.records.setStatus("r2", "done", 1, "dev").outcome, "committed");
  await bridge.stop();
});
