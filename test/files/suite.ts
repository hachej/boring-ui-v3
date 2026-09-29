/**
 * One conformance suite for every provider (BORING-3): stat/read/list/write/remove, create-only,
 * expected revision, exact revision resolution and receipts. A provider that cannot honour a step
 * refuses with a FileProviderError; none degrades silently.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { isFileError, memoryReceipts, type FileProvider, type Receipt, type ReceiptLog } from "@boring/files";

export type Factory = (options: { seed: Record<string, string>; receipts: ReceiptLog }) => Promise<FileProvider> | FileProvider;

const effect = { actor: "ana", thread: "t1", run: "r1", tool: "write_file" };
const at = (path: string) => ({ mount: "workspace", path });

export function conformance(name: string, factory: Factory, capabilities: { history: boolean } = { history: true }) {
  const fresh = async () => { const receipts = memoryReceipts(); const provider = await factory({ seed: { "notes/a.md": "alpha", "notes/b.md": "beta", "README.md": "root" }, receipts }); return { provider, receipts }; };

  test(`[${name}] FILES-1: stat and read return the revision the content came from; list names files and directories`, async () => {
    const { provider } = await fresh();
    const ref = await provider.stat(at("notes/a.md"));
    assert.ok(ref && ref.id && ref.revision);
    const read = await provider.read(at("notes/a.md"));
    assert.equal(read.content, "alpha");
    assert.deepEqual(read.ref, ref);
    assert.equal(await provider.stat(at("nope.md")), null);
    await assert.rejects(provider.read(at("nope.md")), e => isFileError(e, "missing"));
    const root = await provider.list(at(""));
    assert.deepEqual(root.map(e => [e.path, e.kind]), [["README.md", "file"], ["notes", "dir"]]);
    const notes = await provider.list(at("notes"));
    assert.deepEqual(notes.map(e => e.path), ["notes/a.md", "notes/b.md"]);
    assert.equal(notes[0].ref?.revision, ref!.revision);
    await assert.rejects(provider.list(at("missing-dir")), e => isFileError(e, "missing"));
  });

  test(`[${name}] FILES-2: a write names the revision it saw; a stale one is a conflict that changes nothing`, async () => {
    const { provider, receipts } = await fresh();
    const first = (await provider.stat(at("notes/a.md")))!.revision;
    const receipt = await provider.write(at("notes/a.md"), "alpha 2", { expectedRevision: first }, effect);
    assert.equal(receipt.before, first);
    assert.ok(receipt.after && receipt.after !== first);
    assert.equal((await provider.read(at("notes/a.md"))).content, "alpha 2");
    const stale = await provider.write(at("notes/a.md"), "alpha 3", { expectedRevision: first }, effect).then(() => null, e => e);
    assert.ok(isFileError(stale, "conflict"), `expected a conflict, got ${stale}`);
    assert.equal((stale.error as { current: string | null }).current, receipt.after);
    assert.equal((await provider.read(at("notes/a.md"))).content, "alpha 2", "a stale write changes nothing");
    assert.equal(receipts.entries.length, 1, "a rejected write leaves no receipt");
  });

  test(`[${name}] FILES-3: create is not overwrite`, async () => {
    const { provider, receipts } = await fresh();
    await assert.rejects(provider.write(at("notes/a.md"), "x", { create: true }, effect), e => isFileError(e, "exists"));
    await assert.rejects(provider.write(at("notes/new.md"), "x", { expectedRevision: "0" }, effect), e => isFileError(e, "missing") || isFileError(e, "conflict"));
    assert.equal((await provider.read(at("notes/a.md"))).content, "alpha");
    assert.equal(await provider.stat(at("notes/new.md")), null);
    assert.equal(receipts.entries.length, 0);
    const created = await provider.write(at("notes/new.md"), "fresh", { create: true }, effect);
    assert.equal(created.before, null);
    assert.equal((await provider.read(at("notes/new.md"))).content, "fresh");
  });

  test(`[${name}] FILES-4: remove carries the current revision; a recreate never brings the old revision back`, async () => {
    const { provider, receipts } = await fresh();
    const rev = (await provider.stat(at("notes/b.md")))!.revision;
    await assert.rejects(provider.remove(at("notes/b.md"), "stale", effect), e => isFileError(e, "conflict"));
    await assert.rejects(provider.remove(at("notes/none.md"), rev, effect), e => isFileError(e, "missing"));
    const removed = await provider.remove(at("notes/b.md"), rev, effect);
    assert.equal(removed.before, rev); assert.equal(removed.after, null);
    assert.equal(await provider.stat(at("notes/b.md")), null);
    await assert.rejects(provider.write(at("notes/b.md"), "beta", { expectedRevision: rev }, effect), e => isFileError(e, "missing") || isFileError(e, "conflict"));
    const again = await provider.write(at("notes/b.md"), "beta", { create: true }, effect);
    assert.notEqual(again.after, rev, "the same content recreated is a later revision");
    assert.equal(receipts.entries.length, 2);
  });

  test(`[${name}] SPEC §2.2: a read pinned to a revision is exact or refused`, async () => {
    const { provider } = await fresh();
    const first = (await provider.stat(at("notes/a.md")))!.revision;
    const pinned = await provider.read(at("notes/a.md"), { revision: first });
    assert.equal(pinned.content, "alpha"); assert.equal(pinned.ref.revision, first);
    const next = (await provider.write(at("notes/a.md"), "alpha 2", { expectedRevision: first }, effect)).after!;
    assert.equal((await provider.read(at("notes/a.md"), { revision: next })).content, "alpha 2");
    if (capabilities.history) assert.equal((await provider.read(at("notes/a.md"), { revision: first })).content, "alpha", "an earlier revision reads as it was");
    else await assert.rejects(provider.read(at("notes/a.md"), { revision: first }), e => isFileError(e, "unavailable"), "a provider without history refuses rather than serving the current one");
    await assert.rejects(provider.read(at("notes/a.md"), { revision: "no-such-revision" }), e => isFileError(e, "unavailable"));
  });

  test(`[${name}] FILES-7: every accepted mutation records one receipt with actor, run, tool and both revisions`, async () => {
    const { provider, receipts } = await fresh();
    const a = (await provider.stat(at("notes/a.md")))!;
    const w = await provider.write(at("notes/a.md"), "changed", { expectedRevision: a.revision }, effect);
    const c = await provider.write(at("c.md"), "new", { create: true }, { ...effect, tool: "create_file" });
    const r = await provider.remove(at("c.md"), c.after!, { ...effect, tool: "remove_file" });
    const rows: Receipt[] = [...receipts.entries];
    assert.deepEqual(rows, [w, c, r]);
    assert.deepEqual(rows.map(x => [x.address.path, x.before === null, x.after === null, x.effect.tool]), [["notes/a.md", false, false, "write_file"], ["c.md", true, false, "create_file"], ["c.md", false, true, "remove_file"]]);
    assert.equal(rows[0].before, a.revision); assert.equal(rows[0].id, a.id);
    for (const row of rows) { assert.equal(row.effect.actor, "ana"); assert.equal(row.effect.run, "r1"); assert.ok(row.at); }
  });
}
