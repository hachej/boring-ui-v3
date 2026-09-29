import test from "node:test";
import assert from "node:assert/strict";
import { memoryProvider, memoryReceipts } from "@boring/files/web";
import { call, createWorkspaceLayout, pageCommands, useWorkspaceLayout, type ReceiptEvidence } from "@boring/viewers";
import { renderHook } from "./dom.ts";

const kinds = ["markdown", "image", "canvas"];
const at = { mount: "workspace", path: ".boring/layout.json" };
function setup() {
  const receipts = memoryReceipts();
  const files = memoryProvider({ seed: {}, receipts });
  const ws = createWorkspaceLayout({ files, address: "/workspace/.boring/layout.json", kinds, effect: { actor: "ana" } });
  return { ws, files, receipts };
}

test("open, focus, close and list are local; kinds come from the extension and must be registered", async () => {
  const { ws, receipts } = setup();
  await ws.load();
  assert.equal(ws.store.get().status, "ready", "no layout file yet is an empty workspace");
  const opened = await ws.actions.open("/workspace/notes/plan.md");
  assert.deepEqual(opened, { outcome: "applied", detail: { panel: "markdown:/workspace/notes/plan.md", opened: true } });
  await ws.actions.open("/workspace/images/diagram.svg");
  assert.equal(ws.store.get().active, "image:/workspace/images/diagram.svg");
  assert.deepEqual((await ws.actions.open("/workspace/notes/plan.md")).detail, { panel: "markdown:/workspace/notes/plan.md", focused: true }, "an open panel is focused, not duplicated");
  assert.equal(ws.store.get().panels.length, 2);
  assert.equal((await ws.actions.open("/workspace/data.csv")).outcome, "denied");
  assert.equal((await ws.actions.open("/workspace/x.md", "chart")).outcome, "denied", "the schema refuses a kind the app did not register");
  const list = await call(ws.tools.find(t => t.name === "list_panels")!);
  assert.deepEqual((list.detail as { panels: { id: string }[] }).panels.map(p => p.id), ["markdown:/workspace/notes/plan.md", "image:/workspace/images/diagram.svg"]);
  assert.equal((await ws.actions.close("image:/workspace/images/diagram.svg")).outcome, "applied");
  assert.equal((await ws.actions.focus("nope")).outcome, "denied");
  assert.equal(receipts.entries.length, 0, "moving panels is not a write");
});

test("VIEWERS-3/5: the layout is saved per person as a file with a receipt; a stale save is a conflict; a reload restores it", async () => {
  const { ws, files, receipts } = setup();
  await ws.load();
  await ws.actions.open("/workspace/boards/plan.tldraw");
  ws.actions.layout({ grid: "a" });
  const created = await ws.actions.save();
  assert.equal(created.outcome, "committed");
  assert.equal((created.evidence as ReceiptEvidence).receipt.before, null, "the first save creates the file");
  const again = createWorkspaceLayout({ files, address: "/workspace/.boring/layout.json", kinds });
  await again.load();
  assert.deepEqual(again.store.get().panels.map(p => p.kind), ["canvas"]);
  assert.deepEqual(again.store.get().grid, { grid: "a" });
  await files.write(at, (await files.read(at)).content, { expectedRevision: receipts.entries[0]!.after! }, { actor: "other-tab" });
  await ws.actions.open("/workspace/notes/plan.md");
  assert.equal((await ws.actions.save()).outcome, "conflict");
  assert.ok(ws.store.get().conflict);
  assert.equal((await ws.actions.overwrite()).outcome, "committed");
});

test("VIEWERS-1: the agent's workspace_open_panel and the person's open are one tool; the hook autosaves", async () => {
  const files = memoryProvider({ seed: {} });
  const h = await renderHook(p => useWorkspaceLayout(p), { files, address: "/workspace/.boring/layout.json", kinds, autosave: 10 });
  await h.settle();
  const open = pageCommands(h.result.current.tools, "workspace").find(c => c.name === "workspace_open_panel")!;
  const byAgent = await h.act(() => open.handler({ target: "/workspace/notes/plan.md" }, { request: {} as never }));
  assert.equal(byAgent.outcome, "applied");
  assert.equal(h.result.current.state.active, "markdown:/workspace/notes/plan.md");
  await h.settle(60);
  assert.equal(h.result.current.state.dirty, false, "autosaved");
  assert.match((await files.read(at)).content, /markdown:\/workspace\/notes\/plan.md/);
  await h.unmount();
});
