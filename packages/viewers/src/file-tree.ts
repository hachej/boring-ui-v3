/**
 * The file tree's behaviour: what is loaded, expanded, selected and filtered, and the tools that change it.
 * Expand, select and filter are local (`applied`); list reads through the provider; create, rename and remove
 * go through the provider's conditions and return its receipts (VIEWERS-3). A tree is not a filesystem: it
 * holds projections of `list`, and a refresh rebuilds them from the provider (BORING-4, FILES-6).
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { readonly as readOnlyProvider, type Effect, type Entry, type FileProvider, type Receipt } from "@boring/files/web";
import type { UiResult } from "@boring/chat";
import { useViewerAgent, type AgentBinding } from "./agent.ts";
import { createStore } from "./store.ts";
import { applied, call, committed, conflict, defineTool, denied, fromError, receiptEvidence, splitAddress, type ViewerTool } from "./tool.ts";

/** One row: an address (`/workspace/notes/a.md`), its name and kind, its revision when it is a file. */
export type TreeEntry = Readonly<{ address: string; name: string; kind: "file" | "dir"; revision?: string }>;
/** The nested shape a virtualised tree renders (react-arborist's `data`): only loaded directories have children. */
export type TreeNode = Readonly<{ id: string; name: string; kind: "file" | "dir"; revision?: string; readOnly: boolean; children?: readonly TreeNode[] }>;

export type FileTreeState = Readonly<{
  roots: readonly string[];
  /** Loaded directories: address → entries. A directory not in here is not loaded yet. */
  loaded: Readonly<Record<string, readonly TreeEntry[]>>;
  expanded: readonly string[];
  selected: string | null;
  filter: string;
  loading: readonly string[];
  error: string | null;
  /** The last committed change, with its receipt. */
  lastReceipt: Receipt | null;
}>;

export type FileTreeOptions = Readonly<{
  files: FileProvider;
  /** The mount roots to show, e.g. ["/workspace", "/code"]. */
  roots: readonly string[];
  /** Roots the person may not change: their provider is wrapped read-only and write tools refuse there (VIEWERS-2). */
  readOnlyRoots?: readonly string[];
  /** Everything read-only: write tools are not offered at all. */
  readOnly?: boolean;
  /** Who the page acts for, as the host knows it. A server transport (httpFiles) ignores it and attributes from the session. */
  effect?: Effect;
  /** Called when a file is selected, by the person or the agent: the host opens it. */
  onOpen?: (entry: TreeEntry) => void;
}>;

const nameOf = (address: string) => address.split("/").filter(Boolean).at(-1) ?? address;
const parentOf = (address: string) => address.slice(0, address.lastIndexOf("/")) || "/";
const rootOf = (roots: readonly string[], address: string) => roots.find(r => address === r || address.startsWith(`${r}/`));

