// `boring registry`: build the shadcn registry (registry.json + registry/<item>/ → public/r/*.json), check that the
// committed build is current, and install items into an app through the real `shadcn add @boring/<item>` flow.
//
// Items name each other by namespace (`@boring/conflict-banner`), so one `registries["@boring"]` entry in the app's
// components.json decides where every item comes from. The repository is private: the consumer's entry is the
// authenticated raw GitHub URL (RAW, with an Authorization header from GITHUB_TOKEN). `install` defaults to a local
// build of this checkout served over HTTP (what CI proves for a pull request); `--from github` uses the app's own
// entry, i.e. what a consumer gets from main.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { root } from "./formal.mjs";

export const RAW = "https://raw.githubusercontent.com/hachej/boring-ui-v3/main/public/r/{name}.json";
export const CONSUMER_ENTRY = { url: RAW, headers: { Authorization: "token ${GITHUB_TOKEN}" } };
const shadcn = () => path.join(root, "node_modules/shadcn/dist/index.js");
const run = (args, cwd = root) => new Promise((resolve, reject) => {
  // Async on purpose: `install` serves the registry from this process while shadcn fetches it.
  const child = spawn(process.execPath, [shadcn(), ...args], { cwd, env: { ...process.env, CI: "1" } });
  let output = "";
  child.stdout.on("data", d => { output += d; });
  child.stderr.on("data", d => { output += d; });
  child.on("close", code => (code === 0 ? resolve(output) : reject(new Error(`shadcn ${args.join(" ")} failed:\n${output}`))));
});
export const items = () => JSON.parse(readFileSync(path.join(root, "registry.json"), "utf8")).items.map(i => i.name);

export async function build({ out = path.join(root, "public/r") } = {}) {
  mkdirSync(out, { recursive: true });
  await run(["build", path.join(root, "registry.json"), "-c", root, "-o", out]);
  return { out, items: readdirSync(out).filter(f => f.endsWith(".json")) };
}

/** The committed public/r equals a fresh build: what consumers fetch from main is the source in this commit. */
export async function check() {
  mkdirSync(path.join(root, ".cache"), { recursive: true });
  const fresh = mkdtempSync(path.join(root, ".cache", "registry-check-"));
  await build({ out: fresh });
  const committed = path.join(root, "public/r");
  const names = new Set([...readdirSync(fresh), ...(existsSync(committed) ? readdirSync(committed) : [])]);
  const stale = [...names].filter(n => !existsSync(path.join(committed, n)) || !existsSync(path.join(fresh, n)) || readFileSync(path.join(committed, n), "utf8") !== readFileSync(path.join(fresh, n), "utf8"));
  rmSync(fresh, { recursive: true, force: true });
  return { ok: stale.length === 0, stale };
}

/** Serves a directory over HTTP on a free local port. */
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
 * `npx shadcn add @boring/<item>` for each item into `cwd` (default the registry-host example). `from: "local"` points
 * the app's `@boring` registry at a local HTTP build of this checkout for the duration (and puts the app's entry
 * back); `from: "github"` uses the app's entry as committed: the authenticated raw URL, GITHUB_TOKEN required.
 */
export async function install({ cwd = path.join(root, "examples/registry-host"), names = items(), overwrite = true, from = "local", log = () => {} } = {}) {
  const configFile = path.join(cwd, "components.json");
  const original = readFileSync(configFile, "utf8");
  let server = null, out = null;
  try {
    if (from === "github") {
      if (!process.env.GITHUB_TOKEN) throw new Error("--from github needs GITHUB_TOKEN (a token that can read hachej/boring-ui-v3)");
      const entry = JSON.parse(original).registries?.["@boring"];
      if (!entry) throw new Error(`${path.relative(root, configFile)} has no registries["@boring"] entry`);
    } else {
      mkdirSync(path.join(root, ".cache"), { recursive: true });
      out = mkdtempSync(path.join(root, ".cache", "registry-r-"));
      await build({ out });
      server = await serve(out);
      const config = JSON.parse(original);
      writeFileSync(configFile, `${JSON.stringify({ ...config, registries: { ...config.registries, "@boring": `${server.url}/{name}.json` } }, null, 2)}\n`);
    }
    const source = from === "github" ? RAW : `${server.url}/{name}.json`;
    const added = [];
    for (const name of names) {
      log(`shadcn add @boring/${name}  (${source.replace("{name}", name)})`);
      await run(["add", "-y", ...(overwrite ? ["-o"] : []), `@boring/${name}`], cwd);
      added.push(name);
    }
    return { added, from: source, cwd };
  } finally {
    writeFileSync(configFile, original);
    await server?.close();
    if (out) rmSync(out, { recursive: true, force: true });
  }
}
