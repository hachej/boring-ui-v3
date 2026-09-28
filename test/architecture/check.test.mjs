import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { checkArchitecture } from "../../platform/check.mjs";
import { validateRegistry, loadRegistries } from "../../tools/verify.mjs";
import { root } from "../../tools/formal.mjs";

function fixture(t) {
  mkdirSync(path.join(root, ".cache"), { recursive: true });
  const dir = mkdtempSync(path.join(root, ".cache/architecture-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(path.join(root, "platform"), path.join(dir, "platform"), { recursive: true });
  return dir;
}
function source(dir, file, text) {
  const target = path.join(dir, file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, text);
}

test("declared noun imports resolve to their actual TypeScript owner", async t => {
  const dir = fixture(t);
  source(dir, "platform/resources/ref.ts", "export type Ref = string;");
  source(dir, "platform/jobs/example.ts", 'import type { Ref } from "../resources/ref.js";');
  assert.deepEqual(await checkArchitecture(dir), []);
});

for (const statement of [
  'import { provider } from "../../infra/provider.js";',
  'export { provider } from "../../infra/provider.js";',
  'import "../../infra/provider.js";',
  'import("../../infra/provider.js");',
  'require("../../infra/provider.js");',
  'type Provider = import("../../infra/provider.js").Provider;'
]) {
  test(`reject forbidden layer loading: ${statement}`, async t => {
    const dir = fixture(t);
    source(dir, "infra/provider.ts", "export const provider = 1;");
    source(dir, "platform/actors/probe.ts", statement);
    assert.match((await checkArchitecture(dir)).join("\n"), /forbidden layer import/);
  });
}

test("reject forbidden noun, external provider and computed module loading", async t => {
  const dir = fixture(t);
  source(dir, "platform/actors/identity.ts", "export type Actor = string;");
  source(dir, "platform/resources/probe.ts", 'import type { Actor } from "../actors/identity.js"; import fs from "node:fs"; import(variable);');
  const errors = (await checkArchitecture(dir)).join("\n");
  assert.match(errors, /forbidden noun import resources -> actors/);
  assert.match(errors, /undeclared external dependency node:fs/);
  assert.match(errors, /computed module loading/);
});

test("distinguish root reusable Jobs from kernel Job types", async t => {
  const dir = fixture(t);
  source(dir, "jobs/probe.ts", "export const value = 1;");
  source(dir, "platform/jobs/probe.ts", 'import "../../jobs/probe.js";');
  assert.match((await checkArchitecture(dir)).join("\n"), /forbidden layer import/);
});

test("reject unknown or accidentally green verifier declarations", () => {
  const wrap = verifier => ({ version: 1, invariants: { "EXAMPLE-1": { verifiers: [verifier] } } });
  assert.throws(() => validateRegistry(wrap({kind:"documented",claim:"proof"})), /unknown verifier kind/);
  assert.throws(() => validateRegistry(wrap({kind:"command",claim:"check",command:"node check.mjs"})), /argv/);
  assert.throws(() => validateRegistry(wrap({kind:"pending",claim:"later"})), /reason/);
  assert.throws(() => validateRegistry(wrap({kind:"model",claim:"proof",model:"missing"})), /unknown model/);
});

for (const sourcePath of ["platform/actors/probe.ts", "jobs/probe.ts", "experiences/probe.ts"]) {
  test(`Environment administration is not a runtime dependency of ${sourcePath}`, async t => {
    const dir = fixture(t);
    source(dir, "platform/environments/example.ts", "export type Environment = {}; export const admit = () => ({});");
    const relative = sourcePath.startsWith("platform/") ? "../environments/example.js" : "../platform/environments/example.js";
    source(dir, sourcePath, `import type { Environment } from "${relative}";`);
    assert.deepEqual(await checkArchitecture(dir), []);
    for (const statement of [`import { admit } from "${relative}";`, `export * from "${relative}";`, `import("${relative}");`, `import * as policy from "${relative}";`]) {
      source(dir, sourcePath, statement);
      assert.match((await checkArchitecture(dir)).join("\n"), /must use issued operations/);
    }
  });
}


test("noun cycles are rejected even when the reverse edge is type-only", async t => {
  const dir = fixture(t);
  const policyFile = path.join(dir, "platform/ARCHITECTURE.json");
  const policy = JSON.parse(readFileSync(policyFile, "utf8"));
  policy.allowedDependencies.environments.push("actors");
  policy.typeOnlyDependencies["platform/environments"] = ["platform/actors"];
  writeFileSync(policyFile, JSON.stringify(policy));
  assert.match((await checkArchitecture(dir)).join("\n"), /cyclic noun dependency/);
});

test("identity references are neutral types, not noun implementations or behavior", async t => {
  const dir = fixture(t);
  source(dir, "platform/environments/probe.ts", 'import type { ActorRef, ResourceRef } from "../identity.js";');
  assert.deepEqual(await checkArchitecture(dir), []);
  source(dir, "platform/actors/probe.ts", "export type ActorRef = string;");
  source(dir, "platform/environments/probe.ts", 'import type { ActorRef } from "../actors/probe.js";');
  assert.match((await checkArchitecture(dir)).join("\n"), /forbidden noun import environments -> actors/);
  source(dir, "platform/environments/probe.ts", 'import "../identity.js";');
  assert.match((await checkArchitecture(dir)).join("\n"), /may only be imported as types/);
  for (const content of ['export const identity = 1;', 'export type Ref = import("./actors/probe.js").ActorRef;']) {
    source(dir, "platform/identity.ts", content);
    assert.match((await checkArchitecture(dir)).join("\n"), /only type declarations and no imports/);
  }
});

test("nested file laws belong to Resources and cannot be copied into the root registry", t => {
  const dir = fixture(t);
  const registries = loadRegistries(dir);
  assert.ok(registries.find(item => item.owner === "resources").registry.invariants["FS-3"]);
  const file = path.join(dir, "platform/VERIFY.json");
  const registry = JSON.parse(readFileSync(file, "utf8"));
  registry.invariants["FS-3"] = registries.find(item => item.owner === "resources").registry.invariants["FS-3"];
  writeFileSync(file, JSON.stringify(registry));
  assert.throws(() => loadRegistries(dir), /platform: FS-3 has no invariant definition owned here/);
});

test("duplicate definitions and missing owner evidence fail registry validation", t => {
  const dir = fixture(t);
  const definitions = path.join(dir, "platform/resources/filesystem/INVARIANTS.md");
  const original = readFileSync(definitions, "utf8");
  writeFileSync(definitions, original + "\n## JOB-1 — duplicate\n");
  assert.throws(() => loadRegistries(dir), /duplicate invariant definition/);
  writeFileSync(definitions, original);
  const file = path.join(dir, "platform/resources/VERIFY.json");
  const registry = JSON.parse(readFileSync(file, "utf8"));
  delete registry.invariants["FS-3"];
  writeFileSync(file, JSON.stringify(registry));
  assert.throws(() => loadRegistries(dir), /resources: FS-3 has no evidence entry/);
});
