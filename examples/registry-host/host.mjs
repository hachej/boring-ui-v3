// The application's side of the Host contract. /code is its own folder, read-only; /workspace is the person's, in
// memory, seeded from seed/ (a real app would give each actor a directory or a store). The same mount table serves
// the agent's file tools and the page's file routes, so the tree, the editor and the agent see one revision (FILES-6).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FILE_TOOLS } from "@boring/agent";
import { directoryProvider, fileRoutes, memoryProvider, memoryReceipts, readonly, snapshotDirectory } from "@boring/files";

const dir = path.dirname(fileURLToPath(import.meta.url));

export function createHost({ app, log = () => {} }) {
  const code = readonly(directoryProvider({ root: path.join(dir, "code") }));
  const seed = snapshotDirectory(path.join(dir, "seed"));
  const receipts = memoryReceipts();
  const workspaces = new Map();
  const workspaceOf = actor => { if (!workspaces.has(actor.id)) workspaces.set(actor.id, memoryProvider({ seed, receipts, name: `workspace-${actor.id}` })); return workspaces.get(actor.id); };
  const pageTools = [...(app.agents.get("assistant")?.uiCommands ?? [])];
  const host = {
    async resolveActor(request) {
      const id = request.headers.get("x-dev-actor");
      return id ? { id, roles: ["member"] } : null;
    },
    async mayRequest() { return true; },
    async isActive() { return true; },
    async mounts(actor) { return { code, workspace: workspaceOf(actor) }; },
    // The viewers' tools are allowed by name like any tool; the application decides (AGENT-3). apply_patch included:
    // the assistant may write directly at the revision it read; it is told to prefer proposing.
    async allowedTools() { return [...FILE_TOOLS, ...pageTools]; },
    async mayAnswer() { return true; },
    async onUsage(usage) { log(usage); },
  };
  // The page's file routes: the session names the actor and the mounts, never the request (BORING-1).
  const files = fileRoutes({ basePath: "/files", resolve: async request => { const actor = await host.resolveActor(request); return actor ? { mounts: await host.mounts(actor), effect: { actor: actor.id, tool: "page" } } : null; } });
  return { host, files, receipts, workspaceOf, code };
}
