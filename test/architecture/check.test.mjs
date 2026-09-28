import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { checkArchitecture } from "../../tools/check.mjs";
import { validateRegistry, loadRegistries } from "../../tools/verify.mjs";
import { root } from "../../tools/formal.mjs";

function fixture(t) {
  mkdirSync(path.join(root, ".cache"), { recursive: true });
  const dir = mkdtempSync(path.join(root, ".cache/architecture-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  for (const item of ["ARCHITECTURE.json", "INVARIANTS.md", "VERIFY.json"]) cpSync(path.join(root, item), path.join(dir, item));
  cpSync(path.join(root, "packages"), path.join(dir, "packages"), { recursive: true, filter: source => !source.includes("node_modules") });
  return dir;
}
function source(dir, file, text) {
  const target = path.join(dir, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
}
const errorsOf = async dir => (await checkArchitecture(dir)).join("\n");

test("the committed skeleton passes", async () => {
  assert.deepEqual(await checkArchitecture(root), []);
});

test("agent may import files by package name or relative path", async t => {
  const dir = fixture(t);
  source(dir, "packages/agent/src/probe.ts", 'import type { FileRef } from "@boring/files"; import { x } from "../../files/src/index.js";');
  source(dir, "packages/files/src/index.ts", "export const x = 1; export type FileRef = string;");
  assert.deepEqual(await checkArchitecture(dir), []);
});

for (const statement of [
  'import { x } from "@boring/agent";',
  'export { x } from "@boring/agent";',
  'import "@boring/agent";',
  'import("@boring/agent");',
  'require("@boring/agent");',
  'import { x } from "../../agent/src/index.js";'
]) {
  test(`files cannot load agent: ${statement}`, async t => {
    const dir = fixture(t);
    source(dir, "packages/agent/src/index.ts", "export const x = 1;");
    source(dir, "packages/files/src/probe.ts", statement);
    assert.match(await errorsOf(dir), /forbidden package import files -> agent/);
  });
}

test("chat may import only types from agent", async t => {
  const dir = fixture(t);
  source(dir, "packages/chat/src/probe.ts", 'import type { Event } from "@boring/agent/wire";');
  assert.deepEqual(await checkArchitecture(dir), []);
  for (const statement of ['import { run } from "@boring/agent";', 'export * from "@boring/agent/wire";', 'import("@boring/agent");', 'import * as agent from "@boring/agent";']) {
    source(dir, "packages/chat/src/probe.ts", statement);
    assert.match(await errorsOf(dir), /chat may import only types from agent/);
  }
});

test("undeclared externals, computed loading and consumers are rejected", async t => {
  const dir = fixture(t);
  source(dir, "packages/files/src/probe.ts", 'import fs from "node:fs"; import(variable); import { t } from "../../../test/helper.js";');
  source(dir, "test/helper.ts", "export const t = 1;");
  const errors = await errorsOf(dir);
  assert.match(errors, /undeclared external dependency node:fs/);
  assert.match(errors, /computed module loading/);
  assert.match(errors, /cannot import a consumer/);
});

test("a consumer may import any package", async t => {
  const dir = fixture(t);
  source(dir, "test/probe.ts", 'import { a } from "@boring/agent"; import { c } from "../packages/chat/src/index.js";');
  assert.deepEqual(await checkArchitecture(dir), []);
});

test("an undeclared package directory and a missing law file are rejected", async t => {
  const dir = fixture(t);
  source(dir, "packages/extra/src/index.ts", "export {};");
  rmSync(path.join(dir, "packages/chat/INVARIANTS.md"));
  const errors = await errorsOf(dir);
  assert.match(errors, /undeclared package: packages\/extra/);
  assert.match(errors, /chat: missing INVARIANTS.md/);
});

test("package.json must agree with the policy", async t => {
  const dir = fixture(t);
  const file = path.join(dir, "packages/chat/package.json");
  const manifest = JSON.parse(readFileSync(file, "utf8"));
  manifest.dependencies = { "@boring/files": "*" };
  writeFileSync(file, JSON.stringify(manifest));
  assert.match(await errorsOf(dir), /chat: package.json declares @boring\/files which the policy does not allow/);
});

test("cycles are rejected even when one edge is type-only", async t => {
  const dir = fixture(t);
  const file = path.join(dir, "ARCHITECTURE.json");
  const policy = JSON.parse(readFileSync(file, "utf8"));
  policy.packages.files.typeOnlyDependsOn.push("agent");
  writeFileSync(file, JSON.stringify(policy));
  assert.match(await errorsOf(dir), /cyclic package dependency/);
});

test("reject unknown or accidentally green verifier declarations", () => {
  const wrap = verifier => ({ version: 1, invariants: { "EXAMPLE-1": { verifiers: [verifier] } } });
  assert.throws(() => validateRegistry(wrap({ kind: "documented", claim: "proof" })), /unknown verifier kind/);
  assert.throws(() => validateRegistry(wrap({ kind: "command", claim: "check", command: "node check.mjs" })), /argv/);
  assert.throws(() => validateRegistry(wrap({ kind: "pending", claim: "later" })), /reason/);
  assert.throws(() => validateRegistry(wrap({ kind: "model", claim: "proof", model: "missing" })), /unknown model/);
});

test("a package law cannot be copied into the root registry", t => {
  const dir = fixture(t);
  const registries = loadRegistries(dir);
  const files = registries.find(item => item.owner === "files").registry;
  const file = path.join(dir, "VERIFY.json");
  const registry = JSON.parse(readFileSync(file, "utf8"));
  registry.invariants["FILES-2"] = files.invariants["FILES-2"];
  writeFileSync(file, JSON.stringify(registry));
  assert.throws(() => loadRegistries(dir), /boring: FILES-2 has no invariant definition owned here/);
});

test("duplicate definitions and missing owner evidence fail registry validation", t => {
  const dir = fixture(t);
  const definitions = path.join(dir, "packages/files/INVARIANTS.md");
  const original = readFileSync(definitions, "utf8");
  writeFileSync(definitions, original + "\n## FILES-1 — duplicate\n");
  assert.throws(() => loadRegistries(dir), /duplicate invariant definition/);
  writeFileSync(definitions, original);
  const file = path.join(dir, "packages/files/VERIFY.json");
  const registry = JSON.parse(readFileSync(file, "utf8"));
  delete registry.invariants["FILES-2"];
  writeFileSync(file, JSON.stringify(registry));
  assert.throws(() => loadRegistries(dir), /files: FILES-2 has no evidence entry/);
});
