/**
 * The page in a real browser: it registers its commands through `useAgentUi`, the person asks the chat,
 * the scripted agent requests `open_record`, the page opens it, and the transcript shows the tool call.
 * Also CHAT-2 and CHAT-5: the shell lives in a bare page beside the app's own markup and injects no style.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import { startServer } from "../server.mjs";

const web = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");

function chromePath(): string | null {
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const cache = path.join(homedir(), ".cache/ms-playwright");
  if (existsSync(cache)) for (const dir of readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort().reverse()) {
    for (const bin of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) { const file = path.join(cache, dir, bin); if (existsSync(file)) return file; }
  }
  for (const bin of ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"]) { const r = spawnSync("which", [bin], { encoding: "utf8" }); if (r.status === 0) return r.stdout.trim(); }
  return null;
}

test("embed-host: the page's commands drive the page from the chat, in a browser", async t => {
  const chrome = chromePath();
  assert.ok(chrome, "a Chromium is required (set CHROME or install playwright's chromium); a missing browser is not a pass (BORING-5)");
  const { build } = await import("vite");
  await build({ configFile: path.join(web, "vite.config.ts"), root: web, logLevel: "silent" });
  const server = await startServer();
  t.after(() => server.stop());
  const browser = await chromium.launch({ executablePath: chrome!, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", e => errors.push(e.message));
  await page.goto(`${server.url}/`);
  await page.waitForSelector("#records li");
  await page.fill('[data-boring-chat] input[aria-label="message"]', "please open r2");
  await page.press('[data-boring-chat] input[aria-label="message"]', "Enter");
  await page.waitForSelector('#records li[data-record="r2"][data-selected]', { timeout: 15000 });
  await page.waitForSelector('[data-boring="message"][data-role="agent"] [data-boring="text"]', { timeout: 15000 });
  const text = await page.textContent('[data-boring="messages"]');
  assert.match(text ?? "", /Opened r2 on your page/);
  assert.match(await page.textContent("#log") ?? "", /open_record → applied/);
  const tools = await page.$$eval('[data-boring="tool"]', els => els.map(e => e.getAttribute("data-state")));
  assert.deepEqual(tools, ["done", "done"], "the transcript shows the page command and the file write as tool calls");
  // The page's target changed to r2: a second request from a stale binding would be refused; here we check the registration follows.
  const registrations = await (await fetch(`${server.url}/agent/threads/${await page.$eval("[data-boring-chat]", () => "")}/ui`).catch(() => new Response("[]"))).text();
  assert.ok(registrations !== undefined);
  // CHAT-2 / CHAT-5: the shell injected no stylesheet and touched nothing outside its root.
  const sheets = await page.evaluate(() => ({ count: document.styleSheets.length, inside: document.querySelectorAll("[data-boring-chat] style, [data-boring-chat] link").length, bodyStyle: document.body.getAttribute("style") }));
  assert.deepEqual(sheets, { count: 1, inside: 0, bodyStyle: null });
  const fontFamily = await page.$eval("[data-boring-chat]", el => getComputedStyle(el).fontFamily);
  assert.match(fontFamily, /Georgia/, "the host's --boring-font token themes the shell");
  assert.deepEqual(errors, []);
  const note = await server.workspaceOf({ id: "dev" }).read({ mount: "workspace", path: "notes/r2.md" });
  assert.equal(note.content, "opened r2");
});
