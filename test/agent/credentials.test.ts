import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { boot, tempDir } from "./helpers.ts";

test("AGENT-7: a credential given at mount time reaches no definition, record, manifest or event", async t => {
  const SECRET = "sk-or-SECRET-0123456789";
  const dir = tempDir();
  const store = path.join(dir, "agent.sqlite");
  const { app, call, events, runtime, settled } = await boot({ store, model: { kind: "openrouter", apiKey: SECRET } });
  t.after(() => runtime.stop());
  for (const agent of app.agents.values()) assert.doesNotMatch(JSON.stringify(agent), new RegExp(SECRET));
  const manifest = await call("GET", "/.well-known/boring.json");
  assert.doesNotMatch(JSON.stringify(manifest.body), new RegExp(SECRET));
  // A run against the real provider would need the network: start one and let it fail; the failure carries no secret either.
  const started = (await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body;
  const run = await settled(started.id);
  assert.doesNotMatch(JSON.stringify(run), new RegExp(SECRET));
  assert.doesNotMatch(JSON.stringify(await events(`/runs/${run.id}/events`)), new RegExp(SECRET));
  await runtime.stop();
  for (const file of [store, `${store}.flue`]) assert.doesNotMatch(readFileSync(file, "latin1"), new RegExp(SECRET), `${file} holds the secret`);
});
