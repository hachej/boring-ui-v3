import test from "node:test";
import assert from "node:assert/strict";
import { memoryProvider, memoryReceipts, readonly } from "@boring/files/web";
import { call, createMarkdownDocument, headingsOf, useMarkdownDocument, type ReceiptEvidence } from "@boring/viewers";
import { renderHook } from "./dom.ts";

const DOC = "# Plan\n\nShip the tree.\n\n## Risks\n\nNone yet.\n";
const at = { mount: "workspace", path: "plan.md" };
function setup(options: { readOnly?: boolean } = {}) {
  const receipts = memoryReceipts();
  const files = memoryProvider({ seed: { "plan.md": DOC }, receipts });
  const doc = createMarkdownDocument({ files, address: "/workspace/plan.md", effect: { actor: "ana" }, ...options });
  return { doc, files, receipts };
}
const tool = (doc: ReturnType<typeof createMarkdownDocument>, name: string) => doc.tools.find(t => t.name === name);

test("VIEWERS-3: an edit is local; saving writes at the revision read and returns the provider's receipt", async () => {
  const { doc, files, receipts } = setup();
  await doc.load();
  const read = doc.store.get().saved!.revision;
  doc.actions.edit(DOC.replace("None yet.", "The GitHub provider."));
  assert.equal(doc.store.get().dirty, true);
  assert.equal(receipts.entries.length, 0, "typing is not a write");
  const saved = await doc.actions.save();
  assert.equal(saved.outcome, "committed");
  const { receipt } = saved.evidence as ReceiptEvidence;
  assert.equal(receipt.before, read);
  assert.equal(receipt.after, (await files.stat(at))!.revision);
  assert.equal(receipt.actor, "ana");
  assert.deepEqual(receipts.entries.map(r => r.after), [receipt.after]);
  assert.equal(doc.store.get().dirty, false);
});

test("VIEWERS-5: a stale save is a conflict that keeps both versions; overwrite writes only at the revision now seen", async () => {
  const { doc, files, receipts } = setup();
  await doc.load();
  const read = doc.store.get().saved!.revision;
  await files.write(at, "# Plan\n\nChanged by the agent.\n", { expectedRevision: read }, { actor: "agent" });
  doc.actions.edit("# Plan\n\nMine.\n");
  const saved = await doc.actions.save();
  assert.equal(saved.outcome, "conflict");
  assert.ok(doc.store.get().conflict, "the conflict banner shows");
  assert.equal((await files.read(at)).content, "# Plan\n\nChanged by the agent.\n", "the newer content is kept");
  assert.equal(doc.store.get().buffer, "# Plan\n\nMine.\n", "the person's buffer is kept");
  assert.equal(receipts.entries.length, 1, "only the other writer's receipt");
  const overwritten = await doc.actions.overwrite();
  assert.equal(overwritten.outcome, "committed");
  assert.equal((overwritten.evidence as ReceiptEvidence).receipt.before, receipts.entries[0]!.after, "overwrite names the revision the person saw in the banner");
  assert.equal(doc.store.get().conflict, null);
  await doc.actions.reload();
  assert.equal(doc.store.get().buffer, "# Plan\n\nMine.\n");
});

test("VIEWERS-6: propose_patch saves nothing; the person's accept saves with a receipt; no tool accepts", async () => {
  const { doc, files, receipts } = setup();
  await doc.load();
  const propose = tool(doc, "propose_patch")!;
  const result = await call(propose, { edits: [{ find: "None yet.", replace: "Stale saves." }], summary: "name a risk" });
  assert.equal(result.outcome, "proposed");
  const [proposal] = doc.store.get().proposals;
  assert.ok(proposal);
  const changed = proposal.diff.filter(l => l.kind !== "same").map(l => `${l.kind} ${l.text}`).sort();
  assert.deepEqual(changed, ["add Stale saves.", "remove None yet."], "the person sees the diff");
  assert.equal((await files.read(at)).content, DOC, "nothing saved");
  assert.equal(receipts.entries.length, 0);
  assert.ok(doc.tools.every(t => !/accept/.test(t.name)), "no tool accepts");
  const accepted = await doc.actions.accept(proposal.id);
  assert.equal(accepted.outcome, "committed");
  assert.equal((await files.read(at)).content, DOC.replace("None yet.", "Stale saves."));
  assert.equal(receipts.entries.length, 1);
  assert.equal(doc.store.get().proposals.length, 0);
  // A proposal the buffer moved past is stale on accept, and nothing is saved.
  await call(propose, { edits: [{ find: "Ship the tree.", replace: "Ship the canvas." }] });
  doc.actions.edit(doc.store.get().buffer.replace("Ship the tree.", "Ship everything."));
  const late = await doc.actions.accept(doc.store.get().proposals[0]!.id);
  assert.equal(late.outcome, "stale");
  assert.equal(receipts.entries.length, 1);
  assert.equal((await call(propose, { edits: [{ find: "not in the doc", replace: "x" }] })).outcome, "denied");
  assert.equal((await call(propose, { edits: [{ find: "", replace: "x" }] })).outcome, "denied");
});

