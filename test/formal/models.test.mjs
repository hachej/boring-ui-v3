// Every bounded model must detect its own removed guard: for each invariant, one mutant of the spec that drops the
// guard protecting it, run in a temporary copy, must be reported as a violation of exactly that invariant. A model
// that checks nothing cannot pass here, and a syntax error in a mutant is not a passing negative test.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { root, toolchain, runModel } from "../../tools/formal.mjs";

const after = (text, marker, edit) => { const at = text.indexOf(marker); assert.ok(at >= 0, `marker ${marker} not found`); return text.slice(0, at) + edit(text.slice(at)); };
const drop = line => text => { assert.ok(text.includes(line), `guard ${JSON.stringify(line)} not found`); return text.replace(line, ""); };

/** [model, invariant, mutation]: what removing one guard must make TLC report. */
const mutations = [
  ["files-commit", "NoStaleCommit", drop("  /\\ baseRevision[w] = revision\n")],
  ["agent-commit", "NoStaleCommit", drop("  /\\ observed = revision\n")],
  ["agent-commit", "NoRevokedCommit", drop("  /\\ ~revoked\n")],
  ["agent-commit", "ReceiptImpliesRunning", text => after(text, "Commit ==", t => t.replace("  /\\ runStatus = \"running\"\n", ""))],
  ["agent-idempotency", "SameBodySameRun", text => after(text, "Repeat(s) ==", t => t.replace("![s] = table[key[s]].run]", "![s] = nextRun]"))],
  ["agent-idempotency", "OtherBodyRefused", text => after(text, "Repeat(s) ==", t => t.replace("  /\\ table[key[s]].body = body[s]\n", ""))],
  ["agent-idempotency", "OneRunPerKey", text => after(text, "Restart ==", t => t.replace("  /\\ UNCHANGED <<key, body, table, result, nextRun, created>>", "  /\\ table' = [k \\in Keys |-> Absent]\n  /\\ UNCHANGED <<key, body, result, nextRun, created>>"))],
  ["agent-composition", "Predeclared", text => after(text, "Start ==", t => t.replace("  /\\ \\A s \\in plan : agent[s] \\in Declared\n", ""))],
  ["agent-composition", "Frozen", text => after(text, "Record(s) ==", t => t.replace("  /\\ s \\in plan\n", ""))],
  ["agent-composition", "ChildUnderRunningParent", text => after(text, "CancelParent ==", t => t.replace("IF Open(s) THEN", "IF child[s] = \"pending\" THEN"))],
  ["agent-composition", "ParentFromCompletedChildren", text => after(text, "CompleteParent ==", t => t.replace("  /\\ \\A s \\in plan : child[s] = \"completed\"\n", ""))],
  ["agent-composition", "NoUnresolvedChild", text => after(text, "FailParent ==", t => t.replace("  /\\ child' = [s \\in Slots |-> IF Open(s) THEN \"cancelled\" ELSE child[s]]\n  /\\ UNCHANGED <<plan, agent>>", "  /\\ UNCHANGED <<plan, agent, child>>"))],
  ["agent-composition", "ChildStatusIsOwn", text => after(text, "CancelParent ==", t => t.replace("IF Open(s) THEN", "IF child[s] # \"none\" THEN"))],
].filter(m => m[2]);

const baselines = new Map();
function copy(name) {
  mkdirSync(path.join(root, ".cache"), { recursive: true });
  const dir = mkdtempSync(path.join(root, ".cache/model-"));
  const model = toolchain.models[name];
  const original = readFileSync(path.join(root, model.spec), "utf8");
  const spec = path.join(dir, path.basename(model.spec)), config = path.join(dir, path.basename(model.config));
  writeFileSync(config, readFileSync(path.join(root, model.config)));
  return { dir, original, spec, config };
}

for (const name of Object.keys(toolchain.models)) {
  test(`${name}: the committed model passes`, () => {
    const { dir, original, spec, config } = copy(name);
    try { writeFileSync(spec, original); const result = runModel(name, { directory: dir, spec, config }); baselines.set(name, result.status); assert.equal(result.status, 0, result.output); }
    finally { rmSync(dir, { recursive: true, force: true }); }
  });
}
for (const [name, invariant, mutate] of mutations) {
  test(`${name}: removing the guard of ${invariant} is detected`, () => {
    const { dir, original, spec, config } = copy(name);
    try {
      const changed = mutate(original);
      assert.notEqual(changed, original, "the mutation changed nothing");
      writeFileSync(spec, changed);
      const mutant = runModel(name, { directory: dir, spec, config });
      assert.notEqual(mutant.status, 0, "the mutant passed");
      assert.doesNotMatch(mutant.output, /Parsing or semantic analysis failed|\*\*\* Errors: /, `the mutant does not parse:\n${mutant.output}`);
      assert.match(mutant.output, new RegExp(`(Invariant|Action property|Temporal properties?) ${invariant} (is|were) violated`), mutant.output);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}

test("every registered model has at least one negative control", () => {
  for (const name of Object.keys(toolchain.models)) assert.ok(mutations.some(m => m[0] === name), `${name} has no mutant`);
});

test("missing required TLC fails the CLI instead of skipping verification", () => {
  const result = spawnSync(process.execPath, ["bin/boring.mjs", "model", "agent-commit"], {
    cwd: root, encoding: "utf8", env: { ...process.env, TLA2TOOLS_JAR: path.join(root, ".cache/missing-tlc.jar") }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /required TLC is missing/);
});
