// `boring registry`: build the shadcn registry (registry.json + registry/<item>/ → public/r/*.json), check that the
// committed build is current, and install items into an example through the real `shadcn add` flow, served from a
// local URL so the install path is proved without publishing (the cross-item registryDependencies are rewritten
// from the GitHub Pages base to the local one in a copy; the committed JSON always names the Pages URLs).
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { root } from "./formal.mjs";

export const PAGES = "https://hachej.github.io/boring-ui-v3/r";
export const RAW = "https://raw.githubusercontent.com/hachej/boring-ui-v3/main/public/r";
const shadcn = () => path.join(root, "node_modules/shadcn/dist/index.js");
const run = (args, cwd = root) => {
  const r = spawnSync(process.execPath, [shadcn(), ...args], { cwd, encoding: "utf8", env: { ...process.env, CI: "1" } });
  if (r.status !== 0) throw new Error(`shadcn ${args.join(" ")} failed:\n${r.stdout}${r.stderr}`);
  return r.stdout;
};
/** Async on purpose: the registry is served from this process while shadcn fetches it. */
const runAsync = (args, cwd) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [shadcn(), ...args], { cwd, env: { ...process.env, CI: "1" } });
  let output = "";
  child.stdout.on("data", d => { output += d; });
  child.stderr.on("data", d => { output += d; });
  child.on("close", code => (code === 0 ? resolve(output) : reject(new Error(`shadcn ${args.join(" ")} failed:\n${output}`))));
});
export const items = () => JSON.parse(readFileSync(path.join(root, "registry.json"), "utf8")).items.map(i => i.name);

/** shadcn build into `out`, with the cross-item base rewritten when `base` is not the Pages URL. */
export function build({ out = path.join(root, "public/r"), base = PAGES } = {}) {
  let registry = path.join(root, "registry.json");
  if (base !== PAGES) {
    const tmp = mkdtempSync(path.join(root, ".cache", "registry-src-"));
    registry = path.join(tmp, "registry.json");
    writeFileSync(registry, readFileSync(path.join(root, "registry.json"), "utf8").replaceAll(PAGES, base.replace(/\/$/, "")));
  }
  mkdirSync(out, { recursive: true });
  run(["build", registry, "-c", root, "-o", out]);
  return { out, items: readdirSync(out).filter(f => f.endsWith(".json")) };
}

/** The committed public/r equals a fresh build: the registry served from Pages is the source in this commit. */
export function check() {
  mkdirSync(path.join(root, ".cache"), { recursive: true });
  const fresh = mkdtempSync(path.join(root, ".cache", "registry-check-"));
  build({ out: fresh });
  const committed = path.join(root, "public/r");
  const names = new Set([...readdirSync(fresh), ...(existsSync(committed) ? readdirSync(committed) : [])]);
  const stale = [...names].filter(n => !existsSync(path.join(committed, n)) || !existsSync(path.join(fresh, n)) || readFileSync(path.join(committed, n), "utf8") !== readFileSync(path.join(fresh, n), "utf8"));
  rmSync(fresh, { recursive: true, force: true });
  return { ok: stale.length === 0, stale };
}

/** Serves a directory on a free local port; `close()` stops it. */
export async function serve(dir) {
  const server = createServer((req, res) => {
    const file = path.join(dir, decodeURIComponent(new URL(req.url, "http://x").pathname).replace(/^\/r\//, ""));
    if (!file.startsWith(dir) || !existsSync(file)) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "content-type": "application/json" }); res.end(readFileSync(file));
  });
  await new Promise(r => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${server.address().port}/r`, close: () => new Promise(r => server.close(r)) };
}

/**
 * `npx shadcn add <url>` for each item into `cwd` (default the registry-host example), from a local build of this
 * checkout. `overwrite` replaces what is there, so a CI diff afterwards shows whether the committed copies match.
 */
export async function install({ cwd = path.join(root, "examples/registry-host"), names = items(), overwrite = true, log = () => {} } = {}) {
  mkdirSync(path.join(root, ".cache"), { recursive: true });
  const out = mkdtempSync(path.join(root, ".cache", "registry-r-"));
  const server = await serve(out);
  try {
    build({ out, base: server.url });
    const added = [];
    for (const name of names) {
      log(`shadcn add ${server.url}/${name}.json`);
      await runAsync(["add", "-y", ...(overwrite ? ["-o"] : []), `${server.url}/${name}.json`], cwd);
      added.push(name);
    }
    return { added, from: server.url, cwd };
  } finally { await server.close(); rmSync(out, { recursive: true, force: true }); }
}
