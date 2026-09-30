import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { boot, makeHost, tempDir, type Script } from "./helpers.ts";

const png = (fill: number, size = 64) => ({ data: new Uint8Array(size).fill(fill), mimeType: "image/png" });
/** Answers a reading call with what it saw: the image count, media type and size, and the instruction. */
const reader: Script = request => {
  const images = request.messages.flatMap(m => m.images ?? []);
  if (images.length) return { text: `read ${images.length} ${images[0]!.mimeType} ${images[0]!.bytes}B under "${request.system}"` };
  return { text: "no image" };
};

test("AGENT-15: each image is read by one model call that sees it; the run is recorded, ends once, and every call is metered and attributed", async t => {
  const { runtime, host } = await boot({ script: reader });
  t.after(() => runtime.stop());
  const actor = { id: "ana" };
  const { run, readings } = await runtime.readImages(actor, { images: [png(1), png(2, 128)], instruction: "Transcribe.", model: "any/vision" });
  assert.deepEqual(readings, [{ text: 'read 1 image/png 64B under "Transcribe."' }, { text: 'read 1 image/png 128B under "Transcribe."' }]);
  assert.equal(run.status, "completed");
  assert.equal(run.agent, "read-images");
  assert.equal(run.model, "fake/read-images");
  assert.deepEqual(run.output, readings);
  const rows = runtime.store.usageOf(run.id);
  assert.equal(rows.length, 2, "one usage row per image");
  for (const row of rows) { assert.equal(row.actor, "ana"); assert.equal(row.thread, run.thread); assert.equal(row.run, run.id); assert.equal(row.agent, "read-images"); assert.equal(row.model, "fake/read-images"); }
  assert.deepEqual(host.usage.filter(u => u.run === run.id).length, 2, "the host was handed both rows");
  assert.equal(runtime.run(actor, run.id).status, "completed", "the actor reads the run like any other");
});

test("AGENT-15: the run records the images' media type, size and hash, never their bytes", async () => {
  const store = path.join(tempDir(), "agent.sqlite");
  const { runtime } = await boot({ script: reader, store });
  const marker = "IMAGE-BYTES-MARKER-0123456789";
  const { run } = await runtime.readImages({ id: "ana" }, { images: [{ data: new TextEncoder().encode(marker), mimeType: "image/jpeg" }], instruction: "Transcribe.", model: "x/y" });
  const recorded = (run.input as { images: { mimeType: string; bytes: number; sha256: string }[] }).images;
  assert.equal(recorded[0]!.mimeType, "image/jpeg");
  assert.equal(recorded[0]!.bytes, marker.length);
  assert.match(recorded[0]!.sha256, /^[0-9a-f]{64}$/);
  await runtime.stop();
  for (const file of [store]) {
    const raw = readFileSync(file, "latin1");
    assert.doesNotMatch(raw, new RegExp(marker), "the raw bytes are not stored");
    assert.doesNotMatch(raw, new RegExp(Buffer.from(marker).toString("base64")), "nor their base64");
  }
});

test("AGENT-15: a malformed request is refused before anything is recorded or any model call", async t => {
  let calls = 0;
  const { runtime } = await boot({ script: () => { calls++; return { text: "x" }; } });
  t.after(() => runtime.stop());
  const actor = { id: "ana" };
  await assert.rejects(runtime.readImages(actor, { images: [], instruction: "T", model: "m/x" }), /at least one image/);
  await assert.rejects(runtime.readImages(actor, { images: [{ data: new Uint8Array(4), mimeType: "application/pdf" }], instruction: "T", model: "m/x" }), /media type/);
  await assert.rejects(runtime.readImages(actor, { images: [png(1)], instruction: " ", model: "m/x" }), /instruction/);
  assert.equal(calls, 0);
});

test("AGENT-15: a model without image input is refused before any call (openrouter catalog)", async t => {
  const { runtime } = await boot({ model: { kind: "openrouter", apiKey: "sk-test" } });
  t.after(() => runtime.stop());
  await assert.rejects(runtime.readImages({ id: "ana" }, { images: [png(1)], instruction: "T", model: "openrouter/not-a-model" }), /unknown model/);
  const textOnly = "openrouter/deepseek/deepseek-chat";
  await assert.rejects(runtime.readImages({ id: "ana" }, { images: [png(1)], instruction: "T", model: textOnly }), /does not accept images/);
});

test("AGENT-15: the host decides whether the actor may read images", async t => {
  const { runtime } = await boot({ script: reader, host: makeHost({ async mayRequest(_actor, request) { return request.agent !== "read-images"; } }) });
  t.after(() => runtime.stop());
  await assert.rejects(runtime.readImages({ id: "ana" }, { images: [png(1)], instruction: "T", model: "m/x" }), /does not allow/);
});

test("AGENT-15: a host that refuses the usage fails the run; a failed image is named in its reading", async t => {
  const script: Script = () => { throw new Error("provider down"); };
  const { runtime } = await boot({ script });
  t.after(() => runtime.stop());
  const failed = await runtime.readImages({ id: "ana" }, { images: [png(1)], instruction: "T", model: "m/x" });
  assert.equal(failed.run.status, "failed");
  assert.ok("error" in failed.readings[0]!);

  const { runtime: refusing } = await boot({ script: reader, host: makeHost({ async onUsage() { throw new Error("budget exhausted"); } }) });
  t.after(() => refusing.stop());
  const refused = await refusing.readImages({ id: "ana" }, { images: [png(1)], instruction: "T", model: "m/x" });
  assert.equal(refused.run.status, "failed");
  assert.match(refused.run.error ?? "", /budget exhausted/);
  assert.equal(refusing.store.usageOf(refused.run.id).length, 1, "the refused call is still metered");
});

test("AGENT-15: an aborted signal ends the run cancelled without a model call", async t => {
  let calls = 0;
  const { runtime } = await boot({ script: () => { calls++; return { text: "x" }; } });
  t.after(() => runtime.stop());
  const { run, readings } = await runtime.readImages({ id: "ana" }, { images: [png(1)], instruction: "T", model: "m/x", signal: AbortSignal.abort() });
  assert.equal(run.status, "cancelled");
  assert.ok("error" in readings[0]!);
  assert.equal(calls, 0);
});

test("AGENT-15: cancelling a reading run stops it: it ends cancelled, once", async t => {
  const { runtime } = await boot({ script: async () => { await new Promise(resolve => setTimeout(resolve, 150)); return { text: "late" }; } });
  t.after(() => runtime.stop());
  const actor = { id: "ana" };
  const thread = runtime.createThread(actor);
  const pending = runtime.readImages(actor, { images: [png(1)], instruction: "T", model: "m/x", thread: thread.id });
  await new Promise(resolve => setTimeout(resolve, 30));
  const started = runtime.events(actor, { thread: thread.id }).replay.find(event => event.kind === "run") as { run: { id: string } } | undefined;
  assert.ok(started, "the run is recorded on the given thread before the model answers");
  await runtime.cancel(actor, started.run.id);
  const { run, readings } = await pending;
  assert.equal(run.id, started.run.id);
  assert.equal(run.status, "cancelled");
  assert.ok("error" in readings[0]!);
  await assert.rejects(runtime.cancel(actor, run.id), /already ended/);
});
