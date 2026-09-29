// `boring` as a remote control for an isolated, running copy of the example app: bring one up for this checkout
// (derived ports, its own data dir, its own headless browser), seed it through the wire, then act on it and inspect
// it the way a person and a client would — say something, wait for it to settle, request a run or a job, read the
// records (runs, receipts, usage), drive the built chat page. Agents compose these per change, guided by the
// feature map; there are no canned test scripts here (the CI smoke in smoke.mjs is built from the same calls).
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
import { jarPath, root } from "./formal.mjs";

const require = createRequire(import.meta.url);
export const appDir = path.join(root, "examples/notes");
export const defaultStateDir = path.join(root, ".cache/env");
/** The notes the example page hands the conversation with every message (examples/notes/web/main.tsx). */
export const NOTES = ["Buy milk tomorrow.", "Call the dentist on Monday."];
export const CONVERSATION = "questions";
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const alive = pid => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };

/** Ports derived from the checkout path: two checkouts never fight over a port, and a restart finds its own again. */
export function derivedPorts(offset = 0) {
  const n = parseInt(createHash("sha1").update(root).digest("hex").slice(0, 6), 16);
  const app = 20000 + ((n + offset) % 20000) * 2;
  return { app, cdp: app + 1 };
}
const stateFileOf = stateDir => path.join(stateDir, "env.json");
export function readEnv(stateDir = defaultStateDir) { const file = stateFileOf(stateDir); return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : null; }
export function saveEnv(env) { writeFileSync(stateFileOf(env.stateDir), JSON.stringify(env, null, 2)); }
export function requireEnv(stateDir = defaultStateDir) {
  const env = readEnv(stateDir);
  if (!env || !alive(env.pid)) throw new Error("no running environment for this checkout; run `boring env up`");
  return env;
}

/** A call on the wire as the environment's actor (the app's dev auth reads `x-dev-actor`). */
export async function wire(env, method, route, body, { actor, headers = {} } = {}) {
  const init = { method, headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(actor ?? env.actor ? { "x-dev-actor": actor ?? env.actor } : {}), ...headers } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const res = await fetch(`${env.url}/agent${route}`, init);
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}
/** The NDJSON events of a thread or a run, replayed after `cursor`, without staying live. */
export async function replay(env, scope, cursor, options = {}) {
  const route = scope.run ? `/runs/${encodeURIComponent(scope.run)}/events` : `/threads/${encodeURIComponent(scope.thread)}/events`;
  const query = new URLSearchParams({ ...(cursor ? { cursor } : {}), ...(scope.run ? {} : { live: "0" }) });
  const res = await fetch(`${env.url}/agent${route}?${query}`, { headers: { "x-dev-actor": options.actor ?? env.actor } });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return (await res.text()).split("\n").filter(Boolean).map(line => JSON.parse(line));
}

// ---------- environment ----------

/** The chat page is built by Vite into examples/notes/web/dist; rebuilt when a chat or page source is newer. */
export function ensurePageBuilt({ force = false, log = () => {} } = {}) {
  const dist = path.join(appDir, "web/dist/index.html");
  const built = existsSync(dist) ? statSync(dist).mtimeMs : 0;
  const stale = !built || newestSource([path.join(root, "packages/chat/src"), path.join(appDir, "web")], /\.(tsx?|html|css)$/).newest > built;
  if (!force && !stale) return { built: false, dist };
  log("building the chat page (vite)…");
  const result = spawnSync(process.execPath, [path.join(path.dirname(require.resolve("vite/package.json")), "bin/vite.js"), "build", path.join(appDir, "web"), "--logLevel", "warn"], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`the page did not build:\n${result.stdout}${result.stderr}`);
  return { built: true, dist };
}