export function createFileTree(options: FileTreeOptions) {
  const { roots, onOpen } = options;
  const effect: Effect = options.effect ?? { actor: "page" };
  const readOnlyRoots = new Set(options.readOnly ? roots : options.readOnlyRoots ?? []);
  const store = createStore<FileTreeState>({ roots, loaded: {}, expanded: [], selected: null, filter: "", loading: [], error: null, lastReceipt: null });
  const providerFor = (address: string) => (readOnlyRoots.has(rootOf(roots, address) ?? "") ? readOnlyProvider(options.files) : options.files);
  const inRoots = (address: string) => typeof address === "string" && !!rootOf(roots, address.replace(/\/$/, ""));

  async function load(dir: string): Promise<readonly TreeEntry[]> {
    store.set(s => ({ loading: [...s.loading, dir] }));
    try {
      const at = splitAddress(dir);
      const entries = (await options.files.list(at)).map((e: Entry): TreeEntry => ({ address: `/${at.mount}/${e.path}`, name: nameOf(e.path), kind: e.kind, ...(e.ref ? { revision: e.ref.revision } : {}) }));
      entries.sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind === "dir" ? -1 : 1));
      store.set(s => ({ loaded: { ...s.loaded, [dir]: entries }, loading: s.loading.filter(d => d !== dir), error: null }));
      return entries;
    } catch (error) {
      // A missing directory (an empty mount, a removed folder) shows as empty; anything else is an error on the tree.
      const result = fromError(error);
      store.set(s => ({ loaded: { ...s.loaded, [dir]: [] }, loading: s.loading.filter(d => d !== dir), error: result.outcome === "conflict" ? s.error : String((result.detail as { reason?: string })?.reason ?? result.detail) }));
      return [];
    }
  }
  /** Re-lists every loaded directory: what the provider says now, nothing kept from before (BORING-4). */
  async function refresh() { await Promise.all(Object.keys(store.get().loaded).map(load)); }
  const findEntry = (address: string) => Object.values(store.get().loaded).flat().find(e => e.address === address);
  const reloadAround = async (...addresses: string[]) => { for (const dir of new Set(addresses.map(parentOf))) if (store.get().loaded[dir] || roots.includes(dir)) await load(dir); };

  const tools: ViewerTool[] = [
    defineTool<{ path: string }>({
      name: "expand", effect: "local", description: "Expand a directory of the tree, loading its entries if needed.",
      input: { type: "object", properties: { path: { type: "string", description: "A directory address, e.g. /workspace/notes" } }, required: ["path"], additionalProperties: false },
      run: async ({ path }) => {
        if (!inRoots(path)) return denied(`${path} is not under ${roots.join(", ")}`);
        const entries = store.get().loaded[path] ?? await load(path);
        store.set(s => ({ expanded: s.expanded.includes(path) ? s.expanded : [...s.expanded, path] }));
        return applied({ expanded: path, entries: entries.length });
      },
    }),
    defineTool<{ path: string }>({
      name: "collapse", effect: "local", description: "Collapse a directory of the tree.",
      input: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
      run: ({ path }) => { store.set(s => ({ expanded: s.expanded.filter(p => p !== path) })); return applied({ collapsed: path }); },
    }),
    defineTool<{ path: string }>({
      name: "select", effect: "local", description: "Select an entry; selecting a file opens it for the person.",
      input: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
      run: async ({ path }) => {
        if (!inRoots(path)) return denied(`${path} is not under ${roots.join(", ")}`);
        if (!store.get().loaded[parentOf(path)]) await load(parentOf(path));
        const entry = findEntry(path);
        if (!entry) return conflict({ reason: `${path} is not in the tree` });
        const ancestors: string[] = [];
        for (let dir = parentOf(path); inRoots(dir); dir = parentOf(dir)) { ancestors.push(dir); if (roots.includes(dir)) break; }
        store.set(s => ({ selected: path, expanded: [...new Set([...s.expanded, ...ancestors])] }));
        if (entry.kind === "file") onOpen?.(entry);
        return applied({ selected: path, kind: entry.kind });
      },
    }),
    defineTool<{ query: string }>({
      name: "filter", effect: "local", description: "Show only loaded entries whose name contains the query; an empty query clears the filter.",
      input: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false },
      run: ({ query }) => { store.set({ filter: query }); return applied({ filter: query, matches: visibleEntries().length }); },
    }),
    defineTool<{ path: string }>({
      name: "list", effect: "read", description: "List a directory through the file provider: names, kinds and revisions.",
      input: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
      run: async ({ path }) => {
        if (!inRoots(path)) return denied(`${path} is not under ${roots.join(", ")}`);
        const entries = await load(path);
        return applied({ path, entries: entries.map(e => ({ path: e.address, kind: e.kind, ...(e.revision ? { revision: e.revision } : {}) })) });
      },
    }),
    defineTool<{ path: string; content?: string }>({
      name: "create", effect: "write", description: "Create a file (it must not exist). Returns the receipt.",
      input: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path"], additionalProperties: false },
      run: async ({ path, content = "" }) => {
        if (!inRoots(path)) return denied(`${path} is not under ${roots.join(", ")}`);
        const receipt = await providerFor(path).write(splitAddress(path), content, { create: true }, effect);
        store.set({ lastReceipt: receipt });
        await reloadAround(path);
        return committed(receipt, { path, revision: receipt.after });
      },
    }),
    defineTool<{ from: string; to: string; revision: string }>({
      name: "rename", effect: "write", description: "Rename a file at the revision you saw: creates the new address, then removes the old one. Two receipts.",
      input: { type: "object", properties: { from: { type: "string" }, to: { type: "string" }, revision: { type: "string" } }, required: ["from", "to", "revision"], additionalProperties: false },
      run: async ({ from, to, revision }) => {
        if (!inRoots(from) || !inRoots(to)) return denied("both addresses must be under the tree's roots");
        const source = providerFor(from), target = providerFor(to);
        const read = await source.read(splitAddress(from), { revision });
        const created = await target.write(splitAddress(to), read.content, { create: true }, effect);
        try {
          const removed = await source.remove(splitAddress(from), revision, effect);
          store.set(s => ({ lastReceipt: removed, selected: s.selected === from ? to : s.selected }));
          await reloadAround(from, to);
          return { outcome: "committed", detail: { from, to, revision: created.after }, evidence: { receipts: [receiptEvidence(created), receiptEvidence(removed)] } };
        } catch (error) {
          // The source changed under us: undo the copy so the rename left nothing behind, and report the refusal.
          await target.remove(splitAddress(to), created.after!, effect).catch(() => {});
          await reloadAround(from, to);
          return fromError(error);
        }
      },
    }),
    defineTool<{ path: string; revision: string }>({
      name: "remove", effect: "write", description: "Remove a file at the revision you saw (from list). Returns the receipt.",
      input: { type: "object", properties: { path: { type: "string" }, revision: { type: "string" } }, required: ["path", "revision"], additionalProperties: false },
      run: async ({ path, revision }) => {
        if (!inRoots(path)) return denied(`${path} is not under ${roots.join(", ")}`);
        const receipt = await providerFor(path).remove(splitAddress(path), revision, effect);
        store.set(s => ({ lastReceipt: receipt, selected: s.selected === path ? null : s.selected }));
        await reloadAround(path);
        return committed(receipt, { path, removed: true });
      },
    }),
  ].filter(t => !(options.readOnly && t.effect === "write"));

  function visibleEntries(): TreeEntry[] {
    const { loaded, filter } = store.get();
    const q = filter.trim().toLowerCase();
    return Object.values(loaded).flat().filter(e => !q || e.name.toLowerCase().includes(q));
  }

  /** The nested data a virtualised tree renders, filtered: a directory stays when a loaded descendant matches. */
  function nodes(state: FileTreeState = store.get()): TreeNode[] {
    const q = state.filter.trim().toLowerCase();
    const build = (dir: string): TreeNode[] => (state.loaded[dir] ?? []).flatMap(entry => {
      const children = entry.kind === "dir" ? build(entry.address) : undefined;
      const matches = !q || entry.name.toLowerCase().includes(q) || !!children?.length;
      if (!matches) return [];
      const readOnly = readOnlyRoots.has(rootOf(roots, entry.address) ?? "");
      return [{ id: entry.address, name: entry.name, kind: entry.kind, readOnly, ...(entry.revision ? { revision: entry.revision } : {}), ...(entry.kind === "dir" ? { children: children ?? [] } : {}) }];
    });
    return roots.map(root => ({ id: root, name: root.slice(1), kind: "dir" as const, readOnly: readOnlyRoots.has(root), children: build(root) }));
  }

  const byName = (name: string) => tools.find(t => t.name === name);
  const run = (name: string, input: Record<string, unknown>): Promise<UiResult> => { const tool = byName(name); return tool ? call(tool, input) : Promise.resolve(denied(`${name} is not offered on this tree`)); };
  return {
    store, tools, nodes, refresh, load,
    /** The person's controls: the same tools the agent calls (VIEWERS-1). */
    actions: {
      expand: (path: string) => run("expand", { path }),
      collapse: (path: string) => run("collapse", { path }),
      toggle: (path: string) => run(store.get().expanded.includes(path) ? "collapse" : "expand", { path }),
      select: (path: string) => run("select", { path }),
      filter: (query: string) => run("filter", { query }),
      create: (path: string, content?: string) => run("create", content === undefined ? { path } : { path, content }),
      rename: (from: string, to: string, revision: string) => run("rename", { from, to, revision }),
      remove: (path: string, revision: string) => run("remove", { path, revision }),
    },
    async start() { await Promise.all(roots.map(async root => { await load(root); store.set(s => ({ expanded: [...new Set([...s.expanded, root])] })); })); },
  };
}

