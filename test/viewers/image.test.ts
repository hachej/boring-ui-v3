import test from "node:test";
import assert from "node:assert/strict";
import { memoryProvider, memoryReceipts } from "@boring/files/web";
import { createImage, pageCommands } from "@boring/viewers";

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="100"><rect width="200" height="100" fill="teal"/></svg>';
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("VIEWERS-3: zoom, pan, fit and annotate are local; describe returns metadata, never pixels", async () => {
  const receipts = memoryReceipts();
  const files = memoryProvider({ seed: { "diagram.svg": SVG }, receipts });
  const image = createImage({ files, address: "/workspace/diagram.svg", highlightFor: 30 });
  await image.load();
  const s = image.store.get();
  assert.equal(s.status, "ready");
  assert.ok(s.src!.startsWith("data:image/svg+xml"));
  image.actions.measured(200, 100, 2);
  assert.equal(image.store.get().zoom, 2, "while fitting, the renderer's zoom is kept");
  assert.deepEqual((await image.actions.zoom(4)).outcome, "applied");
  assert.equal(image.store.get().fit, false);
  assert.equal((await image.actions.zoomBy(0.5)).detail && image.store.get().zoom, 2);
  assert.equal((await image.actions.panBy(10, -5)).outcome, "applied");
  assert.deepEqual(image.store.get().pan, { x: 10, y: -5 });
  const [pan] = image.tools.filter(t => t.name === "pan");
  const centred = await pan!.run({ x: 150, y: 50 });
  assert.deepEqual((centred.detail as { pan: unknown }).pan, { x: -100, y: 0 });
  assert.equal((await image.actions.fit()).outcome, "applied");
  assert.equal((await image.actions.annotate({ x: 10, y: 10, width: 50, height: 20, label: "here" })).outcome, "applied");
  assert.equal(image.store.get().annotations.length, 1);
  assert.equal((await image.actions.annotate({ x: 190, y: 10, width: 50, height: 20 })).outcome, "denied", "a highlight cannot leave the image");
  await new Promise(r => setTimeout(r, 50));
  assert.equal(image.store.get().annotations.length, 0, "a highlight is temporary");
  const describe = pageCommands(image.tools, "image").find(c => c.name === "image_describe")!;
  const described = await describe.handler({}, { request: {} as never });
  assert.equal(described.outcome, "applied");
  assert.deepEqual(Object.keys(described.detail as object).sort(), ["annotations", "fit", "height", "mime", "pan", "path", "revision", "status", "width", "zoom"]);
  assert.ok(!JSON.stringify(described).includes("svg xmlns"), "no content leaves through describe");
  assert.equal(receipts.entries.length, 0, "the viewer never writes");
  image.dispose();
});

test("images: a data URL raster shows as is; other binary content needs the host's source", async () => {
  const files = memoryProvider({ seed: { "dot.png": PNG, "raw.jpg": "ÿØÿ binary" } });
  const dot = createImage({ files, address: "/workspace/dot.png" });
  await dot.load();
  assert.equal(dot.store.get().src, PNG);
  assert.equal(dot.store.get().mime, "image/png");
  const raw = createImage({ files, address: "/workspace/raw.jpg" });
  await raw.load();
  assert.equal(raw.store.get().status, "error");
  const served = createImage({ files, address: "/workspace/raw.jpg", source: (address, revision) => `/raw${address}?rev=${revision}` });
  await served.load();
  assert.match(served.store.get().src!, /^\/raw\/workspace\/raw\.jpg\?rev=/);
  const missing = createImage({ files, address: "/workspace/none.webp" });
  await missing.load();
  assert.equal(missing.store.get().status, "error");
});
