import { readFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { root, runModel, toolchain } from "./formal.mjs";

export const owners = ["boring", "files", "agent", "chat"];
const ownerDir = owner => owner === "boring" ? "." : `packages/${owner}`;
export function validateRegistry(registry, location = "registry") {
  if (registry.version !== 1 || !registry.invariants || typeof registry.invariants !== "object") throw new Error(`${location}: invalid registry`);
  for (const [id, invariant] of Object.entries(registry.invariants)) {
    if (!Array.isArray(invariant.verifiers) || !invariant.verifiers.length) throw new Error(`${id}: missing verifier or explicit deferral`);
    for (const verifier of invariant.verifiers) {
      if (typeof verifier.claim !== "string" || !verifier.claim.trim()) throw new Error(`${id}: missing evidence claim`);
      if (verifier.kind === "pending") {
        if (!verifier.reason) throw new Error(`${id}: deferral requires a reason`);
      } else if (verifier.kind === "command") {
        if (!Array.isArray(verifier.command) || !verifier.command.length || verifier.command.some(value => typeof value !== "string" || !value)) throw new Error(`${id}: command must be a nonempty argv array`);
        if (verifier.timeout !== undefined && !(Number(verifier.timeout) > 0)) throw new Error(`${id}: timeout must be seconds`);
      } else if (verifier.kind === "model") {
        if (!Object.hasOwn(toolchain.models, verifier.model)) throw new Error(`${id}: unknown model`);
      } else throw new Error(`${id}: unknown verifier kind ${verifier.kind}`);
    }
  }
}
function invariantDocuments(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : invariantDocuments(file);
    return entry.name === "INVARIANTS.md" ? [file] : [];
  });
}
export function loadRegistries(directory = root) {
  const result = [], definitions = new Map();
  for (const owner of owners) {
    const prefix = path.join(directory, ownerDir(owner));
    const registry = JSON.parse(readFileSync(path.join(prefix, "VERIFY.json"), "utf8"));
    validateRegistry(registry, owner);
    const documents = owner === "boring" ? [path.join(prefix, "INVARIANTS.md")] : invariantDocuments(prefix);
    const declared = new Set();
    for (const file of documents) {
      for (const match of readFileSync(file, "utf8").matchAll(/^#{2,3} ([A-Z]+(?:-[A-Z]+)*-\d+) —/gm)) {
        const id = match[1];
        if (definitions.has(id)) throw new Error(`${id}: duplicate invariant definition in ${definitions.get(id)} and ${file}`);
        definitions.set(id, file);
        declared.add(id);
      }
    }
    for (const id of declared) if (!registry.invariants[id]) throw new Error(`${owner}: ${id} has no evidence entry`);
    for (const id of Object.keys(registry.invariants)) if (!declared.has(id)) throw new Error(`${owner}: ${id} has no invariant definition owned here`);
    result.push({ owner, registry });
  }
  return result;
}
export function verify(selection = "all") {
  if (selection !== "all" && !owners.includes(selection)) throw new Error(`unknown owner ${selection}`);
  const cache = new Map();
  let failed = 0, passed = 0, pending = 0;
  for (const { owner, registry } of loadRegistries()) {
    if (selection !== "all" && selection !== owner) continue;
    console.log(`\n[${owner}]`);
    for (const [id, invariant] of Object.entries(registry.invariants)) {
      for (const verifier of invariant.verifiers) {
        if (verifier.kind === "pending") { pending++; console.log(`  ${id}: deferred — ${verifier.reason}`); continue; }
        const key = JSON.stringify(verifier.kind === "model" ? ["model", verifier.model] : ["command", verifier.command]);
        if (!cache.has(key)) {
          let result;
          try {
            if (verifier.kind === "model") result = runModel(verifier.model);
            else {
              const [bin, ...args] = verifier.command;
              const execution = spawnSync(bin === "node" ? process.execPath : bin, args, { cwd: root, encoding: "utf8", timeout: Number(verifier.timeout ?? 300) * 1000, shell: bin === "npm" });
              result = { status: execution.status, output: (execution.stdout ?? "") + (execution.stderr ?? "") + (execution.error?.message ?? "") };
            }
          } catch (error) { result = { status: 1, output: error.message }; }
          cache.set(key, result);
          process.stdout.write(result.output);
        }
        const ok = cache.get(key).status === 0;
        if (ok) passed++; else failed++;
        console.log(`  ${id}: ${ok ? "passed" : "FAILED"} — ${verifier.claim}`);
      }
    }
  }
  console.log(`\nEvidence: ${passed} passed associations, ${pending} explicit deferrals, ${failed} failed; ${cache.size} distinct verifiers. Deferrals are not verified guarantees.`);
  return failed === 0;
}
