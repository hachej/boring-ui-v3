/**
 * The registry host in a real browser: the items installed with `shadcn add`, driven by the person and by the
 * scripted assistant through the viewers' tools. The agent proposes a patch, the person accepts it (a receipt);
 * a stale save shows the conflict banner; the tree shows a file the agent wrote; the image viewer zooms and
 * highlights; /code is read-only. Screenshots of each item in light and dark land in .cache/evidence/registry/.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright-core";
import { startServer } from "../../examples/registry-host/server.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const hostDir = path.resolve(here, "../../examples/registry-host");
const shots = path.resolve(here, "../../.cache/evidence/registry");
const at = (p: string) => ({ mount: "workspace", path: p });

function chromePath(): string | null {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const cache = path.join(homedir(), ".cache/ms-playwright");
  if (existsSync(cache)) for (const dir of readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort().reverse()) {
    for (const bin of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) { const file = path.join(cache, dir, bin); if (existsSync(file)) return file; }
  }
  for (const bin of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) { const r = spawnSync("which", [bin], { encoding: "utf8" }); if (r.status === 0) return r.stdout.trim(); }
  return null;
}

async function say(page: Page, text: string) {
  const before = await page.locator("[data-boring=message][data-role=agent]").count();
  const people = await page.locator("[data-boring=message][data-role=person]").count();
  await page.fill("[data-boring=composer] textarea", text);
  await page.click("[data-boring=composer] button[type=submit]");
  try { await page.locator("[data-boring=message][data-role=person]").nth(people).waitFor({ timeout: 10000 }); }
  catch (error) { await page.screenshot({ path: path.join(shots, `failed-send-${text.replace(/\W+/g, "-")}.png`) }); throw new Error(`"${text}" never reached the transcript (composer: "${await page.inputValue("[data-boring=composer] textarea")}"): ${(error as Error).message}`); }
  try { await page.locator("[data-boring=message][data-role=agent]").nth(before).waitFor({ timeout: 20000 }); }
  catch (error) { await page.screenshot({ path: path.join(shots, `failed-${text.replace(/\W+/g, "-")}.png`) }); throw error; }
}
const shot = (page: Page, selector: string, name: string) => page.locator(selector).first().screenshot({ path: path.join(shots, `${name}.png`) });

test("registry-host: the installed items work for the person and the agent, in light and dark", async t => {
  const chrome = chromePath();
  assert.ok(chrome, "a Chromium is required (set CHROME or install playwright's chromium); a missing browser is not a pass (BORING-5)");
  mkdirSync(shots, { recursive: true });
  const { build } = await import("vite");
  await build({ configFile: path.join(hostDir, "vite.config.ts"), root: hostDir, logLevel: "silent" });
  const server = await startServer();
  t.after(() => server.stop());
  const workspace = server.workspaceOf({ id: "dev" });
  const browser = await chromium.launch({ executablePath: chrome!, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1400, height: 860 } });
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));

  await page.goto(`${server.url}/`);
  await page.locator("[data-boring=workspace]").waitFor();
  await page.waitForFunction(() => location.hash.includes("thread="));
  const thread = new URL(page.url()).hash.split("thread=")[1]!;
  await page.waitForTimeout(500); // the viewers register their tools once the chat has its thread

  await t.test("the agent opens a markdown file in the dockview workspace through workspace_open_panel", async () => {
    await say(page, "show /workspace/notes/plan.md");
    await page.locator("[data-boring=panel][data-panel='markdown:/workspace/notes/plan.md'] .boring-prose h2").first().waitFor();
    assert.match(await page.locator("[data-boring=tool][data-outcome=applied]").last().innerText(), /workspace_open_panel/);
    await page.waitForTimeout(1200); // autosave of the layout
    const layout = JSON.parse((await workspace.read(at(".boring/layout.json"))).content);
    assert.deepEqual(layout.panels.map((p: { id: string }) => p.id), ["markdown:/workspace/notes/plan.md"], "the layout is the person's file");
  });
  await shot(page, "[data-boring=file-tree]", "file-tree-light");
  await shot(page, "[data-boring=markdown-editor]", "markdown-editor-light");

  await t.test("the agent proposes a patch through the editor's tools; the person accepts; the save carries a receipt", async () => {
    const before = (await workspace.read(at("notes/plan.md"))).ref.revision;
    await say(page, "name a risk in my plan");
    await page.locator("[data-boring=proposal]").waitFor();
    assert.equal((await workspace.read(at("notes/plan.md"))).ref.revision, before, "a proposal saves nothing");
    assert.match(await page.locator("[data-boring=tool][data-outcome=proposed]").first().innerText(), /markdown_propose_patch/);
    await shot(page, "[data-boring=markdown-editor]", "markdown-editor-proposal-light");
    await page.click("[data-boring=proposal] button:has-text('Accept')");
    await page.locator("[data-boring=proposal]").waitFor({ state: "detached" });
    const after = await workspace.read(at("notes/plan.md"));
    assert.notEqual(after.ref.revision, before);
    assert.match(after.content, /A stale save overwriting newer work/);
    const receipt = server.receipts.entries.at(-1)!;
    assert.deepEqual([receipt.address.path, receipt.before, receipt.after, receipt.effect.actor], ["notes/plan.md", before, after.ref.revision, "dev"]);
    await page.locator(`[data-boring=save-state]:has-text("r${after.ref.revision}")`).waitFor();
  });

  await t.test("a stale save shows the conflict banner and keeps both versions until the person chooses", async () => {
    await page.click(".boring-prose p >> nth=0");
    await page.keyboard.press("End");
    await page.keyboard.type(" Mine.");
    await page.locator("[data-boring=markdown-editor][data-dirty]").waitFor();
    const current = (await workspace.stat(at("notes/plan.md")))!.revision;
    await workspace.write(at("notes/plan.md"), "# Launch plan\n\nChanged elsewhere.\n", { expectedRevision: current }, { actor: "someone-else" });
    await page.click("[data-boring=markdown-editor] button:has-text('Save')");
    await page.locator("[data-boring=conflict]").waitFor();
    assert.equal((await workspace.read(at("notes/plan.md"))).content, "# Launch plan\n\nChanged elsewhere.\n", "the newer content is kept");
    await shot(page, "[data-boring=markdown-editor]", "conflict-banner-light");
    await page.click("[data-boring=conflict] button:has-text('Overwrite with mine')");
    await page.locator("[data-boring=conflict]").waitFor({ state: "detached" });
    assert.match((await workspace.read(at("notes/plan.md"))).content, /Mine\./);
  });

  await t.test("the tree shows a file the agent wrote through its file tools", async () => {
    await say(page, "write a note");
    const notes = page.locator("[data-path='/workspace/notes']");
    if (!(await page.locator("[data-path='/workspace/notes/plan.md']").count())) await notes.click();
    await page.locator("[data-path='/workspace/notes/agent-note.md']").waitFor({ timeout: 10000 });
  });

  await t.test("the agent opens an image through the tree and zooms and highlights it; describe returns metadata", async () => {
    await say(page, "open /workspace/images/diagram.svg");
    await page.locator("[data-boring=image-viewer] img").waitFor();
    await say(page, "zoom the image");
    await page.locator("[data-boring=annotation]").waitFor();
    assert.equal(await page.locator("[data-boring=zoom]").innerText(), "200%");
    await shot(page, "[data-boring=image-viewer]", "image-viewer-light");
    await shot(page, "aside:has([data-boring=composer])", "chat-light");
  });

  await t.test("the agent draws on the canvas through its tools; the .tldraw file holds the shapes at the receipt's revision", async () => {
    await page.click("[data-path='/workspace/boards']");
    await page.click("[data-path='/workspace/boards/plan.tldraw']");
    await page.locator("[data-boring=canvas] .tl-container").waitFor();
    await say(page, "draw the plan");
    await page.locator("[data-boring=tool][data-outcome=committed]:has-text('canvas_create_shapes')").waitFor();
    const file = await workspace.read(at("boards/plan.tldraw"));
    const document = JSON.parse(file.content).document as { store: Record<string, { typeName: string }> };
    assert.equal(Object.values(document.store).filter(r => r.typeName === "shape").length, 2);
    assert.equal(server.receipts.entries.at(-1)!.after, file.ref.revision);
    await page.locator("[data-boring=canvas] :text('saved · r')").first().waitFor();
    await shot(page, "[data-boring=canvas]", "canvas-light");
  });

  await t.test("the workspace lists its panels for the agent and restores them after a reload", async () => {
    await say(page, "panels");
    assert.match(await page.locator("[data-boring=message][data-role=agent]").last().innerText(), /plan\.md.*diagram\.svg.*plan\.tldraw/);
    await shot(page, "[data-boring=workspace]", "workspace-light");
    await page.waitForTimeout(1200);
    await page.reload();
    await page.locator(".dv-tab").nth(2).waitFor();
    assert.deepEqual(await page.locator(".dv-tab").allInnerTexts(), ["plan.md", "diagram.svg", "plan.tldraw"]);
  });

  await t.test("/code opens read-only: no save, no write tools", async () => {
    await page.click("[data-path='/code/README.md']");
    await page.locator("[data-boring=markdown-editor] :text('read-only')").first().waitFor();
    await shot(page, "[data-boring=markdown-editor]", "markdown-editor-readonly-light");
    assert.equal(await page.locator("[data-boring=markdown-editor] button:has-text('Save')").count(), 0);
  });

  await t.test("dark theme: every item reads the host's tokens", async () => {
    const dark = await browser.newPage({ viewport: { width: 1400, height: 860 } });
    dark.on("pageerror", e => errors.push(e.message));
    await dark.goto(`${server.url}/?theme=dark&open=/workspace/notes/plan.md#thread=${thread}`);
    await dark.locator(".boring-prose h1").first().waitFor();
    await dark.locator("[data-boring=tool]").first().waitFor();
    assert.equal(await dark.evaluate(() => document.documentElement.classList.contains("dark")), true);
    const bg = await dark.evaluate(() => getComputedStyle(document.querySelector("[data-boring=markdown-editor]")!).backgroundColor);
    assert.notEqual(bg, "rgb(255, 255, 255)");
    await shot(dark, "[data-boring=file-tree]", "file-tree-dark");
    await shot(dark, "[data-boring=markdown-editor]", "markdown-editor-dark");
    await shot(dark, "aside:has([data-boring=composer])", "chat-dark");
    await dark.goto(`${server.url}/?theme=dark&open=/workspace/images/diagram.svg#thread=${thread}`);
    await dark.locator("[data-boring=image-viewer] img").waitFor();
    await shot(dark, "[data-boring=image-viewer]", "image-viewer-dark");
    await dark.goto(`${server.url}/?theme=dark&open=/workspace/boards/plan.tldraw#thread=${thread}`);
    await dark.locator("[data-boring=canvas] .tl-shape").first().waitFor();
    await shot(dark, "[data-boring=canvas]", "canvas-dark");
    await shot(dark, "[data-boring=workspace]", "workspace-dark");
    await dark.screenshot({ path: path.join(shots, "registry-host-dark.png") });
    await dark.close();
  });
  await page.screenshot({ path: path.join(shots, "registry-host-light.png") });
  assert.deepEqual(errors, [], "no page errors");
});
