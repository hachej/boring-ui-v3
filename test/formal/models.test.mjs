import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { root, toolchain, runModel } from "../../tools/formal.mjs";

const mutations = [
  ["agent-commit", text => text.replace("  /\\ observed = revision\n", ""), "NoStaleCommit"],
  ["agent-commit", text => text.replace("  /\\ ~revoked\n", ""), "NoRevokedCommit"],
  ["files-commit", text => text.replace("  /\\ baseRevision[w] = revision\n", ""), "NoStaleCommit"]
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
  const result = spawnSync(process.execPath, ["bin/boring.mjs", "model", "agent-commit"], {
    cwd: root, encoding: "utf8", env: { ...process.env, TLA2TOOLS_JAR: path.join(root, ".cache/missing-tlc.jar") }
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /required TLC is missing/);
});
