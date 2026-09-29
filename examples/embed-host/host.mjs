// The application's side of the Host contract. This app already has users (a header its own server
// trusts, standing in for its session), records and a status rule; the library asks it every question
// (AGENT-8) and decides nothing itself. Mounts: /code is the app's own folder, read-only; /workspace is
// the person's, in memory here (a real app would give each actor their own directory or store).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FILE_TOOLS } from "@boring/agent";
import { directoryProvider, memoryProvider, memoryReceipts, readonly } from "@boring/files";

const dir = path.dirname(fileURLToPath(import.meta.url));

/** The existing application: records with a status that only moves forward, versioned per record. */
export function createRecords() {
  const rows = new Map([["r1", { id: "r1", title: "Onboarding", status: "draft", version: 1 }], ["r2", { id: "r2", title: "Quarterly review", status: "review", version: 1 }], ["r3", { id: "r3", title: "Launch", status: "done", version: 2 }]]);
  const order = ["draft", "review", "done"];
  return {
    list: () => [...rows.values()],
    get: id => rows.get(id) ?? null,
    /** The app's one mutation: bound to the version the caller observed (UI-BOUNDARY-3, -4). */
    setStatus(id, status, expectedVersion, by) {
      const row = rows.get(id);
      if (!row) return { outcome: "denied", detail: "no such record" };
      if (row.version !== expectedVersion) return { outcome: "conflict", detail: { current: row.version } };
      if (order.indexOf(status) <= order.indexOf(row.status)) return { outcome: "denied", detail: "a status only moves forward" };
      rows.set(id, { ...row, status, version: row.version + 1 });
      return { outcome: "committed", evidence: { id, version: row.version + 1, by } };
    },
  };
}

export function createHost({ records, log = () => {} }) {
  const code = readonly(directoryProvider({ root: path.join(dir, "code") }));
  const workspaces = new Map();
  const receipts = memoryReceipts();
  const workspaceOf = actor => { if (!workspaces.has(actor.id)) workspaces.set(actor.id, memoryProvider({ receipts, name: `workspace-${actor.id}` })); return workspaces.get(actor.id); };
  const host = {
    async resolveActor(request) {
      const id = request.headers.get("x-dev-actor");
      return id ? { id, roles: id === "admin" ? ["admin"] : ["member"] } : null;
    },
    async mayRequest() { return true; },
    async isActive() { return true; },
    async mounts(actor) { return { code, workspace: workspaceOf(actor) }; },
    // Page commands are allowed by name like any tool; the app decides per role (AGENT-9).
    async allowedTools(actor) { return [...FILE_TOOLS, "list_records", "open_record", "highlight", ...(actor.roles.includes("admin") ? ["set_status"] : [])]; },
    async mayAnswer() { return true; },
    async onUsage(usage) { log(usage); },
  };
  /** Backend tools: admitted operations over the app's own data; the handler gets issued operations, never the store (AGENT-2). */
  const tools = [
    { name: "list_records", description: "The records of this application.", input: { type: "object", properties: {} }, handler: async () => ({ records: records.list() }) },
    { name: "set_status", description: "Move a record to a status, at the version you saw.", mutates: true, input: { type: "object", properties: { id: { type: "string" }, status: { type: "string", enum: ["draft", "review", "done"] }, version: { type: "integer" } }, required: ["id", "status", "version"] },
      handler: async ({ id, status, version }, operations) => records.setStatus(id, status, version, operations.effect.actor) },
  ];
  return { host, tools, receipts, workspaceOf, code };
}
