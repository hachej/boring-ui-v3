import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRuntime, loadApp, mountWire, DefinitionError, type FakeRequest } from "@boring/agent";
import { lookupTool, makeHost, notesDir, tempDir, type Script } from "./helpers.ts";

/** The notes example with a `researcher` agent that `answer` may delegate to. */
function appWithResearcher(options: { answerSubagents?: string; researcherSubagents?: string } = {}) {
  const dir = tempDir();
  cpSync(notesDir, dir, { recursive: true });
  const answer = path.join(dir, "agents/answer/agent.md");
  writeFileSync(answer, readFileSync(answer, "utf8").replace("output: markdown\n", `output: markdown\nsubagents: ${options.answerSubagents ?? "[researcher]"}\n`));
  const researcher = path.join(dir, "agents/researcher");
  mkdirSync(researcher, { recursive: true });
  writeFileSync(path.join(researcher, "agent.md"), [
    "---", "name: researcher", "title: Researcher", "description: Looks a term up and reports what it found.",
    "model: openrouter/openai/gpt-4o-mini", "effort: low", "output: markdown", "helper_tools: [lookup]",
    ...(options.researcherSubagents ? [`subagents: ${options.researcherSubagents}`] : []),
    "inputs:", "  text: the task", "---", "", "You look terms up with the lookup tool and report what you found in one sentence.", "",
  ].join("\n"));
  writeFileSync(path.join(researcher, "index.mjs"), "export const buildMessage = input => String(input.text ?? \"\");\nexport const validate = x => x;\nexport const asText = x => String(x);\n");
  return dir;
}

const lastContent = (request: FakeRequest) => request.messages.at(-1)?.content ?? "";

/** answer delegates once to researcher, which calls lookup, then answers from the task's result. */
const delegating: Script = request => {
  if (request.model === "fake/researcher") {
    if (request.messages.some(m => m.role === "tool")) return { text: "Found: aphid is a sample definition." };
    return { toolCalls: [{ name: "lookup", arguments: { term: "aphid" } }] };
  }
  if (request.messages.some(m => m.role === "tool")) return { text: `Answer from the delegate: ${lastContent(request).slice(0, 80)}` };
  return { toolCalls: [{ name: "task", arguments: { agent: "researcher", prompt: "Look up the term aphid and report the definition." } }] };
};

async function bootWith(dir: string, script: Script, host = makeHost()) {
  const app = await loadApp(dir);
  const seen: string[] = [];
  const runtime = await createRuntime({ host, app, tools: [lookupTool], store: ":memory:", model: { kind: "fake", script: request => { seen.push(request.model); return script(request); } } });
  const wire = mountWire({ host, runtime, basePath: "/agent" });
  const call = async (method: string, route: string, body?: unknown) => {
    const response = await wire.fetch(new Request(`http://app.local/agent${route}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }));
    return { status: response.status, body: await response.json().catch(() => null) as any };
  };
  const settled = async (id: string) => { await runtime.idle(); return (await call("GET", `/runs/${id}`)).body; };
  return { runtime, host, call, settled, seen };
}

test("AGENT-17: a declared subagent runs on its own model with its own tools, inside the parent's run", async t => {
  const { runtime, host, call, settled, seen } = await bootWith(appWithResearcher(), delegating);
  t.after(() => runtime.stop());
  const run = await settled((await call("POST", "/agents/answer/runs", { inputs: { text: "What is an aphid?" } })).body.id);
  assert.equal(run.status, "completed", JSON.stringify(run));
  assert.ok(seen.includes("fake/researcher"), `the delegate ran on its own model (models seen: ${seen.join(", ")})`);
  const receipts = runtime.store.receiptsOf(run.id);
  assert.deepEqual(receipts.map(r => [r.tool, r.ok]), [["lookup", true]], "the delegate's tool call is admitted and receipted under the parent run");
  const rows = runtime.store.usageOf(run.id);
  assert.ok(rows.some(r => r.agent === "researcher" && r.model === "fake/researcher"), `the delegate's model calls are metered under its name (rows: ${JSON.stringify(rows.map(r => [r.agent, r.model]))})`);
  assert.ok(rows.some(r => r.agent === "answer"), "the parent's own calls are metered too");
  assert.ok(host.usage.some(u => u.agent === "researcher"), "the host receives the delegate's usage");
});

test("AGENT-17: a delegate is offered only the tools the host allows this actor", async t => {
  const host = makeHost({ async allowedTools() { return []; } });
  const { runtime, call, settled } = await bootWith(appWithResearcher(), delegating, host);
  t.after(() => runtime.stop());
  const run = await settled((await call("POST", "/agents/answer/runs", { inputs: { text: "What is an aphid?" } })).body.id);
  assert.equal(runtime.store.receiptsOf(run.id).filter(r => r.ok).length, 0, "no lookup ran: the host does not allow it");
});

test("AGENT-17: delegation is predeclared and one level deep", async () => {
  await assert.rejects(loadApp(appWithResearcher({ answerSubagents: "[nobody]" })), (error: unknown) => error instanceof DefinitionError && /not an agent of this app/.test((error as Error).message));
  await assert.rejects(loadApp(appWithResearcher({ answerSubagents: "[answer]" })), (error: unknown) => error instanceof DefinitionError && /cannot name the agent itself/.test((error as Error).message));
  await assert.rejects(loadApp(appWithResearcher({ researcherSubagents: "[answer]" })), (error: unknown) => error instanceof DefinitionError && /one level deep/.test((error as Error).message));
});
