// `boring` as a remote control for an isolated, running hub: bring one up for this checkout (derived ports and data,
// its own headless browser), seed it into a known state, then act on it and inspect it the way a person would —
// send in the chat, wait for things to settle, click and type in the page, read the receipts and a run's
// conversations. Agents compose these per change, guided by the feature map; there are no canned test scripts here.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { root } from "./formal.mjs";

const stateDir = path.join(root, ".cache/env");
const stateFile = path.join(stateDir, "env.json");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };

/** Ports derived from the checkout path: two checkouts never fight over a port, and a restart finds its own again. */
export function derivedPorts() {
  const n = parseInt(createHash("sha1").update(root).digest("hex").slice(0, 6), 16);
  const hub = 20000 + (n % 20000) * 2;
  return { hub, cdp: hub + 1 };
}
export function readEnv() { return existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : null; }
export function requireEnv() {
  const env = readEnv();
  if (!env || !alive(env.pid)) throw new Error("no running environment for this checkout; run `boring env up`");
  return env;
}

async function http(env, method, route, body) {
  const res = await fetch(`${env.url}${route}`, { method, headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

// ---------- environment ----------

export async function envUp(opts) {
  const existing = readEnv();
  if (existing && alive(existing.pid)) {
    if (!opts.restart) throw new Error(`an environment is already running at ${existing.url} (pid ${existing.pid}); use --restart or \`boring env down\``);
    await envDown({});
  }
  mkdirSync(stateDir, { recursive: true });
  const ports = derivedPorts();
  const hostname = opts.host ?? "127.0.0.1";
  const dataDir = path.join(stateDir, "data");
  if (opts.fresh !== false) rmSync(dataDir, { recursive: true, force: true });
  const appDir = path.resolve(opts.app ?? path.join(root, "test/fixtures/apps/notes"));
  const bundle = opts["chat-bundle"] ?? process.env.BORING_CHAT_BUNDLE;
  const args = ["--no-warnings", "--import=tsx", path.join(root, "packages/agent/src/host/run.ts"), "--app", appDir, "--data", dataDir, "--host", hostname, "--port", String(opts.port ?? ports.hub),
    "--person", opts.person ?? "person", "--model", opts.model ?? "scripted",
    ...(opts["think-ms"] ? ["--think-ms", String(opts["think-ms"])] : []), ...(bundle ? ["--chat-bundle", path.resolve(bundle)] : [])];
  const logFile = path.join(stateDir, "host.log");
  const out = openSync(logFile, "w");
  const child = spawn(process.execPath, args, { cwd: root, detached: true, stdio: ["ignore", out, out] });
  child.unref(); closeSync(out);
  let url = null, model = null;
  for (let i = 0; i < 240 && !url; i++) {
    await sleep(250);
    const log = readFileSync(logFile, "utf8");
    const m = log.match(/^hub (\S+) model (\S+)$/m);
    if (m) { url = m[1]; model = m[2]; }
    else if (!alive(child.pid)) throw new Error(`the hub exited while starting:\n${log}`);
  }
  if (!url) throw new Error(`the hub did not start in 60 s; see ${path.relative(root, logFile)}`);
  const env = { pid: child.pid, url, model, person: opts.person ?? "person", hostname, ports, dataDir, appDir, logFile, thinkMs: opts["think-ms"] ? Number(opts["think-ms"]) : null, chatBundle: bundle ? path.resolve(bundle) : null, startedAt: new Date().toISOString(), seed: opts.seed ?? null, seeded: {} };
  if (opts.browser !== false) {
    const chrome = chromePath(opts.chrome);
    if (!chrome) env.browser = { error: "no chromium found (set CHROME); page controls unavailable" };
    else {
      const profile = path.join(stateDir, "chrome");
      rmSync(profile, { recursive: true, force: true });
      const clog = openSync(path.join(stateDir, "chrome.log"), "w");
      const browser = spawn(chrome, ["--headless=new", `--remote-debugging-port=${ports.cdp}`, `--user-data-dir=${profile}`, "--no-sandbox", "--no-first-run", "--window-size=1440,900", url], { detached: true, stdio: ["ignore", clog, clog] });
      browser.unref(); closeSync(clog);
      env.browser = { pid: browser.pid, cdp: `http://127.0.0.1:${ports.cdp}` };
      for (let i = 0; i < 40; i++) { await sleep(250); try { if ((await fetch(`${env.browser.cdp}/json/version`)).ok) break; } catch { /* starting */ } }
    }
  }
  writeFileSync(stateFile, JSON.stringify(env, null, 2));
  if (opts.seed) { env.seeded = await seed(env, opts.seed); writeFileSync(stateFile, JSON.stringify(env, null, 2)); }
  return env;
}

export async function envDown(opts) {
  const env = readEnv();
  if (!env) return { stopped: false };
  for (const pid of [env.browser?.pid, env.pid]) if (alive(pid)) { try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } } }
  for (let i = 0; i < 40 && (alive(env.pid) || alive(env.browser?.pid)); i++) await sleep(100);
  rmSync(stateFile, { force: true });
  if (opts.clean) rmSync(stateDir, { recursive: true, force: true });
  return { stopped: true, url: env.url };
}

export async function envInfo() {
  const env = readEnv();
  if (!env) return { running: false };
  const host = alive(env.pid) ? await http(env, "GET", "/api/host").catch(() => null) : null;
  return { running: alive(env.pid), answering: host?.status === 200 && host.body.pid === env.pid, browser: env.browser?.pid ? alive(env.browser.pid) : false, ...env };
}

export function seedsFor(appDir) {
  const file = `${appDir.replace(/\/$/, "")}.seeds.json`;
  return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
}

/** Run a named seed: app tool calls as the person, selection, chat messages. `$name.path` reads earlier results. */
export async function seed(env, name, saved = {}) {
  const seeds = seedsFor(env.appDir);
  if (!seeds[name]) throw new Error(`unknown seed ${name}; known: ${Object.keys(seeds).join(", ") || "none"}`);
  const resolve = value => typeof value === "string" && value.startsWith("$") ? value.slice(1).split(".").reduce((v, k) => v?.[k], saved) : Array.isArray(value) ? value.map(resolve) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, resolve(v)])) : value;
  for (const step of seeds[name]) {
    if (step.seed) await seed(env, step.seed, saved);
    else if (step.tool) {
      const res = await tool(env, step.tool, resolve(step.input ?? {}));
      if (res.status !== 200) throw new Error(`seed ${name}: ${step.tool} answered ${res.status} ${JSON.stringify(res.body)}`);
      if (step.save) saved[step.save] = res.body;
    } else if (step.select) await select(env, resolve(step.select));
    else if (step.send) { await send(env, step.send); if (step.wait) await waitSettle(env, {}); }
  }
  return saved;
}