export async function envUp(opts = {}) {
  const stateDir = opts.stateDir ?? defaultStateDir;
  const existing = readEnv(stateDir);
  if (existing && alive(existing.pid)) {
    if (!opts.restart) throw new Error(`an environment is already running at ${existing.url} (pid ${existing.pid}); use --restart or \`boring env down\``);
    await envDown({ stateDir });
  }
  mkdirSync(stateDir, { recursive: true });
  const ports = opts.ports ?? derivedPorts();
  const hostname = "127.0.0.1";
  const dataDir = path.join(stateDir, "data");
  if (!opts["keep-data"]) rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const model = opts.model ?? "fake";
  const page = ensurePageBuilt({ log: opts.log ?? (() => {}) });
  const childEnv = { ...process.env, PORT: String(opts.port ?? ports.app), HOST: hostname, STORE: path.join(dataDir, "agent.sqlite"), BORING_MODEL: model };
  if (model === "fake") delete childEnv.OPENROUTER_API_KEY;
  const logFile = path.join(stateDir, "server.log");
  const out = openSync(logFile, "w");
  const child = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", path.join(appDir, "server.mjs")], { cwd: root, env: childEnv, detached: true, stdio: ["ignore", out, out] });
  child.unref(); closeSync(out);
  let url = null;
  for (let i = 0; i < 240 && !url; i++) {
    await sleep(250);
    const log = readFileSync(logFile, "utf8");
    const m = log.match(/^notes: (\S+)\/ pid (\d+) model (\S+)/m);
    if (m) url = m[1];
    else if (!alive(child.pid)) throw new Error(`the app exited while starting:\n${log}`);
  }
  if (!url) throw new Error(`the app did not start in 60 s; see ${path.relative(root, logFile)}`);
  const env = { pid: child.pid, url, model, actor: opts.actor ?? "dev", ports, stateDir, dataDir, store: childEnv.STORE, logFile, pageBuilt: page.built, startedAt: new Date().toISOString(), seed: opts.seed ?? null, seeded: null, thread: null };
  if (opts.browser !== false) {
    const chrome = chromePath(opts.chrome);
    if (!chrome) env.browser = { error: "no chromium found (npx playwright-core install chromium, or set CHROME); page controls unavailable" };
    else {
      const profile = path.join(stateDir, "chrome");
      rmSync(profile, { recursive: true, force: true });
      const clog = openSync(path.join(stateDir, "chrome.log"), "w");
      const browser = spawn(chrome, ["--headless=new", `--remote-debugging-port=${ports.cdp}`, `--user-data-dir=${profile}`, "--no-sandbox", "--no-first-run", "--window-size=1100,800", `${url}/`], { detached: true, stdio: ["ignore", clog, clog] });
      browser.unref(); closeSync(clog);
      env.browser = { pid: browser.pid, cdp: `http://127.0.0.1:${ports.cdp}` };
      for (let i = 0; i < 40; i++) { await sleep(250); try { if ((await fetch(`${env.browser.cdp}/json/version`)).ok) break; } catch { /* starting */ } }
    }
  }
  saveEnv(env);
  if (opts.seed) { env.seeded = await seed(env, opts.seed); saveEnv(env); }
  return env;
}

export async function envDown(opts = {}) {
  const stateDir = opts.stateDir ?? defaultStateDir;
  const env = readEnv(stateDir);
  if (!env) return { stopped: false };
  for (const pid of [env.browser?.pid, env.pid]) if (alive(pid)) { try { process.kill(-pid, "SIGTERM"); } catch { try { process.kill(pid, "SIGTERM"); } catch { /* gone */ } } }
  for (let i = 0; i < 50 && (alive(env.pid) || alive(env.browser?.pid)); i++) await sleep(100);
  for (const pid of [env.browser?.pid, env.pid]) if (alive(pid)) { try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch { /* gone */ } } }
  rmSync(stateFileOf(stateDir), { force: true });
  if (opts.clean) rmSync(stateDir, { recursive: true, force: true });
  return { stopped: true, url: env.url };
}

