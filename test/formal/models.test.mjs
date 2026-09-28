import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { root, toolchain, runModel } from "../../tools/formal.mjs";

const mutations = [
  ["execution", text => text.replace("  /\\ observed = revision\n", ""), "NoStaleCommit"],
  ["execution", text => text.replace("  /\\ ~revoked\n", ""), "NoRevokedCommit"],
  ["resource-commit", text => text.replace("  /\\ baseRevision[w] = revision\n", ""), "NoStaleCommit"],
  ["job-lifecycle", text => text.replace("  /\\ \\A c \\in Created : child[c] = \"completed\"\n", ""), "NoPrematureParentCompletion"],
  ["job-lifecycle", text => text.replace("  /\\ parent = \"pending\"\n  /\\ child' = [child EXCEPT ![c] = \"pending\"]", "  /\\ child' = [child EXCEPT ![c] = \"pending\"]"), "FrozenComposition"],
  ["job-lifecycle", text => text.replace("  /\\ child[c] = \"pending\"\n  /\\ parent = \"running\"\n", "  /\\ child[c] = \"pending\"\n"), "ChildRunsUnderRunningParent"],
  ["job-lifecycle", text => text.replace("  /\\ child' = [c \\in Children |-> IF child[c] \\in {\"pending\", \"running\"} THEN \"cancelled\" ELSE child[c]]\n", "  /\\ UNCHANGED child\n"), "TerminalParentResolvesChildren"]
];

for (const [name, mutate, invariant] of mutations) {
  test(`${name}: original passes and forbidden transition is detected`, () => {
    mkdirSync(path.join(root, ".cache"), { recursive: true });
    const dir = mkdtempSync(path.join(root, ".cache/model-"));
    try {
      const model = toolchain.models[name];
      const original = readFileSync(path.join(root, model.spec), "utf8");
      const spec = path.join(dir, path.basename(model.spec));
      const config = path.join(dir, path.basename(model.config));
      writeFileSync(spec, original);
      writeFileSync(config, readFileSync(path.join(root, model.config)));
      const baseline = runModel(name, { directory: dir, spec, config });
      assert.equal(baseline.status, 0, baseline.output);
      const changed = mutate(original);
      assert.notEqual(changed, original);
      writeFileSync(spec, changed);
      const mutant = runModel(name, { directory: dir, spec, config });
      assert.notEqual(mutant.status, 0, mutant.output);
      assert.match(mutant.output, new RegExp(`Invariant ${invariant} is violated`));
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
}


test("missing required TLC fails the CLI instead of skipping verification", () => {
  const result = spawnSync(process.execPath, ["bin/boring.mjs", "model", "execution"], {
    cwd: root, encoding: "utf8", env: { ...process.env, TLA2TOOLS_JAR: path.join(root, ".cache/missing-tlc.jar") }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /required TLC is missing/);
});
