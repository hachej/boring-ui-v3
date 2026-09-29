// The example over HTTP, headless: the agent's file tool, the page's file routes and the tree read one revision
// (FILES-6), and the tree built on the page's provider shows a file the agent wrote (BORING-4: rebuilt by listing).
import test from "node:test";
import assert from "node:assert/strict";
import { createChatClient } from "@boring/chat/client";
import { httpFiles } from "@boring/files/web";
import { createFileTree } from "@boring/viewers";
import { startServer } from "../../examples/registry-host/server.mjs";

test("FILES-6: a write by the agent's tool is read at the same revision through the page's file routes and listed by the tree", async t => {
  const server = await startServer();
  t.after(() => server.stop());
  const client = createChatClient({ endpoint: `${server.url}/agent` });
  const files = httpFiles({ endpoint: `${server.url}/files` });
  const tree = createFileTree({ files, roots: ["/workspace", "/code"], readOnlyRoots: ["/code"] });
  await tree.start();
  await tree.actions.expand("/workspace/notes");
  assert.ok(!tree.store.get().loaded["/workspace/notes"]!.some(e => e.name === "agent-note.md"));

  const { run } = await client.say("chat", "write a note");
  await server.runtime.idle();
  assert.equal((await client.run(run.id)).status, "completed");
  const receipt = server.receipts.entries.find(r => r.address.path === "notes/agent-note.md")!;
  assert.ok(receipt, "the agent's write left a receipt");
  assert.equal(receipt.effect.actor, "dev");
  assert.equal(receipt.effect.run, run.id);

  const read = await files.read({ mount: "workspace", path: "notes/agent-note.md" });
  assert.equal(read.ref.revision, receipt.after, "the page reads the revision the agent wrote");
  await tree.refresh();
  const entry = tree.store.get().loaded["/workspace/notes"]!.find(e => e.name === "agent-note.md");
  assert.equal(entry?.revision, receipt.after, "the tree lists it at that revision");

  // The page's own save through the routes is attributed by the server's session, and the agent's next read sees it.
  const saved = await files.write({ mount: "workspace", path: "notes/agent-note.md" }, "edited by the person", { expectedRevision: read.ref.revision }, { actor: "claimed-by-the-page" });
  assert.equal(saved.effect.actor, "dev", "the session names the actor, not the page");
  assert.equal((await server.workspaceOf({ id: "dev" }).read({ mount: "workspace", path: "notes/agent-note.md" })).ref.revision, saved.after);
  const refused = await files.write({ mount: "code", path: "README.md" }, "x", { expectedRevision: "any" }, { actor: "dev" }).then(() => null, e => e);
  assert.equal(refused?.code, "readonly", "/code is read-only through the routes too");
});