export async function envInfo(stateDir = defaultStateDir) {
  const env = readEnv(stateDir);
  if (!env) return { running: false };
  const answering = alive(env.pid) ? (await wire(env, "GET", "/.well-known/boring.json").catch(() => null))?.status === 200 : false;
  return { running: alive(env.pid), answering, ownsPort: alive(env.pid) && portOwnedBy(env.ports.app, env.pid), browser: env.browser?.pid ? alive(env.browser.pid) : false, ...env };
}

export function seeds() { const file = path.join(appDir, "seeds.json"); return existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {}; }

/** Run a named seed through the wire: conversation messages, agent runs, jobs; `wait` settles after a step. */
export async function seed(env, name) {
  const all = seeds();
  if (!all[name]) throw new Error(`unknown seed ${name}; known: ${Object.keys(all).join(", ") || "none"}`);
  const done = [];
  for (const step of all[name]) {
    let out;
    if (step.say !== undefined) out = await send(env, step.say, { new: step.new });
    else if (step.run) out = await startRun(env, step.run, step.inputs ?? {}, { key: step.key });
    else if (step.job) out = await startJob(env, step.job, step.inputs ?? {}, { key: step.key });
    else throw new Error(`seed ${name}: unknown step ${JSON.stringify(step)}`);
    if (step.wait) await waitSettle(env, {});
    done.push({ step, id: out.run?.id ?? out.id, thread: out.thread ?? out.run?.thread });
  }
  return done;
}

// ---------- the wire: say, request, inspect ----------

export const manifest = env => wire(env, "GET", "/.well-known/boring.json").then(r => r.body);