// ---------- app and chat ----------

export const tool = (env, name, input) => http(env, "POST", `/app/api/tools/${name}`, input ?? {});
export const select = (env, id) => http(env, "POST", "/api/select", { id });
export async function state(env) { return (await http(env, "GET", "/api/state?after=0")).body; }

export async function send(env, text) {
  const res = await http(env, "POST", `/agents/assistant/${env.person}`, { kind: "user", body: text });
  if (res.status !== 202) throw new Error(`the chat refused the message: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
export async function conversation(env) {
  const res = await http(env, "GET", `/agents/assistant/${env.person}`);
  return res.status === 404 ? { messages: [], settlements: [] } : res.body;
}

/** Wait until the chat has settled every turn, no request is running, and the app database has stopped moving. */
export async function waitSettle(env, opts) {
  const deadline = Date.now() + Number(opts.timeout ?? 300) * 1000;
  let lastRevision = null, stableSince = 0;
  for (;;) {
    const [conv, s] = await Promise.all([conversation(env), state(env)]);
    const submitted = new Set(conv.messages.filter(m => m.role === "user" && m.submissionId).map(m => m.submissionId));
    const settled = new Set((conv.settlements ?? []).map(x => x.submissionId));
    const openTurns = [...submitted].filter(id => !settled.has(id));
    const quiet = !openTurns.length && !s.running.length;
    if (s.database !== lastRevision) { lastRevision = s.database; stableSince = Date.now(); }
    if (quiet && Date.now() - stableSince >= 800) return summarizeTurn(conv, s);
    if (Date.now() > deadline) throw new Error(`not settled after ${opts.timeout ?? 300} s: ${openTurns.length} open chat turn(s), running ${s.running.join(", ") || "none"}`);
    await sleep(300);
  }
}
function summarizeTurn(conv, s) {
  const lastUser = [...conv.messages].reverse().find(m => m.role === "user");
  const turn = lastUser ? conv.messages.filter(m => m.submissionId === lastUser.submissionId && m.role === "assistant") : [];
  const parts = turn.flatMap(m => m.parts);
  const outcome = lastUser ? conv.settlements.find(x => x.submissionId === lastUser.submissionId)?.outcome : null;
  return {
    turn: lastUser ? { said: lastUser.parts.map(p => p.text ?? "").join(""), outcome } : null,
    reply: parts.filter(p => p.type === "text").map(p => p.text).join(" ").trim(),
    tools: parts.filter(p => p.type === "dynamic-tool").map(p => ({ tool: p.toolName, input: p.input, state: p.state, output: p.output ?? p.errorText })),
    database: s.database, selected: s.selected
  };
}

export async function effectLog(env, opts) {
  const s = (await http(env, "GET", `/api/state?after=${opts.since ?? 0}`)).body;
  return s.events.filter(e => !(e.type === "job" && e.job.kind === "pane")).filter(e => !opts.job || (e.job?.id ?? e.context?.jobId ?? "").startsWith(opts.job)).map(e =>
    e.type === "job" ? `#${e.cursor} job ${e.job.id} [${e.job.kind}] ${e.job.actor} → ${e.job.status}${e.job.error ? `: ${e.job.error}` : ""}`
      : `#${e.cursor} ${e.ref.kind === "database" ? "app db" : `file ${e.ref.path}`} → rev ${e.ref.revision} (${e.operation} by ${e.context?.actorId} in ${e.context?.jobId})`);
}
export async function trace(env, jobId) {
  const res = await http(env, "GET", `/api/trace/${encodeURIComponent(jobId)}`);
  if (res.status !== 200) throw new Error(`${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

// ---------- the live page (the environment's own headless browser, over CDP) ----------

async function pageOf(env) {
  if (!env.browser?.pid || !alive(env.browser.pid)) throw new Error(env.browser?.error ?? "this environment has no browser; `boring env up` starts one unless --no-browser");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(env.browser.cdp);
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().startsWith(env.url)) ?? context.pages()[0];
  if (!page) page = await context.newPage();
  if (!page.url().startsWith(env.url)) await page.goto(env.url, { waitUntil: "load" });
  return { browser, page };
}
/** `app:<selector>` targets the app pane (an iframe); anything else targets the hub page. */
function locate(page, selector) {
  return selector.startsWith("app:") ? page.frameLocator("#app").locator(selector.slice(4)) : page.locator(selector);
}
export async function withPage(env, fn) {
  const { browser, page } = await pageOf(env);
  try { return await fn(page); } finally { await browser.close(); }
}
export const screenshot = (env, file) => withPage(env, async page => { const out = path.resolve(file ?? path.join(stateDir, `shot-${Date.now()}.png`)); await page.screenshot({ path: out }); return out; });
export const snapshot = (env, selector) => withPage(env, async page => locate(page, selector ?? "body").ariaSnapshot());
export const click = (env, selector) => withPage(env, async page => { await locate(page, selector).first().click(); return "clicked"; });
export const type = (env, selector, text) => withPage(env, async page => { await locate(page, selector).first().fill(text); return "typed"; });
export const press = (env, keys, selector) => withPage(env, async page => { if (selector) await locate(page, selector).first().press(keys); else await page.keyboard.press(keys); return "pressed"; });
export const evaluate = (env, js) => withPage(env, async page => page.evaluate(js));
export const reload = env => withPage(env, async page => { await page.reload({ waitUntil: "load" }); return page.url(); });

// ---------- doctor: is the running instance the one this checkout should be driving? ----------

function newestSource() {
  let newest = 0, file = null;
  const walk = dir => { if (!existsSync(dir)) return; for (const entry of readdirSync(dir, { withFileTypes: true })) { const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (/\.(ts|mjs|js|json|html|md|sql)$/.test(entry.name)) { const t = statSync(full).mtimeMs; if (t > newest) { newest = t; file = full; } } } };
  for (const dir of ["packages", "examples"]) walk(path.join(root, dir));
  return { newest, file };
}
export async function instanceRows() {
  const rows = [];
  const add = (name, ok, detail, fix) => rows.push({ name, ok: !!ok, detail, unlocks: fix });
  const env = readEnv();
  if (!env) { add("environment", false, "none for this checkout", "boring env up"); return rows; }
  add("environment", alive(env.pid), `${env.url} pid ${env.pid} model ${env.model}${env.seed ? ` seed ${env.seed}` : ""}`, "boring env up --restart");
  const host = alive(env.pid) ? await http(env, "GET", "/api/host").catch(() => null) : null;
  add("port owner", host?.body?.pid === env.pid, host ? `answering pid ${host.body.pid}` : "not answering", "another process holds the port, or the hub crashed: see .cache/env/host.log");
  const { newest, file } = newestSource();
  const fresh = newest <= Date.parse(env.startedAt);
  add("build freshness", fresh, fresh ? "no source changed since start" : `STALE: ${path.relative(root, file)} changed after the hub started`, "boring env up --restart");
  const browser = env.browser?.pid && alive(env.browser.pid);
  add("browser", browser, browser ? `${env.browser.cdp} pid ${env.browser.pid}` : env.browser?.error ?? "not running", "boring env up --restart (needs chromium)");
  return rows;
}

export function chromePath(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const cache = path.join(process.env.HOME ?? "", ".cache/ms-playwright");
  if (existsSync(cache)) for (const dir of readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort().reverse())
    for (const bin of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) if (existsSync(path.join(cache, dir, bin))) return path.join(cache, dir, bin);
  for (const bin of ["chromium", "chromium-browser", "google-chrome"]) { const r = spawnSync("which", [bin], { encoding: "utf8" }); if (r.status === 0) return r.stdout.trim(); }
  return null;
}
