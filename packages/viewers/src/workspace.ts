/**
 * The workspace's behaviour: which panels are open (each a viewer kind on a target), which is active, and the
 * docking layout, persisted per person as one file through the provider. The docking engine (dockview in the
 * registry item) renders panels and reports the person's moves; it holds no truth (BORING-4). Opening, closing and
 * focusing are local (`applied`) and the same tools for the person (the tree, a tab's close button) and the agent;
 * saving the layout is a write at the revision read, with its receipt (VIEWERS-3, VIEWERS-5).
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { isFileError, type Effect, type FileProvider, type Receipt } from "@boring/files/web";
import type { UiResult } from "@boring/chat";
import { useViewerAgent, type AgentBinding } from "./agent.ts";
import { createStore } from "./store.ts";
import { applied, call, committed, conflict, defineTool, denied, fromError, splitAddress, type ViewerTool } from "./tool.ts";
import { isImage } from "./image.ts";

export type Panel = Readonly<{ id: string; kind: string; target: string; title: string }>;

export type WorkspaceState = Readonly<{
  address: string;
  status: "loading" | "ready" | "error";
  panels: readonly Panel[];
  active: string | null;
  /** The docking engine's own serialised layout, opaque here. */
  grid: unknown | null;
  saved: Readonly<{ revision: string }> | null;
  dirty: boolean;
  saving: boolean;
  conflict: Readonly<{ current: string | null }> | null;
  error: string | null;
  lastReceipt: Receipt | null;
}>;

export type WorkspaceOptions = Readonly<{
  files: FileProvider;
  /** The person's layout file, e.g. `/workspace/.boring/layout.json`. */
  address: string;
  /** The panel kinds the application can render, e.g. ["markdown", "image", "canvas"]. */
  kinds: readonly string[];
  /** The kind for a target when the caller names none; by extension by default. */
  kindOf?: (target: string) => string | null;
  effect?: Effect;
}>;

export const LAYOUT_FORMAT = "boring-layout";
export const defaultKindOf = (target: string): string | null => /\.(md|markdown|txt)$/i.test(target) ? "markdown" : isImage(target) ? "image" : /\.tldraw$/i.test(target) ? "canvas" : null;
export const panelId = (kind: string, target: string) => `${kind}:${target}`;
const titleOf = (target: string) => target.split("/").filter(Boolean).at(-1) ?? target;