test("VIEWERS-5: apply_patch is bound to the revision read; unsaved edits by the person are a conflict", async () => {
  const { doc, files, receipts } = setup();
  await doc.load();
  const apply = tool(doc, "apply_patch")!;
  const rev = doc.store.get().saved!.revision;
  assert.equal((await call(apply, { edits: [{ find: "None yet.", replace: "x" }], revision: "0" })).outcome, "stale");
  doc.actions.edit(`${DOC}typing…`);
  assert.equal((await call(apply, { edits: [{ find: "None yet.", replace: "x" }], revision: rev })).outcome, "conflict");
  assert.equal(receipts.entries.length, 0);
  await doc.actions.reload();
  const ok = await call(apply, { edits: [{ find: "None yet.", replace: "Applied." }], revision: rev });
  assert.equal(ok.outcome, "committed");
  assert.equal((await files.read(at)).content, DOC.replace("None yet.", "Applied."));
  assert.equal(doc.store.get().dirty, false);
  assert.equal(doc.store.get().buffer, DOC.replace("None yet.", "Applied."));
});

test("VIEWERS-2: a read-only document offers no write tool and its save is denied, even on a writable provider", async () => {
  const { doc, files, receipts } = setup({ readOnly: true });
  await doc.load();
  assert.equal(tool(doc, "apply_patch"), undefined);
  doc.actions.edit("changed");
  assert.equal(doc.store.get().buffer, DOC, "the buffer does not change");
  assert.equal((await doc.actions.save()).outcome, "denied");
  assert.equal((await files.read(at)).content, DOC);
  assert.equal(receipts.entries.length, 0);
  // A provider that is read-only underneath refuses too, and the viewer learns it.
  const ro = createMarkdownDocument({ files: readonly(files), address: "/workspace/plan.md" });
  await ro.load();
  ro.actions.edit("changed");
  assert.equal((await ro.actions.save()).outcome, "denied");
  assert.equal(ro.store.get().readOnly, true);
  assert.equal(receipts.entries.length, 0);
});

test("local tools: headings, go_to_heading, selection and read_document", async () => {
  const { doc } = setup();
  await doc.load();
  assert.deepEqual(headingsOf("# A\n```\n# not\n```\n## A\n").map(h => [h.id, h.level]), [["a", 1], ["a-1", 2]]);
  assert.equal((await doc.actions.goToHeading("risks")).outcome, "applied");
  assert.equal(doc.store.get().navigation?.heading.text, "Risks");
  assert.equal((await doc.actions.goToHeading("Nowhere")).outcome, "denied");
  doc.actions.select({ from: 3, to: 7, text: "Plan" });
  assert.deepEqual((await call(tool(doc, "get_selection")!)).detail, { selection: { from: 3, to: 7, text: "Plan" } });
  const read = await call(tool(doc, "read_document")!);
  assert.equal((read.detail as { content: string }).content, DOC);
  assert.deepEqual((read.detail as { headings: { text: string }[] }).headings.map(h => h.text), ["Plan", "Risks"]);
});

test("useMarkdownDocument: another address is another document; the person's controls work through the hook", async () => {
  const files = memoryProvider({ seed: { "a.md": "# A", "b.md": "# B" } });
  const h = await renderHook(p => useMarkdownDocument(p), { files, address: "/workspace/a.md" });
  await h.settle();
  assert.equal(h.result.current.state.buffer, "# A");
  const first = h.result.current.doc;
  await h.rerender({ files, address: "/workspace/b.md" });
  await h.settle();
  assert.notEqual(h.result.current.doc, first);
  assert.equal(h.result.current.state.buffer, "# B");
  await h.act(() => h.result.current.actions.edit("# B!"));
  assert.equal((await h.act(() => h.result.current.actions.save())).outcome, "committed");
  assert.equal((await files.read({ mount: "workspace", path: "b.md" })).content, "# B!");
  await h.unmount();
});
