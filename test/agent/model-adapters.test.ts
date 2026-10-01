// AGENT-16: every ModelAccess kind has exactly one model adapter in the runtime's table, each
// adapter's providers route the models the runtime asks for, a real provider reports usage on
// its response (so AGENT-10 can meter it), and a credential never appears in what the adapter
// returns. The real providers run against a local double of their API (`baseUrl`); their live
// run is the deferral in packages/agent/VERIFY.json.
import test from "node:test";
import assert from "node:assert/strict";
import { createServer, type IncomingMessage } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createModels } from "@earendil-works/pi-ai";
import { MODEL_ADAPTERS } from "../../packages/agent/src/adapters/models/index.ts";
import { providersFor } from "../../packages/agent/src/runtime/providers.ts";
import type { ModelAccess } from "../../packages/agent/src/index.ts";

const KINDS: readonly ModelAccess["kind"][] = ["fake", "openrouter", "openai-codex"];
const SECRET = "sk-conformance-0123456789";

/** A double of the OpenAI chat-completions API: one streamed text answer with usage, and the requests it saw. */
async function completionsDouble(t: test.TestContext) {
  const seen: { path: string; authorization: string | undefined; body: Record<string, unknown> }[] = [];
  const read = (req: IncomingMessage) => new Promise<string>(resolve => { let s = ""; req.on("data", c => { s += c; }); req.on("end", () => resolve(s)); });
  const server = createServer(async (req, res) => {
    const body = JSON.parse((await read(req)) || "{}");
    seen.push({ path: req.url ?? "", authorization: req.headers.authorization, body });
    res.writeHead(200, { "content-type": "text/event-stream" });
    const chunk = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
    chunk({ id: "c1", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: { role: "assistant", content: "conformant" }, finish_reason: null }] });
    chunk({ id: "c1", object: "chat.completion.chunk", created: 1, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
    chunk({ id: "c1", object: "chat.completion.chunk", created: 1, model: body.model, choices: [], usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 } });
    res.end("data: [DONE]\n\n");
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const { port } = server.address() as { port: number };
  return { url: `http://127.0.0.1:${port}/v1`, seen };
}

test("AGENT-16: the runtime's table has one adapter per ModelAccess kind, each serving its own kind", () => {
  assert.deepEqual(Object.keys(MODEL_ADAPTERS).sort(), [...KINDS].sort());
  for (const kind of KINDS) assert.equal(MODEL_ADAPTERS[kind].kind, kind);
  assert.throws(() => providersFor({ kind: "nope" } as never, [], []), /no model adapter for kind nope/);
});

test("AGENT-16: the fake adapter routes every agent to fake/<agent> and needs no credential", () => {
  const { providers, modelFor } = providersFor({ kind: "fake", script: () => ({ text: "x" }) }, ["summarise"], []);
  assert.equal(providers.length, 1);
  assert.equal(providers[0]!.id, "fake");
  assert.equal(modelFor("summarise", "openrouter/some/model"), "fake/summarise");
});

test("AGENT-16: the openrouter adapter answers through its provider with the host's key and reports usage", async t => {
  const double = await completionsDouble(t);
  const { providers, modelFor } = providersFor({ kind: "openrouter", apiKey: SECRET, baseUrl: double.url }, ["a"], []);
  assert.equal(modelFor("a", "openrouter/anthropic/claude-sonnet-4.5"), "openrouter/anthropic/claude-sonnet-4.5", "the declared model is kept");
  assert.ok(!JSON.stringify(providers).includes(SECRET), "the key is not in the provider's data (AGENT-7)");
  const models = createModels();
  for (const p of providers) models.setProvider(p);
  const model = models.getModel("openrouter", "anthropic/claude-sonnet-4.5");
  assert.ok(model, "the catalog model is served by the adapter's provider");
  const message = await models.complete(model, { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] });
  assert.equal(message.stopReason, "stop", message.errorMessage);
  assert.deepEqual(message.content.filter(c => c.type === "text").map(c => (c as { text: string }).text), ["conformant"]);
  assert.equal(message.usage.input, 11, "usage is reported on the response");
  assert.equal(message.usage.output, 3);
  assert.equal(double.seen.length, 1);
  assert.equal(double.seen[0]!.authorization, `Bearer ${SECRET}`, "the key goes only to the provider's endpoint");
});

test("AGENT-16: the openai-codex adapter reads its credentials file at request time and refuses without a login", async t => {
  const dir = mkdtempSync(path.join(tmpdir(), "codex-conformance-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const double = await completionsDouble(t);
  const { providers, modelFor } = providersFor({ kind: "openai-codex", credentialsFile: path.join(dir, "auth.json"), baseUrl: double.url }, ["a"], []);
  assert.equal(providers.length, 1);
  assert.equal(providers[0]!.id, "openai-codex");
  assert.equal(modelFor("a", "openai-codex/gpt-6-astra"), "openai-codex/gpt-6-astra");
  const models = createModels();
  for (const p of providers) models.setProvider(p);
  const model = models.getModel("openai-codex", "gpt-6-astra");
  assert.ok(model, "the catalog model is served by the adapter's provider");
  const message = await models.complete(model, { messages: [{ role: "user", content: "hello", timestamp: Date.now() }] }).catch((error: Error) => ({ stopReason: "error", errorMessage: error.message }));
  assert.equal(message.stopReason, "error");
  assert.match(String(message.errorMessage), /Codex login unavailable/);
  assert.equal(double.seen.length, 0, "nothing leaves without a credential");
});

test("AGENT-16: a real adapter refuses to start without its credential", () => {
  assert.throws(() => providersFor({ kind: "openrouter", apiKey: "" }, [], []), /API key is required/);
  assert.throws(() => providersFor({ kind: "openai-codex", credentialsFile: "" }, [], []), /credentials file is required/);
});
