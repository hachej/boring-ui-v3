// The application side of the verification CLI: start the hub, drive features through it, record evidence, and say
// what this machine can and cannot verify. An agent that changed behavior runs `boring e2e` (or `boring drive` on a
// hub it started) instead of writing a one-off script; the evidence lands in .cache/evidence/ with the same shape
// every time.
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { jarPath, root } from "./formal.mjs";
import { chromePath } from "./control.mjs";

const require = createRequire(import.meta.url);
const skill = path.join(root, ".agent/skills/verify-boring");
const driversFile = path.join(skill, "drive/drivers.mjs");
const { drivers } = existsSync(driversFile) ? await import(pathToFileURL(driversFile).href) : { drivers: {} };

export function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) { out._.push(argv[i]); continue; }
    const key = argv[i].slice(2), next = argv[i + 1];
    out[key] = next === undefined || next.startsWith("--") ? true : (i++, next);
  }
  return out;
}

function playwrightCore() {
  if (process.env.PLAYWRIGHT_CORE && existsSync(process.env.PLAYWRIGHT_CORE)) return process.env.PLAYWRIGHT_CORE;
  try { return require.resolve("playwright-core"); } catch { return null; }
}
const chatBundle = explicit => { const dir = explicit ?? process.env.BORING_CHAT_BUNDLE; return dir && existsSync(path.join(dir, "chat.js")) ? path.resolve(dir) : null; };
const has = (bin, args) => { const r = spawnSync(bin, args, { encoding: "utf8" }); return r.status === 0 ? (r.stdout || r.stderr).split("\n")[0].trim() : null; };

/** What this machine can verify, and what it cannot and why. Informational; never fails. */
export function doctor(options = {}) {
  const rows = [];
  const add = (name, ok, detail, unlocks) => rows.push({ name, ok: !!ok, detail, unlocks });
  add("node", Number(process.versions.node.split(".")[0]) >= 22, process.version, "everything (node:sqlite needs 22+)");
  let tlc = null; try { jarPath(); tlc = "pinned jar, checksum ok"; } catch (error) { tlc = error.message; }
  add("TLC", tlc === "pinned jar, checksum ok", tlc, "TLA+ models (boring model, test:formal)");
  const java = has(process.env.JAVA_BIN ?? "java", ["-version"]);
  add("java", java, java ?? "not found (set JAVA_BIN)", "TLA+ models");
  let codex = "no pi login";
  try {
    const entry = JSON.parse(readFileSync(process.env.PI_AUTH_FILE ?? path.join(homedir(), ".pi/agent/auth.json"), "utf8"))["openai-codex"];
    if (entry?.access) { const hours = ((entry.expires > 1e12 ? entry.expires : entry.expires * 1000) - Date.now()) / 3_600_000; codex = hours > 0 ? `valid ${hours.toFixed(0)} h` : "expired; run pi to refresh"; }
  } catch { /* no file */ }
  add("codex login", /^valid/.test(codex), codex, "real-model runs (boring run --model codex); e2e stays scripted");
  const chrome = chromePath(options.chrome);
  add("chromium", chrome, chrome ?? "not found (set CHROME)", "the environment's browser and every page control");
  const pw = playwrightCore();
  add("playwright-core", pw, pw ? "installed" : "not resolvable (npm ci)", "page controls (screenshot, snapshot, click, type, press, eval)");
  const bundle = chatBundle(options["chat-bundle"]);
  add("chat panel", bundle, bundle ?? "no build (set BORING_CHAT_BUNDLE or --chat-bundle)", "the panel driver; the hub page falls back to a minimal client without it");
  return rows;
}

function evidenceDir() {
  const dir = path.join(root, ".cache/evidence", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Drive one feature (or all) through a running hub; returns [{ name, ok, skipped?, steps, ms }]. */
export async function drive(names, options) {
  const dir = options.evidence ?? evidenceDir();
  const chrome = chromePath(options.chrome), pw = playwrightCore();
  if (pw) process.env.PLAYWRIGHT_CORE = pw;
  const results = [];
  for (const name of names) {
    const driver = drivers[name];
    if (!driver) throw new Error(`unknown driver ${name}; known: ${Object.keys(drivers).join(", ")}`);
    if (driver.needs.includes("browser") && !(options.browser && chrome && pw)) {
      results.push({ name, feature: driver.feature, ok: true, skipped: !options.browser ? "browser drivers run with --browser" : "no chromium or playwright-core (see boring doctor)", steps: [] });
      continue;
    }
    const t0 = Date.now();
    let steps, ok = true, error;
    try { steps = (await driver.run({ url: options.url, chrome, screenshot: path.join(dir, `${name}.png`) })).steps; }
    catch (failure) { ok = false; steps = failure.steps ?? []; error = failure.message; }
    const result = { name, feature: driver.feature, ok, error, url: options.url, ms: Date.now() - t0, steps };
    writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(result, null, 2));
    results.push(result);
  }
  return { dir, results };
}

/** Start the hub as a child process and resolve once it prints its URL. */
export function runHost(args, { inherit = false } = {}) {
  const child = spawn(process.execPath, ["--no-warnings", "--import=tsx", path.join(root, "packages/agent/src/host/run.ts"), ...args], { cwd: root, stdio: inherit ? "inherit" : ["ignore", "pipe", "pipe"] });
  if (inherit) return { child, ready: Promise.resolve(null) };
  let log = "";
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`hub did not start in 60 s:\n${log}`)), 60_000);
    const read = chunk => { log += chunk; const m = log.match(/^hub (\S+) model (\S+)$/m); if (m) { clearTimeout(timer); resolve({ url: m[1], model: m[2] }); } };
    child.stdout.on("data", read); child.stderr.on("data", read);
    child.on("exit", code => { clearTimeout(timer); reject(new Error(`hub exited with ${code}:\n${log}`)); });
  });
  return { child, ready, log: () => log };
}

export function printResults({ dir, results }) {
  for (const r of results) {
    if (r.skipped) { console.log(`SKIP ${r.name} (${r.feature}): ${r.skipped}`); continue; }
    console.log(`${r.ok ? "PASS" : "FAIL"} ${r.name} (${r.feature}) ${(r.ms / 1000).toFixed(1)} s`);
    for (const s of r.steps) console.log(`  ${s.ok ? "✓" : "✗"} ${s.claim}${s.ok ? "" : ` — ${s.observed}`}`);
    if (!r.ok && r.error && !r.steps.some(s => !s.ok)) console.log(`  ✗ ${r.error}`);
  }
  console.log(`evidence: ${path.relative(root, dir)}/`);
}
