// The lint configuration is evidence for BORING-6 only if it refuses what the law forbids: a fixture tree with one
// forbidden import per package must fail with the law's message, and the allowed edges must pass.
import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { root } from "../../tools/formal.mjs";

const require = createRequire(import.meta.url);
const oxlint = path.join(path.dirname(require.resolve("oxlint/package.json")), "bin/oxlint");

function fixture(t, files) {
  // Outside the repository: oxlint honours the parent .gitignore (which ignores .cache) wherever it runs. The format is
  // named because oxlint switches to the github format under GITHUB_ACTIONS, which drops the help message asserted on.
  const dir = mkdtempSync(path.join(tmpdir(), "boring-lint-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  cpSync(path.join(root, ".oxlintrc.json"), path.join(dir, ".oxlintrc.json"));
  for (const [file, text] of Object.entries(files)) { mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); writeFileSync(path.join(dir, file), text); }
  const result = spawnSync(process.execPath, [oxlint, "-c", ".oxlintrc.json", "--format", "default", "."], { cwd: dir, encoding: "utf8" });
  return { status: result.status, output: result.stdout + result.stderr };
}

test("the verification tooling passes the lint configuration (the packages are linted by `boring lint`)", () => {
  const result = spawnSync(process.execPath, [oxlint, "-c", ".oxlintrc.json", "bin", "tools", "examples", "test/architecture", "test/formal"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

for (const [name, file, text, message] of [
  ["chat importing Flue", "packages/chat/src/x.ts", 'import { start } from "@flue/runtime/node"; export const y = start;', /chat never imports Flue/],
  ["chat importing the agent runtime", "packages/chat/src/x.ts", 'import { createRuntime } from "@boring/agent"; export const y = createRuntime;', /only the wire types/],
  ["chat importing Node", "packages/chat/src/x.ts", 'import { readFileSync } from "node:fs"; export const y = readFileSync;', /chat never imports Flue, a provider or Node/],
  ["agent importing chat", "packages/agent/src/x.ts", 'import { BoringChat } from "@boring/chat"; export const y = BoringChat;', /agent never imports chat/],
  ["agent importing Flue internals", "packages/agent/src/x.ts", 'import { z } from "@flue/runtime/internal/db"; export const y = z;', /public seams only/],
  ["files importing agent", "packages/files/src/x.ts", 'import type { Actor } from "@boring/agent"; export type Y = Actor;', /files imports nothing/],
  ["files importing Flue", "packages/files/src/x.ts", 'import { start } from "@flue/runtime/node"; export const y = start;', /files imports nothing/],
  ["viewers importing Flue", "packages/viewers/src/x.ts", 'import { start } from "@flue/runtime/node"; export const y = start;', /viewers never imports Flue/],
  ["viewers importing the agent package", "packages/viewers/src/x.ts", 'import type { Actor } from "@boring/agent"; export type Y = Actor;', /viewers never imports the agent package/],
  ["viewers importing the agent wire", "packages/viewers/src/x.ts", 'import type { Event } from "@boring/agent/wire"; export type Y = Event;', /viewers never imports the agent package/],
  ["viewers importing Node", "packages/viewers/src/x.ts", 'import { readFileSync } from "node:fs"; export const y = readFileSync;', /viewers never imports Flue, a provider SDK or Node/],
  ["viewers importing the Node entry of files", "packages/viewers/src/x.ts", 'import { directoryProvider } from "@boring/files"; export const y = directoryProvider;', /files\/web only/],
  ["the agent runtime importing a provider SDK module", "packages/agent/src/runtime/x.ts", 'import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"; export const y = openaiCodexProvider;', /only inside an adapter folder.*BORING-7/],
  ["the agent runtime importing node:fs", "packages/agent/src/runtime/x.ts", 'import { readFileSync } from "node:fs"; export const y = readFileSync;', /node:fs is used only inside an adapter folder.*BORING-7/],
  ["files importing node:fs outside the directory provider", "packages/files/src/x.ts", 'import { readFileSync } from "node:fs"; export const y = readFileSync;', /node:fs is used only inside an adapter folder.*BORING-7/],
  ["a package reading process.env", "packages/agent/src/runtime/x.ts", "export const y = process.env.OPENROUTER_API_KEY;", /never reads the environment.*BORING-7/],
]) {
  test(`lint refuses ${name}`, t => {
    const result = fixture(t, { [file]: text });
    assert.notEqual(result.status, 0, `lint passed a forbidden import:\n${result.output}`);
    assert.match(result.output, message);
  });
}

test("lint accepts the allowed edges: chat reading the wire types, agent importing files, the directory provider and an adapter using Node, an adapter its SDK", t => {
  const result = fixture(t, {
    "packages/chat/src/x.ts": 'import type { Event } from "@boring/agent/wire"; export type Y = Event;',
    "packages/agent/src/x.ts": 'import type { FileRef } from "@boring/files"; export type Y = FileRef;',
    "packages/files/src/directory.ts": 'import { readFileSync } from "node:fs"; export const y = readFileSync;',
    "packages/agent/src/adapters/models/x/index.ts": 'import { readFileSync } from "node:fs"; import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex"; export const y = [readFileSync, openaiCodexProvider, process.env.X];',
    "packages/viewers/src/x.ts": 'import { memoryProvider } from "@boring/files/web"; import { createUiBridge } from "@boring/chat/bridge"; import { useMemo } from "react"; export const y = [memoryProvider, createUiBridge, useMemo];',
  });
  assert.equal(result.status, 0, result.output);
});
