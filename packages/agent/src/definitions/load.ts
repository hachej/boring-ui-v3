/**
 * Loaders for the standard definition files an application ships:
 *
 *   agents/<name>/agent.md        front matter (name, title, model, effort, max_tokens, output,
 *                                 helper_tools, inputs, outputs) + system prompt
 *   agents/<name>/tool.json       the output tool (name, description, input schema) when output: tool
 *   agents/<name>/rules.md        editable defaults handed to buildMessage as `rules`
 *   agents/<name>/index.mjs       buildMessage(input) → string, validate(output) → output, asText(output) → string,
 *                                 optional tools(context) → helper tool definitions
 *   jobs/<name>/JOB.md            front matter (name, title, children, inputs, outputs) + description
 *   jobs/<name>/index.mjs         plan(input) → [{ agent, input }], collect(results, input) → output
 *   conversations/<name>/CONVERSATION.md   front matter (name, title, agent, history) + description
 *   conversations/<name>/index.mjs         optional context(input) → input for the agent
 *
 * `loadApp(dir)` returns the registry the runtime and the manifest are built from. Nothing here
 * runs a model; a definition grants nothing (BORING-1).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DefinitionError, field, parseFrontMatter } from "./front-matter.ts";
import type { AgentDefinition, AppRegistry, ConversationDefinition, JobDefinition, OutputTool } from "../index.ts";

const NAME = /^[a-z][a-z0-9-]*$/;
const EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;

function requireName(meta: Parameters<typeof field>[0], file: string, expected: string): string {
  const name = field(meta, file, "name", "string", true);
  if (!NAME.test(name)) throw new DefinitionError(file, `"name" must match ${NAME} (got "${name}")`);
  if (name !== expected) throw new DefinitionError(file, `"name" is "${name}" but the folder is "${expected}"`);
  return name;
}

async function importModule(dir: string, file: string): Promise<Record<string, unknown>> {
  const target = join(dir, "index.mjs");
  if (!existsSync(target)) throw new DefinitionError(file, "index.mjs is missing next to it");
  return await import(pathToFileURL(target).href) as Record<string, unknown>;
}

function readOutputTool(dir: string, file: string): OutputTool {
  const toolFile = join(dir, "tool.json");
  if (!existsSync(toolFile)) throw new DefinitionError(file, "output: tool requires tool.json next to it");
  let tool: unknown;
  try { tool = JSON.parse(readFileSync(toolFile, "utf8")); } catch (error) { throw new DefinitionError(toolFile, `invalid JSON: ${(error as Error).message}`); }
  const t = tool as Partial<OutputTool>;
  if (typeof t?.name !== "string" || typeof t.description !== "string" || typeof t.input !== "object" || t.input === null) throw new DefinitionError(toolFile, "expected { name, description, input: JSON schema }");
  if ((t.input as { type?: string }).type !== "object") throw new DefinitionError(toolFile, "input schema must be an object schema");
  return { name: t.name, description: t.description, input: t.input as Record<string, unknown> };
}

export async function loadAgentDefinition(dir: string): Promise<AgentDefinition> {
  dir = resolve(dir);
  const file = join(dir, "agent.md");
  if (!existsSync(file)) throw new DefinitionError(file, "agent.md is missing");
  const { meta, body } = parseFrontMatter(readFileSync(file, "utf8"), file);
  const name = requireName(meta, file, dir.split(/[\\/]/).pop()!);
  const title = field(meta, file, "title", "string", true);
  const model = field(meta, file, "model", "string", true);
  if (!/^[\w.-]+\/.+$/.test(model)) throw new DefinitionError(file, `"model" must be provider/model (got "${model}")`);
  const output = field(meta, file, "output", "string", true);
  if (output !== "tool" && output !== "markdown") throw new DefinitionError(file, `"output" must be tool | markdown (got "${output}")`);
  const effort = field(meta, file, "effort", "string");
  if (effort !== undefined && !(EFFORTS as readonly string[]).includes(effort)) throw new DefinitionError(file, `"effort" must be one of ${EFFORTS.join(", ")} (got "${effort}")`);
  const maxTokens = field(meta, file, "max_tokens", "number") ?? 8000;
  const helperTools = field(meta, file, "helper_tools", "list") ?? [];
  for (const tool of helperTools) if (!NAME.test(tool)) throw new DefinitionError(file, `"helper_tools" entry "${tool}" must match ${NAME}`);
  const inputs = field(meta, file, "inputs", "map") ?? {};
  const outputs = field(meta, file, "outputs", "map") ?? {};
  const description = field(meta, file, "description", "string");
  if (!body) throw new DefinitionError(file, "the system prompt (the body after the front matter) is empty");
  const tool = output === "tool" ? readOutputTool(dir, file) : null;
  const rulesFile = join(dir, "rules.md");
  const rules = existsSync(rulesFile) ? readFileSync(rulesFile, "utf8") : "";
  const module = await importModule(dir, file);
  for (const fn of ["buildMessage", "validate", "asText"]) if (typeof module[fn] !== "function") throw new DefinitionError(join(dir, "index.mjs"), `must export a function "${fn}"`);
  if (module.tools !== undefined && typeof module.tools !== "function") throw new DefinitionError(join(dir, "index.mjs"), `"tools" must be a function when exported`);
  return {
    kind: "agent", name, title, description, model, effort: effort as AgentDefinition["effort"], maxTokens, output, tool, rules, system: body, helperTools, inputs, outputs, dir,
    buildMessage: module.buildMessage as AgentDefinition["buildMessage"],
    validate: module.validate as AgentDefinition["validate"],
    asText: module.asText as AgentDefinition["asText"],
    tools: module.tools as AgentDefinition["tools"],
  };
}

export async function loadJobDefinition(dir: string, agents: ReadonlyMap<string, AgentDefinition>): Promise<JobDefinition> {
  dir = resolve(dir);
  const file = join(dir, "JOB.md");
  if (!existsSync(file)) throw new DefinitionError(file, "JOB.md is missing");
  const { meta, body } = parseFrontMatter(readFileSync(file, "utf8"), file);
  const name = requireName(meta, file, dir.split(/[\\/]/).pop()!);
  const title = field(meta, file, "title", "string", true);
  const children = field(meta, file, "children", "list");
  if (!children?.length) throw new DefinitionError(file, `"children" must list the agents this job starts, like [summarise]`);
  for (const child of children) if (!agents.has(child)) throw new DefinitionError(file, `child agent "${child}" is not defined under agents/`);
  const module = await importModule(dir, file);
  for (const fn of ["plan", "collect"]) if (typeof module[fn] !== "function") throw new DefinitionError(join(dir, "index.mjs"), `must export a function "${fn}"`);
  return {
    kind: "job", name, title, description: body, children, inputs: field(meta, file, "inputs", "map") ?? {}, outputs: field(meta, file, "outputs", "map") ?? {}, dir,
    plan: module.plan as JobDefinition["plan"], collect: module.collect as JobDefinition["collect"],
  };
}

export async function loadConversationDefinition(dir: string, agents: ReadonlyMap<string, AgentDefinition>): Promise<ConversationDefinition> {
  dir = resolve(dir);
  const file = join(dir, "CONVERSATION.md");
  if (!existsSync(file)) throw new DefinitionError(file, "CONVERSATION.md is missing");
  const { meta, body } = parseFrontMatter(readFileSync(file, "utf8"), file);
  const name = requireName(meta, file, dir.split(/[\\/]/).pop()!);
  const title = field(meta, file, "title", "string", true);
  const agent = field(meta, file, "agent", "string", true);
  if (!agents.has(agent)) throw new DefinitionError(file, `agent "${agent}" is not defined under agents/`);
  const history = field(meta, file, "history", "number") ?? 12;
  const module = existsSync(join(dir, "index.mjs")) ? await importModule(dir, file) : {};
  if (module.context !== undefined && typeof module.context !== "function") throw new DefinitionError(join(dir, "index.mjs"), `"context" must be a function when exported`);
  return { kind: "conversation", name, title, description: body, agent, history, inputs: field(meta, file, "inputs", "map") ?? {}, dir, context: module.context as ConversationDefinition["context"] };
}

function folders(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(entry => !entry.startsWith("_") && !entry.startsWith(".") && statSync(join(dir, entry)).isDirectory()).sort();
}

/** Loads `boring.json` (name, version, description), then every agent, job and conversation folder. */
export async function loadApp(dir: string): Promise<AppRegistry> {
  dir = resolve(dir);
  const file = join(dir, "boring.json");
  if (!existsSync(file)) throw new DefinitionError(file, "boring.json (name, version) is missing at the app root");
  const app = JSON.parse(readFileSync(file, "utf8")) as { name?: unknown; version?: unknown; description?: unknown };
  if (typeof app.name !== "string" || !NAME.test(app.name)) throw new DefinitionError(file, `"name" must match ${NAME}`);
  if (typeof app.version !== "string" || !app.version) throw new DefinitionError(file, `"version" is required`);
  const agents = new Map<string, AgentDefinition>();
  for (const name of folders(join(dir, "agents"))) agents.set(name, await loadAgentDefinition(join(dir, "agents", name)));
  const jobs = new Map<string, JobDefinition>();
  for (const name of folders(join(dir, "jobs"))) jobs.set(name, await loadJobDefinition(join(dir, "jobs", name), agents));
  const conversations = new Map<string, ConversationDefinition>();
  for (const name of folders(join(dir, "conversations"))) conversations.set(name, await loadConversationDefinition(join(dir, "conversations", name), agents));
  return { name: app.name, version: app.version, description: typeof app.description === "string" ? app.description : undefined, dir, agents, jobs, conversations };
}
