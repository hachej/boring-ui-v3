/** Shared by the agent tests: the notes example loaded with the fake provider, a scriptable host, and a wire client. */
import { mkdirSync, mkdtempSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime, loadApp, mountWire, type Actor, type FakeReply, type FakeRequest, type Host, type ModelAccess, type Run, type RuntimeOptions, type ToolDefinition, type Usage } from "@boring/agent";
import type { Event } from "@boring/agent/wire";

export const notesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../examples/notes");
/** Under the repository (.cache is ignored) so that a copied example still resolves @boring/agent. */
export const tempDir = () => { const cache = path.resolve(notesDir, "../../.cache"); mkdirSync(cache, { recursive: true }); return mkdtempSync(path.join(cache, "agent-test-")); };

export type Script = (request: FakeRequest) => FakeReply | Promise<FakeReply>;

/** A script that calls the summariser's output tool with a valid summary, and answers questions in text. */
export const goodScript: Script = request => {
  if (request.outputTool) return { toolCalls: [{ name: request.outputTool, arguments: { title: "A note", summary: "It says something.", tags: ["note"] } }] };
  return { text: `Answer to: ${request.messages.at(-1)?.content.split("# Question").pop()?.trim() ?? ""}` };
};

export type HostOverrides = Partial<Host> & { actor?: Actor | null };

export function makeHost(overrides: HostOverrides = {}): Host & { usage: Usage[]; actor: Actor | null } {
  const usage: Usage[] = [];
  const host = {
    usage,
    actor: overrides.actor === undefined ? { id: "ana", roles: ["member"] } : overrides.actor,
    async resolveActor(request: unknown): Promise<Actor | null> {
      const id = (request as Request).headers?.get("x-test-actor");
      return id ? { id, roles: ["member"] } : host.actor;
    },
    async mayRequest() { return true; },
    async isActive(_run: Run) { return true; },
    async mounts() { return {}; },
    async allowedTools() { return ["lookup", "note_write"]; },
    async mayAnswer() { return true; },
    async onUsage(row: Usage) { usage.push(row); },
    ...overrides,
  };
  return host;
}

export const lookupTool: ToolDefinition = {
  name: "lookup", description: "Look up a term.", input: { type: "object", properties: { term: { type: "string" } }, required: ["term"] },
  handler: async input => `${(input as { term: string }).term}: a sample definition`,
};

export async function boot(options: { script?: Script; host?: Host; tools?: readonly ToolDefinition[]; store?: string; model?: ModelAccess; models?: RuntimeOptions["models"]; maxConcurrent?: number } = {}) {
  const app = await loadApp(notesDir);
  const host = (options.host ?? makeHost()) as ReturnType<typeof makeHost>;
  const runtime = await createRuntime({ host, app, tools: options.tools ?? [lookupTool], store: options.store ?? ":memory:", model: options.model ?? { kind: "fake", script: options.script ?? goodScript }, models: options.models, maxConcurrent: options.maxConcurrent });
  const wire = mountWire({ host, runtime, basePath: "/agent" });
  const call = async (method: string, route: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await wire.fetch(new Request(`http://app.local/agent${route}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await response.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed };
  };
  const events = async (route: string): Promise<Event[]> => {
    const response = await wire.fetch(new Request(`http://app.local/agent${route}`));
    const text = await response.text();
    return text.split("\n").filter(Boolean).map(line => JSON.parse(line) as Event);
  };
  const settled = async (id: string) => { await runtime.idle(); return (await call("GET", `/runs/${id}`)).body; };
  return { app, host, runtime, wire, call, events, settled };
}
