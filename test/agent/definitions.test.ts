import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, cpSync } from "node:fs";
import path from "node:path";
import { DefinitionError, inputSchema, loadAgentDefinition, loadApp, parseFrontMatter } from "@boring/agent";
import { notesDir, tempDir } from "./helpers.ts";

const write = (dir: string, file: string, text: string) => { mkdirSync(path.dirname(path.join(dir, file)), { recursive: true }); writeFileSync(path.join(dir, file), text); };
const AGENT = (extra = "", body = "You summarise.") => `---\nname: summarise\ntitle: Summarise\nmodel: fake/summarise\noutput: markdown\n${extra}---\n\n${body}\n`;
const INDEX = 'export const buildMessage = i => String(i.note); export const validate = o => o; export const asText = o => o;';

test("front matter: scalars, inline lists, nested maps, and clear errors", () => {
  const { meta, body } = parseFrontMatter('---\nname: a\nmax_tokens: 12\nquoted: "x: y"\nhelper_tools: [one, two]\ninputs:\n  note: The note\n  when: "A date"\n---\nBody here', "f.md");
  assert.deepEqual(meta, { name: "a", max_tokens: 12, quoted: "x: y", helper_tools: ["one", "two"], inputs: { note: "The note", when: "A date" } });
  assert.equal(body, "Body here");
  assert.throws(() => parseFrontMatter("no front matter", "f.md"), /f\.md: front matter block/);
  assert.throws(() => parseFrontMatter("---\nname a\n---\n", "f.md"), /line 1: expected "key: value"/);
  assert.throws(() => parseFrontMatter("---\nname: a\nname: b\n---\n", "f.md"), /"name" is defined twice/);
  assert.throws(() => parseFrontMatter("---\nlist: [a\n---\n", "f.md"), /inline list must close/);
  assert.throws(() => parseFrontMatter("---\n  a: 1\n---\n", "f.md"), /line 1: unexpected indentation/);
});

test("inputs: a description or a typed map becomes a JSON-schema object", () => {
  const { meta } = parseFrontMatter('---\ninputs:\n  note: The note\n  count: { type: integer, description: "How many", required: true }\n  kind: { type: string, enum: [short, long], default: short }\n  notes:\n    type: array\n    items: string\n    required: true\n---\n', "f.md");
  assert.deepEqual(inputSchema(meta, "f.md"), { type: "object", properties: {
    note: { type: "string", description: "The note" },
    count: { type: "integer", description: "How many" },
    kind: { type: "string", enum: ["short", "long"], default: "short" },
    notes: { type: "array", items: { type: "string" } },
  }, required: ["count", "notes"] });
  assert.deepEqual(inputSchema({}, "f.md"), { type: "object", properties: {}, required: [] });
  assert.throws(() => inputSchema({ inputs: { a: { type: "date" } } }, "f.md"), /"inputs\.a"\.type must be one of string, number/);
  assert.throws(() => inputSchema({ inputs: { a: { typo: "x" } } }, "f.md"), /"inputs\.a": unknown field "typo"/);
  assert.throws(() => inputSchema({ inputs: { a: { type: "string", items: "string" } } }, "f.md"), /items applies to type: array only/);
  assert.throws(() => inputSchema({ inputs: "text" }, "f.md"), /"inputs" must be a block/);
});

test("loadApp returns the registry of the notes example", async () => {
  const app = await loadApp(notesDir);
  assert.equal(app.name, "notes");
  assert.deepEqual([...app.agents.keys()], ["answer", "summarise"]);
  const summarise = app.agents.get("summarise")!;
  assert.equal(summarise.output, "tool");
  assert.equal(summarise.tool?.name, "summary_save");
  assert.deepEqual(summarise.helperTools, ["lookup"]);
  assert.match(summarise.rules, /Titles are sentence case/);
  assert.match(summarise.system, /^You summarise a note/);
  assert.deepEqual(app.jobs.get("digest")!.children, ["summarise"]);
  assert.equal(app.conversations.get("questions")!.agent, "answer");
});

test("agent.md validation names the file and the field", async () => {
  const dir = tempDir();
  const at = (name: string) => path.join(dir, "agents", name);
  write(dir, "agents/summarise/agent.md", "---\nname: summarise\ntitle: S\n---\nprompt\n");
  write(dir, "agents/summarise/index.mjs", INDEX);
  await assert.rejects(loadAgentDefinition(at("summarise")), (e: DefinitionError) => e instanceof DefinitionError && /agent\.md: "model" is required/.test(e.message));
  write(dir, "agents/summarise/agent.md", AGENT().replace("output: markdown", "output: json"));
  await assert.rejects(loadAgentDefinition(at("summarise")), /"output" must be tool \| markdown \(got "json"\)/);
  write(dir, "agents/summarise/agent.md", AGENT("effort: max\n"));
  await assert.rejects(loadAgentDefinition(at("summarise")), /"effort" must be one of/);
  write(dir, "agents/summarise/agent.md", AGENT().replace("output: markdown", "output: tool"));
  await assert.rejects(loadAgentDefinition(at("summarise")), /output: tool requires tool\.json/);
  write(dir, "agents/summarise/agent.md", AGENT("", ""));
  await assert.rejects(loadAgentDefinition(at("summarise")), /system prompt .* is empty/);
  write(dir, "agents/other/agent.md", AGENT());
  write(dir, "agents/other/index.mjs", INDEX);
  await assert.rejects(loadAgentDefinition(at("other")), /"name" is "summarise" but the folder is "other"/);
  write(dir, "agents/summarise/agent.md", AGENT());
  write(dir, "agents/summarise/index.mjs", "export const buildMessage = () => ''");
  await assert.rejects(loadAgentDefinition(at("summarise")), /index\.mjs: must export a function "validate"/);
});

test("a job must name its children among the agents, and an app needs boring.json", async () => {
  const dir = tempDir();
  cpSync(notesDir, dir, { recursive: true });
  write(dir, "jobs/digest/JOB.md", "---\nname: digest\ntitle: D\nchildren: [ghost]\n---\n");
  await assert.rejects(loadApp(dir), /child agent "ghost" is not defined under agents\//);
  write(dir, "boring.json", '{ "name": "Bad Name", "version": "1" }');
  await assert.rejects(loadApp(dir), /boring\.json: "name" must match/);
});
