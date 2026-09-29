import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { directoryProvider, isFileError, memoryProvider, memoryReceipts, readonly } from "@boring/files";

const at = (p: string) => ({ mount: "workspace", path: p });
const effect = { actor: "ana", run: "r1", tool: "write_file" };

test("FILES-1: two providers never issue the same identity for different files", async () => {
  const a = memoryProvider({ seed: { "x.md": "1" } }), b = memoryProvider({ seed: { "x.md": "2" } });
  assert.notEqual((await a.stat(at("x.md")))!.id, (await b.stat(at("x.md")))!.id);
  assert.notEqual((await a.stat(at("x.md")))!.id, (await a.stat({ mount: "workspace", path: "y" }).then(() => a.write(at("y.md"), "3", { create: true }, effect)))!.id);
});

test("FILES-7: a mutation the storage refuses leaves no receipt; an accepted one commits with it", async () => {
  const receipts = memoryReceipts();
  const root = mkdtempSync(path.join(path.resolve(import.meta.dirname, "../../.cache"), "files-rcpt-"));
  const provider = directoryProvider({ root, receipts });
  await provider.write(at("ok.md"), "1", { create: true }, effect);
  assert.equal(receipts.entries.length, 1);
  if (process.getuid?.() !== 0) {
    mkdirSync(path.join(root, "sealed")); chmodSync(path.join(root, "sealed"), 0o500);
    await assert.rejects(provider.write(at("sealed/x.md"), "1", { create: true }, effect));
    chmodSync(path.join(root, "sealed"), 0o700);
  }
  assert.equal(receipts.entries.length, 1, "the failed write recorded nothing");
  const ro = readonly(provider);
  await assert.rejects(ro.write(at("ok.md"), "2", { expectedRevision: receipts.entries[0].after! }, effect), e => isFileError(e, "readonly"));
  await assert.rejects(ro.remove(at("ok.md"), receipts.entries[0].after!, effect), e => isFileError(e, "readonly"));
  assert.equal(receipts.entries.length, 1);
  assert.equal((await ro.read(at("ok.md"))).content, "1");
});

test("FILES-7: receipts from concurrent writers to one directory are consistent with the final content", async () => {
  const receipts = memoryReceipts();
  const root = mkdtempSync(path.join(path.resolve(import.meta.dirname, "../../.cache"), "files-race-"));
  const provider = directoryProvider({ root, receipts });
  const first = await provider.write(at("n.md"), "0", { create: true }, effect);
  const results = await Promise.allSettled([1, 2, 3, 4].map(i => provider.write(at("n.md"), String(i), { expectedRevision: first.after! }, effect)));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1, "exactly one writer at the observed revision wins");
  assert.equal(receipts.entries.length, 2);
  const winner = results.find(r => r.status === "fulfilled") as PromiseFulfilledResult<any>;
  assert.equal((await provider.read(at("n.md"))).ref.revision, winner.value.after);
});