export function createWorkspaceLayout(options: WorkspaceOptions) {
  const { address, kinds } = options;
  const at = splitAddress(address);
  const effect: Effect = options.effect ?? { actor: "page" };
  const kindOf = options.kindOf ?? defaultKindOf;
  const store = createStore<WorkspaceState>({ address, status: "loading", panels: [], active: null, grid: null, saved: null, dirty: false, saving: false, conflict: null, error: null, lastReceipt: null });
  const serialize = () => { const s = store.get(); return `${JSON.stringify({ format: LAYOUT_FORMAT, version: 1, panels: s.panels, active: s.active, grid: s.grid }, null, 1)}\n`; };

  async function load() {
    try {
      const { ref, content } = await options.files.read(at);
      const parsed = JSON.parse(content) as { format?: string; panels?: Panel[]; active?: string | null; grid?: unknown };
      if (parsed.format !== LAYOUT_FORMAT) throw new Error(`${address} is not a ${LAYOUT_FORMAT} file`);
      const panels = (parsed.panels ?? []).filter(p => kinds.includes(p.kind));
      store.set({ status: "ready", panels, active: panels.some(p => p.id === parsed.active) ? parsed.active ?? null : panels[0]?.id ?? null, grid: parsed.grid ?? null, saved: { revision: ref.revision }, dirty: false, conflict: null, error: null });
    } catch (error) {
      // No layout yet: an empty workspace, created on the first save.
      if (isFileError(error, "missing")) store.set({ status: "ready", saved: null, dirty: false, error: null });
      else store.set({ status: "error", error: (error as Error).message });
    }
  }

  async function save(expected: string | null = store.get().saved?.revision ?? null): Promise<UiResult> {
    const content = serialize();
    store.set({ saving: true });
    try {
      const receipt = await options.files.write(at, content, expected ? { expectedRevision: expected } : { create: true }, effect);
      store.set(() => ({ saving: false, saved: { revision: receipt.after! }, dirty: serialize() !== content, conflict: null, lastReceipt: receipt }));
      return committed(receipt, { path: address, revision: receipt.after });
    } catch (error) {
      store.set({ saving: false, ...(isFileError(error, "conflict") || isFileError(error, "exists") ? { conflict: { current: isFileError(error, "conflict") && error.error.code === "conflict" ? error.error.current : null } } : {}) });
      return fromError(error);
    }
  }

  const change = (patch: Partial<WorkspaceState>) => store.set({ ...patch, dirty: true });
  const find = (id: string) => store.get().panels.find(p => p.id === id);

  const tools: ViewerTool[] = [
    defineTool<{ target: string; kind?: string }>({
      name: "open_panel", effect: "local", description: `Open a file in a panel of the workspace (or focus it if it is open). Kinds: ${kinds.join(", ")}; inferred from the extension when omitted.`,
      input: { type: "object", properties: { target: { type: "string", description: "A file address, e.g. /workspace/notes/plan.md" }, kind: { type: "string", enum: [...kinds] } }, required: ["target"], additionalProperties: false },
      run: ({ target, kind }) => {
        if (!target.startsWith("/")) return denied({ reason: "target must be an address /<mount>/<path>" });
        const k = kind ?? kindOf(target);
        if (!k || !kinds.includes(k)) return denied({ reason: `no panel kind for ${target}`, kinds });
        const id = panelId(k, target);
        if (find(id)) { change({ active: id }); return applied({ panel: id, focused: true }); }
        change({ panels: [...store.get().panels, { id, kind: k, target, title: titleOf(target) }], active: id });
        return applied({ panel: id, opened: true });
      },
    }),
    defineTool<{ id: string }>({
      name: "close_panel", effect: "local", description: "Close a panel by id (see list_panels). Unsaved work in it stays unsaved in its file's viewer until reopened.",
      input: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
      run: ({ id }) => {
        if (!find(id)) return denied({ reason: `no panel ${id}` });
        const panels = store.get().panels.filter(p => p.id !== id);
        change({ panels, active: store.get().active === id ? panels.at(-1)?.id ?? null : store.get().active });
        return applied({ closed: id });
      },
    }),
    defineTool<{ id: string }>({
      name: "focus_panel", effect: "local", description: "Bring a panel to the front by id.",
      input: { type: "object", properties: { id: { type: "string" } }, required: ["id"], additionalProperties: false },
      run: ({ id }) => { if (!find(id)) return denied({ reason: `no panel ${id}` }); change({ active: id }); return applied({ focused: id }); },
    }),
    defineTool({
      name: "list_panels", effect: "read", description: "The open panels (id, kind, target, title) and the active one.",
      input: { type: "object", properties: {}, additionalProperties: false },
      run: () => applied({ panels: store.get().panels, active: store.get().active }),
    }),
  ];

  const byName = (name: string) => tools.find(t => t.name === name)!;
  return {
    store, tools, load,
    actions: {
      open: (target: string, kind?: string) => call(byName("open_panel"), kind ? { target, kind } : { target }),
      close: (id: string) => call(byName("close_panel"), { id }),
      focus: (id: string) => call(byName("focus_panel"), { id }),
      /** The docking engine reports its layout after the person moved or resized something. */
      layout(grid: unknown) { if (JSON.stringify(grid) !== JSON.stringify(store.get().grid)) change({ grid }); },
      save: () => save(),
      reload: () => load(),
      async overwrite(): Promise<UiResult> { const current = await options.files.stat(at).catch(() => null); return current ? save(current.revision) : conflict({ reason: "the layout file no longer exists" }); },
      dismissConflict() { store.set({ conflict: null }); },
    },
  };
}

export type WorkspaceLayout = ReturnType<typeof createWorkspaceLayout>;
export type UseWorkspaceOptions = WorkspaceOptions & Readonly<{ agent?: AgentBinding; namespace?: string; /** Save the layout this many ms after a change (default 800; 0 turns it off). */ autosave?: number }>;

export function useWorkspaceLayout(options: UseWorkspaceOptions) {
  const layout = useMemo(() => createWorkspaceLayout(options), [options.address, options.files, options.kinds.join(",")]);
  const state = useSyncExternalStore(layout.store.subscribe, layout.store.get, layout.store.get);
  useEffect(() => { void layout.load(); }, [layout]);
  const autosave = options.autosave ?? 800;
  useEffect(() => {
    if (!autosave || !state.dirty || state.conflict || state.saving || state.status !== "ready") return;
    const timer = setTimeout(() => { void layout.actions.save(); }, autosave);
    return () => clearTimeout(timer);
  }, [layout, autosave, state.dirty, state.panels, state.active, state.grid, state.conflict, state.saving, state.status]);
  const { page } = useViewerAgent(layout.tools, { agent: options.agent, namespace: options.namespace ?? "workspace", target: { kind: "workspace", id: options.address } });
  return { state, tools: layout.tools, actions: layout.actions, page, layout };
}
