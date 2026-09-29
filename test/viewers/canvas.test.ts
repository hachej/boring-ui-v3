import test from "node:test";
import assert from "node:assert/strict";
import { memoryProvider, memoryReceipts } from "@boring/files/web";
import { call, createCanvasDocument, parseCanvas, serializeCanvas, type CanvasEditor, type CanvasShape, type ReceiptEvidence } from "@boring/viewers";

/** An in-memory drawing engine standing in for tldraw: the hook sees only the CanvasEditor adapter. */
function fakeEditor() {
  let shapes: CanvasShape[] = [];
  let selection: string[] = [];
  let seq = 0;
  const listeners = new Set<() => void>();
  const editor: CanvasEditor & { person(change: () => void): void; list(): CanvasShape[] } = {
    shapes: () => shapes, selection: () => selection,
    select: ids => { selection = [...ids]; },
    create: specs => specs.map(s => { const id = `shape:${++seq}`; shapes = [...shapes, { id, ...s }]; return id; }),
    update: updates => { shapes = shapes.map(s => { const u = updates.find(x => x.id === s.id); return u ? { ...s, ...u } : s; }); },
    snapshot: () => ({ shapes }),
    load: document => { shapes = ((document as { shapes?: CanvasShape[] } | null)?.shapes ?? []).map(s => ({ ...s })); },
    onChange: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    person: change => { change(); for (const l of listeners) l(); },
    list: () => shapes,
  };
  return editor;
}

const seed = serializeCanvas({ shapes: [{ id: "shape:a", type: "geo", x: 0, y: 0, w: 100, h: 50, text: "start", geo: "rectangle" }] });
function setup(readOnly = false) {
  const receipts = memoryReceipts();
  const files = memoryProvider({ seed: { "board.tldraw": seed }, receipts });
  const doc = createCanvasDocument({ files, address: "/workspace/board.tldraw", effect: { actor: "ana" }, readOnly });
  const editor = fakeEditor();
  return { doc, editor, files, receipts };
}
const tool = (doc: ReturnType<typeof createCanvasDocument>, name: string) => doc.tools.find(t => t.name === name)!;
const at = { mount: "workspace", path: "board.tldraw" };

test("canvas: the file round-trips; get_shapes reads the version and revision; tools need a mounted canvas", async () => {
  const { doc, editor } = setup();
  await doc.load();
  assert.equal((await call(tool(doc, "get_shapes"))).outcome, "unavailable", "no engine mounted, no shapes");
  doc.attach(editor);
  const read = await call(tool(doc, "get_shapes"));
  assert.equal(read.outcome, "applied");
  const detail = read.detail as { shapes: CanvasShape[]; version: number; revision: string };
  assert.deepEqual(detail.shapes.map(s => s.text), ["start"]);
  assert.equal(detail.revision, doc.store.get().saved!.revision);
  assert.deepEqual(parseCanvas(serializeCanvas({ a: 1 })), { a: 1 });
  assert.equal(parseCanvas(""), null);
  assert.throws(() => parseCanvas('{"format":"other"}'));
});

test("VIEWERS-3: create_shapes and update_shapes save at the revision read and return the receipt; select is local", async () => {
  const { doc, editor, files, receipts } = setup();
  await doc.load(); doc.attach(editor);
  const { version } = (await call(tool(doc, "get_shapes"))).detail as { version: number };
  const created = await call(tool(doc, "create_shapes"), { shapes: [{ type: "note", x: 200, y: 0, text: "risk", color: "yellow" }], version });
  assert.equal(created.outcome, "committed");
  const [id] = (created.detail as { created: string[] }).created;
  assert.equal((created.evidence as ReceiptEvidence).receipt.after, receipts.entries[0]!.after);
  assert.deepEqual((parseCanvas((await files.read(at)).content) as { shapes: CanvasShape[] }).shapes.map(s => s.text), ["start", "risk"]);
  assert.equal((await call(tool(doc, "select"), { ids: [id] })).outcome, "applied");
  assert.equal(receipts.entries.length, 1, "selecting is not a write");
  assert.equal((await call(tool(doc, "select"), { ids: ["shape:nope"] })).outcome, "denied");
  const v2 = doc.store.get().version;
  const moved = await call(tool(doc, "update_shapes"), { updates: [{ id: id!, x: 300, color: "red" }], version: v2 });
  assert.equal(moved.outcome, "committed");
  assert.equal(editor.list().find(s => s.id === id)!.x, 300);
  assert.equal((await call(tool(doc, "create_shapes"), { shapes: [{ type: "blob", x: 0, y: 0 }] })).outcome, "denied", "the schema refuses an unknown type");
});

test("UI-BOUNDARY-4: update_shapes bound to an old version is stale; over the person's unsaved changes it is a conflict", async () => {
  const { doc, editor, receipts } = setup();
  await doc.load(); doc.attach(editor);
  const { version } = (await call(tool(doc, "get_shapes"))).detail as { version: number };
  editor.person(() => editor.update([{ id: "shape:a", x: 10 }]));
  assert.equal(doc.store.get().dirty, true);
  assert.equal((await call(tool(doc, "update_shapes"), { updates: [{ id: "shape:a", x: 99 }], version })).outcome, "stale");
  assert.equal((await call(tool(doc, "update_shapes"), { updates: [{ id: "shape:a", x: 99 }], version: doc.store.get().version })).outcome, "conflict");
  assert.equal(editor.list()[0]!.x, 10, "the person's change is untouched");
  assert.equal(receipts.entries.length, 0);
  assert.equal((await doc.actions.save()).outcome, "committed");
  assert.equal((await call(tool(doc, "update_shapes"), { updates: [{ id: "shape:a", x: 99 }], version: doc.store.get().version })).outcome, "committed");
});

test("VIEWERS-5: a stale save of the person's drawing is a conflict; overwrite saves at the revision now seen", async () => {
  const { doc, editor, files } = setup();
  await doc.load(); doc.attach(editor);
  await files.write(at, serializeCanvas({ shapes: [] }), { expectedRevision: doc.store.get().saved!.revision }, { actor: "other" });
  editor.person(() => editor.create([{ type: "text", x: 1, y: 1, text: "mine" }]));
  assert.equal((await doc.actions.save()).outcome, "conflict");
  assert.ok(doc.store.get().conflict);
  assert.deepEqual((parseCanvas((await files.read(at)).content) as { shapes: unknown[] }).shapes, [], "the newer file is kept");
  assert.equal((await doc.actions.overwrite()).outcome, "committed");
  assert.equal((parseCanvas((await files.read(at)).content) as { shapes: CanvasShape[] }).shapes.length, 2);
});

test("VIEWERS-2: a read-only canvas offers no write tool and never saves", async () => {
  const { doc, editor, receipts } = setup(true);
  await doc.load(); doc.attach(editor);
  assert.deepEqual(doc.tools.map(t => t.name), ["get_shapes", "select"]);
  editor.person(() => editor.update([{ id: "shape:a", x: 5 }]));
  assert.equal(doc.store.get().dirty, false, "a read-only canvas does not track edits as changes to save");
  assert.equal((await doc.actions.save()).outcome, "denied");
  assert.equal(receipts.entries.length, 0);
});