export type FileTree = ReturnType<typeof createFileTree>;

export type UseFileTreeOptions = FileTreeOptions & Readonly<{
  agent?: AgentBinding;
  /** Tool names are `<namespace>_<tool>` for the agent; "tree" by default. */
  namespace?: string;
  /** Re-list loaded directories on this interval (ms), so changes made elsewhere (the agent's file tools) appear. */
  refreshInterval?: number;
}>;

export function useFileTree(options: UseFileTreeOptions) {
  const key = `${options.roots.join(",")}|${(options.readOnlyRoots ?? []).join(",")}|${options.readOnly ? 1 : 0}`;
  const onOpen = options.onOpen;
  const latestOpen = useMemo(() => ({ current: onOpen }), []);
  latestOpen.current = onOpen;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- a new root set or provider is a new tree (a new binding, UI-BOUNDARY-4)
  const tree = useMemo(() => createFileTree({ ...options, onOpen: entry => latestOpen.current?.(entry) }), [key, options.files]);
  const state = useSyncExternalStore(tree.store.subscribe, tree.store.get, tree.store.get);
  useEffect(() => { void tree.start(); }, [tree]);
  useEffect(() => {
    if (!options.refreshInterval) return;
    const timer = setInterval(() => { void tree.refresh(); }, options.refreshInterval);
    return () => clearInterval(timer);
  }, [tree, options.refreshInterval]);
  const nodes = useMemo(() => tree.nodes(state), [tree, state]);
  const { page } = useViewerAgent(tree.tools, { agent: options.agent, namespace: options.namespace ?? "tree", target: { kind: "file-tree", id: options.roots.join(",") } });
  return { state, nodes, tools: tree.tools, actions: tree.actions, refresh: tree.refresh, page, tree };
}
