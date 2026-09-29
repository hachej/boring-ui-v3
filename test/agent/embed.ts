/** The embed-host example booted for tests: its operator agent declares files and page commands. */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime, loadApp, mountWire, FILE_TOOLS, type Actor, type Host, type RuntimeOptions } from "@boring/agent";
import type { Event } from "@boring/agent/wire";
import { memoryProvider, memoryReceipts, readonly, type MountTable } from "@boring/files";
import { makeHost, type Script } from "./helpers.ts";

export const embedDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../examples/embed-host");

export async function bootEmbed(options: { script: Script; host?: Partial<Host>; mounts?: (actor: Actor) => MountTable; uiTimeout?: number; allowed?: readonly string[] } = { script: () => ({ text: "done" }) }) {
  const app = await loadApp(embedDir);
  const receipts = memoryReceipts();
  const code = readonly(memoryProvider({ seed: { "README.md": "# Records\n", "docs/statuses.md": "draft, review, done" }, name: "code" }));
  const workspace = memoryProvider({ seed: { "notes/today.md": "nothing yet" }, receipts, name: "workspace" });
  const table: MountTable = { code, workspace };
  const host = makeHost({
    async mounts(actor) { return options.mounts ? options.mounts(actor) : table; },
    async allowedTools() { return options.allowed ?? [...FILE_TOOLS, "open_record", "highlight"]; },
    ...options.host,
  });
  const runtime = await createRuntime({ host, app, store: ":memory:", model: { kind: "fake", script: options.script }, uiTimeout: options.uiTimeout } satisfies RuntimeOptions);
  const wire = mountWire({ host, runtime, basePath: "/agent" });
  const call = async (method: string, route: string, body?: unknown, headers: Record<string, string> = {}) => {
    const response = await wire.fetch(new Request(`http://app.local/agent${route}`, { method, headers: { "content-type": "application/json", ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }));
    const text = await response.text();
    let parsed: any = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    return { status: response.status, body: parsed };
  };
  const events = async (route: string): Promise<Event[]> => (await (await wire.fetch(new Request(`http://app.local/agent${route}`))).text()).split("\n").filter(Boolean).map(l => JSON.parse(l) as Event);
  const settled = async (id: string) => { await runtime.idle(); return (await call("GET", `/runs/${id}`)).body; };
  return { app, host, runtime, wire, call, events, settled, receipts, workspace, code };
}