/** A message in the conversation; the environment remembers the thread so the next message continues it. */
export async function send(env, text, opts = {}) {
  const thread = opts.new ? undefined : opts.thread ?? env.thread ?? undefined;
  const res = await wire(env, "POST", `/conversations/${CONVERSATION}/messages`, { text, inputs: { notes: NOTES }, ...(thread ? { thread } : {}), ...(opts.key ? { idempotencyKey: opts.key } : {}) });
  if (res.status !== 202) throw new Error(`the conversation refused the message: ${res.status} ${JSON.stringify(res.body)}`);
  env.thread = res.body.thread; saveEnv(env);
  return res.body;
}
export async function startRun(env, agent, inputs, opts = {}) {
  const res = await wire(env, "POST", `/agents/${encodeURIComponent(agent)}/runs`, { inputs, ...(opts.message ? { message: opts.message } : {}), ...(opts.thread ? { thread: opts.thread } : {}), ...(opts.key ? { idempotencyKey: opts.key } : {}) });
  if (res.status !== 202) throw new Error(`${agent}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
export async function startJob(env, job, inputs, opts = {}) {
  const res = await wire(env, "POST", `/jobs/${encodeURIComponent(job)}/start`, { inputs, ...(opts.thread ? { thread: opts.thread } : {}), ...(opts.key ? { idempotencyKey: opts.key } : {}) });
  if (res.status !== 202) throw new Error(`${job}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}
export const cancel = (env, run) => wire(env, "POST", `/runs/${encodeURIComponent(run)}/cancel`, {});

/** The current thread as the person sees it: its events replayed from the wire. */
export async function chat(env, thread = env.thread) {
  if (!thread) return { thread: null, events: [] };
  return { thread, events: await replay(env, { thread }) };
}
export function renderEvents(events) {
  return events.map(e => e.kind === "message"
    ? `#${e.cursor} ${e.message.role}: ${e.message.parts.map(p => p.type === "text" ? p.text : `[${p.type}${p.name ? ` ${p.name}` : ""}]`).join(" ")}`
    : e.kind === "run" ? `#${e.cursor} run ${e.run.id.slice(0, 8)} ${e.run.agent} → ${e.run.status}${e.run.error ? `: ${e.run.error}` : ""}` : `#${e.cursor} ${e.kind}`).join("\n");
}

// ---------- the records (the instance's own SQLite, opened read-only) ----------

export function records(env) { return new DatabaseSync(env.store, { readOnly: true }); }
export function withRecords(env, fn) { const db = records(env); try { return fn(db); } finally { db.close(); } }
const parse = text => { try { return JSON.parse(text); } catch { return text; } };

export function runs(env, opts = {}) {
  return withRecords(env, db => db.prepare(`SELECT id, agent, actor, job, status, model, attempts, error, created_at, ended_at FROM runs ORDER BY created_at DESC, id LIMIT ?`).all(Number(opts.limit ?? (opts.all ? 10000 : 30))));
}
export function jobs(env) { return withRecords(env, db => db.prepare("SELECT id, definition, actor, status, error, created_at, ended_at FROM jobs ORDER BY created_at DESC").all()); }

/** running requests, threads, the last cursor, the model: what `wait-settle` watches. */
export function state(env) {
  return withRecords(env, db => ({
    url: env.url, pid: env.pid, model: env.model, actor: env.actor, thread: env.thread, seed: env.seed,
    runs: Object.fromEntries(db.prepare("SELECT status, COUNT(*) AS n FROM runs GROUP BY status").all().map(r => [r.status, Number(r.n)])),
    open: db.prepare("SELECT id, agent, status FROM runs WHERE status IN ('pending','running')").all(),
    jobs: Object.fromEntries(db.prepare("SELECT status, COUNT(*) AS n FROM jobs GROUP BY status").all().map(r => [r.status, Number(r.n)])),
    threads: Number(db.prepare("SELECT COUNT(*) AS n FROM threads").get().n),
    cursor: String(db.prepare("SELECT COALESCE(MAX(seq), 0) AS c FROM events").get().c),
    receipts: Number(db.prepare("SELECT COUNT(*) AS n FROM receipts").get().n),
    usage: Number(db.prepare("SELECT COUNT(*) AS n FROM usage").get().n),
  }));
}

/** Until no run or job is open and the records stopped moving (no new event, receipt or usage for a moment). */
export async function waitSettle(env, opts = {}) {
  const deadline = Date.now() + Number(opts.timeout ?? 120) * 1000;
  let last = null, stableSince = Date.now();
  for (;;) {
    const s = state(env);
    const mark = `${s.cursor}/${s.receipts}/${s.usage}`;
    if (mark !== last) { last = mark; stableSince = Date.now(); }
    const quiet = !s.open.length && !(s.jobs.running || s.jobs.pending);
    if (quiet && Date.now() - stableSince >= 800) return settledSummary(env, s);
    if (Date.now() > deadline) throw new Error(`not settled after ${opts.timeout ?? 120} s: open runs ${s.open.map(r => `${r.id.slice(0, 8)} ${r.agent} ${r.status}`).join(", ") || "none"}`);
    await sleep(250);
  }
}
async function settledSummary(env, s) {
  const latest = runs(env, { limit: 1 })[0] ?? null;
  const reply = env.thread ? [...(await replay(env, { thread: env.thread }))].reverse().find(e => e.kind === "message" && e.message.role === "agent")?.message.parts.map(p => p.text ?? "").join("") ?? null : null;
  return { settled: true, cursor: s.cursor, runs: s.runs, jobs: s.jobs, latest: latest && { id: latest.id, agent: latest.agent, status: latest.status, error: latest.error }, reply };
}

/** A run as the wire shows it plus its events (from the thread replay, so a live run is readable too). */
export async function run(env, id) {
  const view = await wire(env, "GET", `/runs/${encodeURIComponent(id)}`);
  if (view.status !== 200) throw new Error(`${view.status} ${JSON.stringify(view.body)}`);
  const events = (await replay(env, { thread: view.body.thread })).filter(e => (e.kind === "run" && e.run.id === id) || (e.kind === "message" && e.message.run === id));
  return { run: view.body, events };
}
/** A run's whole story: view, recorded input, events, receipts and usage rows. */
export async function trace(env, id) {
  const { run: view, events } = await run(env, id);
  return withRecords(env, db => ({
    run: view, input: parse(db.prepare("SELECT input FROM runs WHERE id = ?").get(id)?.input ?? "null"), events,
    receipts: db.prepare("SELECT tool, ok, actor, thread, input_hash, revisions, at FROM receipts WHERE run = ? ORDER BY at, id").all(id).map(r => ({ ...r, ok: !!r.ok, revisions: parse(r.revisions) })),
    usage: db.prepare("SELECT agent, model, actor, input, output, cached, at FROM usage WHERE run = ? ORDER BY at, id").all(id),
  }));
}
export function renderTrace(t) {
  return [`${t.run.id} ${t.run.agent} ${t.run.status}${t.run.error ? `: ${t.run.error}` : ""} (model ${t.run.model ?? "?"}, attempts ${t.run.attempts})`, `input ${JSON.stringify(t.input)}`,
    ...(t.run.output !== undefined ? [`output ${JSON.stringify(t.run.output)}`] : []), "events:", renderEvents(t.events),
    "receipts:", ...(t.receipts.length ? t.receipts.map(r => `  ${r.ok ? "ok     " : "refused"} ${r.tool} by ${r.actor} revisions ${JSON.stringify(r.revisions)}`) : ["  none"]),
    "usage:", ...(t.usage.length ? t.usage.map(u => `  ${u.model} in ${u.input} out ${u.output} cached ${u.cached} (${u.actor})`) : ["  none"])].join("\n");
}

/** The log of everything recorded: run transitions and messages (by cursor), receipts and usage (by time). */
export function log(env, opts = {}) {
  const since = Number(opts.since ?? 0);
  return withRecords(env, db => {
    const lines = [];
    for (const e of db.prepare("SELECT seq, run, kind, payload, at FROM events WHERE seq > ? ORDER BY seq").all(since)) {
      const p = parse(e.payload);
      if (opts.run && !(e.run ?? "").startsWith(opts.run)) continue;
      lines.push({ at: e.at, text: e.kind === "run" ? `#${e.seq} run ${p.run.id.slice(0, 8)} ${p.run.agent} → ${p.run.status}${p.run.error ? `: ${p.run.error}` : ""}` : e.kind === "message" ? `#${e.seq} ${p.message.role} (${(p.message.run ?? "").slice(0, 8)}): ${p.message.parts.map(x => x.text ?? `[${x.type}]`).join(" ").slice(0, 160)}` : `#${e.seq} ${e.kind}` });
    }
    for (const r of db.prepare("SELECT run, tool, ok, actor, revisions, at FROM receipts ORDER BY at, id").all()) if (!opts.run || r.run.startsWith(opts.run)) lines.push({ at: r.at, text: `receipt ${r.run.slice(0, 8)} ${r.tool} ${r.ok ? "ok" : "refused"} by ${r.actor} revisions ${r.revisions}` });
    for (const u of db.prepare("SELECT run, agent, model, actor, input, output, at FROM usage ORDER BY at, id").all()) if (!opts.run || u.run.startsWith(opts.run)) lines.push({ at: u.at, text: `usage ${u.run.slice(0, 8)} ${u.agent} ${u.model} in ${u.input} out ${u.output} by ${u.actor}` });
    return lines.sort((a, b) => a.at.localeCompare(b.at)).map(l => l.text);
  });
}

// ---------- the live page (the environment's own headless browser, over CDP) ----------

async function pageOf(env) {
  if (!env.browser?.pid || !alive(env.browser.pid)) throw new Error(env.browser?.error ?? "this environment has no browser; `boring env up` starts one unless --no-browser");
  const { chromium } = await import("playwright-core");
  const browser = await chromium.connectOverCDP(env.browser.cdp);
  const context = browser.contexts()[0];
  let page = context.pages().find(p => p.url().startsWith(env.url)) ?? context.pages()[0];
  if (!page) page = await context.newPage();
  if (!page.url().startsWith(env.url)) await page.goto(`${env.url}/`, { waitUntil: "load" });
  return { browser, page };
}
export async function withPage(env, fn) {
  const { browser, page } = await pageOf(env);
  try { return await fn(page); } finally { await browser.close(); }
}
export const screenshot = (env, file) => withPage(env, async page => { const out = path.resolve(file ?? path.join(env.stateDir, `shot-${Date.now()}.png`)); mkdirSync(path.dirname(out), { recursive: true }); await page.screenshot({ path: out, fullPage: true }); return out; });
export const snapshot = (env, selector) => withPage(env, async page => page.locator(selector ?? "body").ariaSnapshot());
export const click = (env, selector) => withPage(env, async page => { await page.locator(selector).first().click(); return "clicked"; });
export const type = (env, selector, text) => withPage(env, async page => { await page.locator(selector).first().fill(text); return "typed"; });
export const press = (env, keys, selector) => withPage(env, async page => { if (selector) await page.locator(selector).first().press(keys); else await page.keyboard.press(keys); return "pressed"; });
export const evaluate = (env, js) => withPage(env, async page => page.evaluate(js));
export const reload = env => withPage(env, async page => { await page.reload({ waitUntil: "load" }); return page.url(); });
/** Open a path of the app in the tab, as a person typing a URL would (e.g. "/#thread=<id>"). */
export const goto = (env, target) => withPage(env, async page => {
  const url = target.startsWith("http") ? target : `${env.url}${target.startsWith("/") ? "" : "/"}${target}`;
  const samePage = page.url().split("#")[0] === url.split("#")[0];
  await page.goto(url, { waitUntil: "load" });
  if (samePage) await page.reload({ waitUntil: "load" }); // a hash-only change does not reload the app; a person would press reload
  return page.url();
});
/** Wait for a selector to appear on the page (a `wait-settle` for the DOM). */
export const waitFor = (env, selector, timeout = 30000) => withPage(env, async page => { await page.locator(selector).first().waitFor({ timeout }); return "present"; });

// ---------- doctor: this machine, and whether the running instance is the one this checkout should drive ----------

export function newestSource(dirs, pattern = /\.(ts|tsx|mjs|js|json|html|md)$/) {
  let newest = 0, file = null;
  const walk = dir => { if (!existsSync(dir)) return; for (const entry of readdirSync(dir, { withFileTypes: true })) { if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "data" || entry.name === "states") continue; const full = path.join(dir, entry.name); if (entry.isDirectory()) walk(full); else if (pattern.test(entry.name)) { const t = statSync(full).mtimeMs; if (t > newest) { newest = t; file = full; } } } };
  for (const dir of dirs) walk(dir);
  return { newest, file };
}
/** Does this pid hold the listening socket on this port? Linux /proc; elsewhere the answer is null (unknown). */
export function portOwnedBy(port, pid) {
  try {
    const hex = port.toString(16).toUpperCase().padStart(4, "0");
    const inodes = new Set();
    for (const table of ["/proc/net/tcp", "/proc/net/tcp6"]) if (existsSync(table)) for (const line of readFileSync(table, "utf8").split("\n").slice(1)) {
      const cols = line.trim().split(/\s+/);
      if (cols.length > 9 && cols[1].endsWith(`:${hex}`) && cols[3] === "0A") inodes.add(cols[9]);
    }
    if (!inodes.size) return false;
    for (const fd of readdirSync(`/proc/${pid}/fd`)) { let link; try { link = readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; } const m = link.match(/^socket:\[(\d+)\]$/); if (m && inodes.has(m[1])) return true; }
    return false;
  } catch { return null; }
}
export function chromePath(explicit) {
  if (explicit) return existsSync(explicit) ? explicit : null;
  if (process.env.CHROME && existsSync(process.env.CHROME)) return process.env.CHROME;
  const cache = path.join(process.env.PLAYWRIGHT_BROWSERS_PATH ?? path.join(homedir(), ".cache/ms-playwright"));
  if (existsSync(cache)) for (const dir of readdirSync(cache).filter(d => /^chromium-\d+$/.test(d)).sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1])))
    for (const bin of ["chrome-linux64/chrome", "chrome-linux/chrome", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) if (existsSync(path.join(cache, dir, bin))) return path.join(cache, dir, bin);
  for (const bin of ["chromium", "chromium-browser", "google-chrome"]) { const r = spawnSync("which", [bin], { encoding: "utf8" }); if (r.status === 0) return r.stdout.trim(); }
  return null;
}
const has = (bin, args) => { const r = spawnSync(bin, args, { encoding: "utf8" }); return r.status === 0 ? (r.stdout || r.stderr).split("\n")[0].trim() : null; };

