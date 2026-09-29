/**
 * Files for a run: the grants a definition's `files:` needs become against the host's mount table, the
 * guard that confines a run's operations to those grants, and the file tools the model is offered.
 * Tools address `/mount/path`; a tool's arguments can name a file, never a mount the grants do not
 * cover (BORING-1). Every mutation returns the provider's receipt: mount, path, revision before and after.
 */
import { FileProviderError, formatAddress, isFileError, mountRouter, parseAddress, type FileAddress, type FileProvider, type MountTable } from "@boring/files";
import type { Grant, ToolDefinition } from "../index.ts";

/** What an agent declares it needs: a mount (or `*` for every mount the host offers) and a mode. */
export type FileNeed = Readonly<{ mount: string | "*"; mode: "read" | "write" }>;

/** The grants a run asks the host to admit, from the definition's needs and the mounts this actor has (AGENT-8). */
export function grantsFor(needs: readonly FileNeed[], mounts: readonly string[]): readonly Grant[] {
  const grants = new Map<string, Grant>();
  for (const need of needs) for (const mount of need.mount === "*" ? mounts : mounts.includes(need.mount) ? [need.mount] : []) grants.set(`${mount}:${need.mode}`, { mount, path: "", mode: need.mode });
  return [...grants.values()];
}

const covers = (grants: readonly Grant[], address: FileAddress, mode: "read" | "write") =>
  grants.some(g => g.mount === address.mount && g.mode === mode && (g.path === "" || address.path === g.path || address.path.startsWith(`${g.path}/`)));

/** A provider over the host's table that refuses what the grants do not cover, before any provider call (AGENT-2). */
export function guardedFiles(table: MountTable, grants: readonly Grant[]): FileProvider {
  const router = mountRouter(Object.fromEntries(Object.entries(table).filter(([mount]) => grants.some(g => g.mount === mount))));
  const need = (address: FileAddress, mode: "read" | "write") => {
    if (!covers(grants, address, mode)) throw new FileProviderError({ code: "bad-address" }, `no ${mode} grant on ${formatAddress(address)} for this run`);
  };
  return {
    async stat(address) { need(address, "read"); return router.stat(address); },
    async read(address, options) { need(address, "read"); return router.read(address, options); },
    async list(address) { need(address, "read"); return router.list(address); },
    async write(address, content, condition, effect) { need(address, "write"); return router.write(address, content, condition, effect); },
    async remove(address, expected, effect) { need(address, "write"); return router.remove(address, expected, effect); },
  };
}

export const FILE_TOOLS = ["read_file", "write_file", "list_files", "stat", "remove_file"] as const;

const pathProperty = { type: "string", description: "An address /<mount>/<path>, for example /workspace/notes/today.md" };

/** The file tools as the model sees them. Mount names in descriptions come from the run's grants. */
export function fileTools(): readonly ToolDefinition[] {
  const explain = (error: unknown) => {
    if (isFileError(error)) return `${error.code}: ${error.message}${error.error.code === "conflict" ? ` (current revision ${error.error.current ?? "none"})` : ""}`;
    throw error;
  };
  const guard = <T>(work: () => Promise<T>) => work().catch(e => ({ error: explain(e) }));
  return [
    {
      name: "read_file", description: "Read a file. Returns its content and revision; pass `revision` to read exactly that revision or fail.",
      input: { type: "object", properties: { path: pathProperty, revision: { type: "string", description: "Read this exact revision" } }, required: ["path"] },
      handler: (input, operations) => guard(async () => {
        const { path, revision } = input as { path: string; revision?: string };
        const { ref, content } = await operations.files.read(parseAddress(path, operations.mounts), revision ? { revision } : undefined);
        return { path, revision: ref.revision, content };
      }),
    },
    {
      name: "write_file", description: "Create a file (`mode: create`, the address must not exist) or update one (`mode: update` with the `revision` you read; a changed file is a conflict).",
      input: { type: "object", properties: { path: pathProperty, content: { type: "string" }, mode: { type: "string", enum: ["create", "update"] }, revision: { type: "string", description: "Required for update: the revision you observed" } }, required: ["path", "content", "mode"] },
      mutates: true,
      handler: (input, operations) => guard(async () => {
        const { path, content, mode, revision } = input as { path: string; content: string; mode: "create" | "update"; revision?: string };
        if (mode === "update" && !revision) return { error: "update needs the revision you observed" };
        const receipt = await operations.files.write(parseAddress(path, operations.mounts), content, mode === "create" ? { create: true } : { expectedRevision: revision! }, operations.effect);
        return { path, before: receipt.before, revision: receipt.after };
      }),
    },
    {
      name: "list_files", description: "List the entries of a directory. `/` lists the mounts you may use.",
      input: { type: "object", properties: { path: { ...pathProperty, description: "A directory address, or / for the mounts" } }, required: ["path"] },
      handler: (input, operations) => guard(async () => {
        const { path } = input as { path: string };
        if (path === "/" || path === "") return { entries: operations.mounts.map(mount => ({ path: `/${mount}`, kind: "dir" })) };
        const address = parseAddress(path, operations.mounts);
        return { entries: (await operations.files.list(address)).map(e => ({ path: formatAddress({ mount: address.mount, path: e.path }), kind: e.kind, ...(e.ref ? { revision: e.ref.revision } : {}) })) };
      }),
    },
    {
      name: "stat", description: "The revision of a file, or null when it does not exist.",
      input: { type: "object", properties: { path: pathProperty }, required: ["path"] },
      handler: (input, operations) => guard(async () => {
        const { path } = input as { path: string };
        const ref = await operations.files.stat(parseAddress(path, operations.mounts));
        return ref ? { path, revision: ref.revision } : null;
      }),
    },
    {
      name: "remove_file", description: "Remove a file at the revision you observed.",
      input: { type: "object", properties: { path: pathProperty, revision: { type: "string" } }, required: ["path", "revision"] },
      mutates: true,
      handler: (input, operations) => guard(async () => {
        const { path, revision } = input as { path: string; revision: string };
        const receipt = await operations.files.remove(parseAddress(path, operations.mounts), revision, operations.effect);
        return { path, before: receipt.before, removed: true };
      }),
    },
  ];
}
