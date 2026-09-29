import test from "node:test";
import assert from "node:assert/strict";
import { memoryProvider, memoryReceipts, mountRouter, readonly } from "@boring/files/web";
import { call, createFileTree, pageCommands, useFileTree, type TreeEntry } from "@boring/viewers";
import { renderHook } from "./dom.ts";

function setup(extra: Partial<Parameters<typeof createFileTree>[0]> = {}) {
  const receipts = memoryReceipts();
  const workspace = memoryProvider({ seed: { "notes/plan.md": "# Plan", "notes/log.md": "log", "todo.md": "- a" }, receipts });
  const code = readonly(memoryProvider({ seed: { "src/app.ts": "export {}", "README.md": "# App" } }));
  const files = mountRouter({ workspace, code });
  const opened: TreeEntry[] = [];
  const tree = createFileTree({ files, roots: ["/workspace", "/code"], readOnlyRoots: ["/code"], onOpen: e => opened.push(e), ...extra });
  return { tree, receipts, files, workspace, opened };
}
const tool = (tree: ReturnType<typeof createFileTree>, name: string) => tree.tools.find(t => t.name === name)!;

test("VIEWERS-3: expand, select and filter are local: applied, the tree changes, no receipt", async () => {
  const { tree, receipts, opened } = setup();
  await tree.start();
  assert.deepEqual(tree.nodes().map(n => [n.id, n.children?.map(c => c.name)]), [["/workspace", ["notes", "todo.md"]], ["/code", ["src", "README.md"]]]);
  const expanded = await tree.actions.expand("/workspace/notes");
  assert.equal(expanded.outcome, "applied");
  assert.deepEqual(tree.nodes()[0]!.children![0]!.children!.map(c => c.name), ["log.md", "plan.md"]);
  const selected = await tree.actions.select("/workspace/notes/plan.md");
  assert.equal(selected.outcome, "applied");
  assert.equal(tree.store.get().selected, "/workspace/notes/plan.md");
  assert.deepEqual(opened.map(e => e.address), ["/workspace/notes/plan.md"], "selecting a file opens it for the person");
  await tree.actions.filter("plan");
  assert.deepEqual(tree.nodes()[0]!.children!.map(c => c.name), ["notes"], "a directory stays when a loaded descendant matches");
  assert.deepEqual(tree.nodes()[0]!.children![0]!.children!.map(c => c.name), ["plan.md"]);
  assert.equal((await tree.actions.select("/elsewhere/x.md")).outcome, "denied", "outside the roots is refused");
  assert.equal(receipts.entries.length, 0, "local interaction leaves no receipt");
});

test("VIEWERS-3: create, rename and remove go through the provider's conditions and return its receipts", async () => {
  const { tree, receipts, workspace } = setup();
  await tree.start();
  const created = await tree.actions.create("/workspace/notes/new.md", "fresh");
  assert.equal(created.outcome, "committed");
  const evidence = created.evidence as { receipt: { address: string; before: null; after: string } };
  assert.deepEqual([evidence.receipt.address, evidence.receipt.before], ["/workspace/notes/new.md", null]);
  assert.equal(evidence.receipt.after, receipts.entries[0]!.after);
  assert.equal((await tree.actions.create("/workspace/notes/new.md")).outcome, "conflict", "create is not overwrite (FILES-3)");
  await tree.actions.expand("/workspace/notes");
  const rev = tree.store.get().loaded["/workspace/notes"]!.find(e => e.name === "new.md")!.revision!;
  const renamed = await tree.actions.rename("/workspace/notes/new.md", "/workspace/notes/renamed.md", rev);
  assert.equal(renamed.outcome, "committed");
  assert.equal((renamed.evidence as { receipts: unknown[] }).receipts.length, 2, "a rename is a create and a remove, two receipts");
  assert.deepEqual(tree.store.get().loaded["/workspace/notes"]!.map(e => e.name), ["log.md", "plan.md", "renamed.md"], "the tree reflects the provider");
  // The source changes under the rename: the copy is undone and the refusal reported.
  const plan = (await workspace.stat({ mount: "workspace", path: "notes/plan.md" }))!.revision;
  await workspace.write({ mount: "workspace", path: "notes/plan.md" }, "# Plan v2", { expectedRevision: plan }, { actor: "other" });
  const refused = await tree.actions.rename("/workspace/notes/plan.md", "/workspace/notes/moved.md", plan);
  assert.equal(refused.outcome, "conflict");
  assert.equal(await workspace.stat({ mount: "workspace", path: "notes/moved.md" }), null, "nothing left behind");
  const stale = await tree.actions.remove("/workspace/notes/plan.md", plan);
  assert.equal(stale.outcome, "conflict", "remove at a stale revision is a conflict");
  assert.ok(await workspace.stat({ mount: "workspace", path: "notes/plan.md" }));
});

test("VIEWERS-2: a read-only root refuses writes even on a writable provider; a read-only tree offers no write tool", async () => {
  const receipts = memoryReceipts();
  const writable = memoryProvider({ seed: { "src/app.ts": "x" }, receipts });
  const tree = createFileTree({ files: mountRouter({ code: writable }), roots: ["/code"], readOnlyRoots: ["/code"] });
  await tree.start();
  const result = await tree.actions.create("/code/src/evil.ts", "y");
  assert.equal(result.outcome, "denied");
  assert.equal(receipts.entries.length, 0);
  assert.equal(await writable.stat({ mount: "code", path: "src/evil.ts" }), null);
  const ro = createFileTree({ files: mountRouter({ code: writable }), roots: ["/code"], readOnly: true });
  assert.deepEqual(ro.tools.map(t => t.name), ["expand", "collapse", "select", "filter", "list"]);
  assert.equal((await ro.actions.create("/code/x.ts")).outcome, "denied", "the person's control finds no tool either");
});

test("VIEWERS-1: the person's action and the agent's page command are one tool: same schema refusal, same result", async () => {
  const a = setup(), b = setup();
  await a.tree.start(); await b.tree.start();
  const commands = pageCommands(b.tree.tools, "tree");
  assert.ok(commands.every(c => c.name.startsWith("tree_")));
  const expand = commands.find(c => c.name === "tree_expand")!;
  const byAgent = await expand.handler({ path: "/workspace/notes" }, { request: {} as never });
  const byPerson = await a.tree.actions.expand("/workspace/notes");
  assert.deepEqual(byAgent, byPerson);
  assert.deepEqual(a.tree.nodes(), b.tree.nodes());
  assert.equal((await expand.handler({ path: 7 } as never, { request: {} as never })).outcome, "denied");
  assert.equal((await call(tool(a.tree, "expand"), { path: 7 })).outcome, "denied");
  assert.equal((await call(tool(a.tree, "expand"), { path: "/workspace", extra: 1 })).outcome, "denied", "unknown properties are refused");
});

test("useFileTree: mounts, loads the roots, and refreshes to show a file written elsewhere", async () => {
  const { files, workspace } = setup();
  const h = await renderHook(p => useFileTree(p), { files, roots: ["/workspace"], refreshInterval: 20 });
  await h.settle(20);
  assert.deepEqual(h.result.current.nodes[0]!.children!.map(n => n.name), ["notes", "todo.md"]);
  await workspace.write({ mount: "workspace", path: "agent.md" }, "by the agent", { create: true }, { actor: "agent" });
  await h.settle(60);
  assert.deepEqual(h.result.current.nodes[0]!.children!.map(n => n.name), ["notes", "agent.md", "todo.md"]);
  await h.unmount();
});