export async function doctor(opts = {}) {
  const rows = [];
  const add = (name, ok, detail, unlocks) => rows.push({ name, ok: !!ok, detail, unlocks });
  add("node", Number(process.versions.node.split(".")[0]) >= 22, process.version, "everything (node:sqlite needs 22+)");
  const java = has(process.env.JAVA_BIN ?? "java", ["-version"]);
  const javaMajor = java ? Number((java.match(/"(\d+)/) ?? [])[1]) : 0;
  add("java", javaMajor >= 17, java ? `${java}${javaMajor >= 17 ? "" : " (17+ needed)"}` : "not found (install a JDK 17 or set JAVA_BIN)", "TLA+ models (boring model, test:formal, verify)");
  let tlc; try { jarPath(); tlc = "pinned jar, checksum ok"; } catch (error) { tlc = error.message; }
  add("TLC", tlc === "pinned jar, checksum ok", tlc, "TLA+ models (npm run setup:formal)");
  let oxlint = null; try { oxlint = require.resolve("oxlint/package.json"); } catch { /* absent */ }
  add("oxlint", oxlint, oxlint ? JSON.parse(readFileSync(oxlint, "utf8")).version : "not installed (npm ci)", "boring lint");
  const chrome = chromePath(opts.chrome);
  add("chromium", chrome, chrome ?? "not found (npx playwright-core install chromium, or set CHROME)", "the environment's browser, every page control, boring smoke");
  let pw = null; try { pw = require.resolve("playwright-core"); } catch { /* absent */ }
  add("playwright-core", pw, pw ? "installed" : "not resolvable (npm ci)", "page controls (screenshot, snapshot, click, type, press, eval)");
  const dist = path.join(appDir, "web/dist/index.html");
  add("chat page", existsSync(dist), existsSync(dist) ? path.relative(root, dist) : "not built (env up builds it)", "the page in the browser");
  add("openrouter key", true, process.env.OPENROUTER_API_KEY ? "set: env up --model openrouter runs a real model" : "unset: the fake model only (set OPENROUTER_API_KEY for a real one)", "");
  const env = readEnv(opts.stateDir ?? defaultStateDir);
  if (!env) { add("environment", false, "none for this checkout", "boring env up"); return rows; }
  add("environment", alive(env.pid), `${env.url} pid ${env.pid} model ${env.model}${env.seed ? ` seed ${env.seed}` : ""}`, "boring env up --restart");
  const answers = alive(env.pid) ? (await wire(env, "GET", "/.well-known/boring.json").catch(() => null))?.status === 200 : false;
  const owns = alive(env.pid) ? portOwnedBy(env.ports.app, env.pid) : false;
  add("port owner", answers && owns !== false, !answers ? "not answering" : owns === null ? "answering (owner unknown on this OS)" : owns ? `answering from its own pid ${env.pid}` : `another process answers on port ${env.ports.app}`, "boring env down, free the port, boring env up");
  const { newest, file } = newestSource([path.join(root, "packages"), appDir, path.join(root, "tools"), path.join(root, "bin")]);
  const fresh = newest <= Date.parse(env.startedAt);
  add("freshness", fresh, fresh ? "no source changed since start" : `STALE: ${path.relative(root, file)} changed after the app started`, "boring env up --restart");
  const browser = env.browser?.pid && alive(env.browser.pid);
  add("browser", browser, browser ? `${env.browser.cdp} pid ${env.browser.pid}` : env.browser?.error ?? "not running", "boring env up --restart (needs chromium)");
  return rows;
}
