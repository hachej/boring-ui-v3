/**
 * The canvas document's behaviour: a whiteboard persisted as one file (`.tldraw`, JSON) through the provider, with
 * the tools an agent uses to read and change it. The drawing engine (tldraw in the registry item) is attached as a
 * `CanvasEditor` adapter; this module never imports it. Every change bumps the canvas `version`; a tool that changes
 * shapes names the version it read (UI-BOUNDARY-4) and its change is saved at the file revision the canvas read,
 * returning the receipt (VIEWERS-3). A stale save is a conflict the person resolves (VIEWERS-5).
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { isFileError, readonly as readOnlyProvider, type Effect, type FileProvider, type Receipt } from "@boring/files/web";
import type { UiResult } from "@boring/chat";
import { useViewerAgent, type AgentBinding } from "./agent.ts";
import { createStore } from "./store.ts";
import { applied, committed, conflict, defineTool, denied, fromError, splitAddress, stale, type ViewerTool } from "./tool.ts";

export const CANVAS_COLORS = ["black", "grey", "light-violet", "violet", "blue", "light-blue", "yellow", "orange", "green", "light-green", "light-red", "red", "white"] as const;
export const CANVAS_TYPES = ["geo", "text", "note"] as const;
export const CANVAS_GEO = ["rectangle", "ellipse", "triangle", "diamond", "star", "cloud", "hexagon"] as const;

/** A shape as the tools see it: the engine's shape reduced to what an agent needs to reason about. */
export type CanvasShape = Readonly<{ id: string; type: string; x: number; y: number; w?: number; h?: number; text?: string; color?: string; geo?: string }>;
export type NewShape = Readonly<{ type: (typeof CANVAS_TYPES)[number]; x: number; y: number; w?: number; h?: number; text?: string; color?: (typeof CANVAS_COLORS)[number]; geo?: (typeof CANVAS_GEO)[number] }>;
export type ShapeUpdate = Readonly<{ id: string; x?: number; y?: number; w?: number; h?: number; text?: string; color?: (typeof CANVAS_COLORS)[number] }>;

/** What the drawing engine gives the hook. Changes made through `create`, `update` and `load` are not the person's. */
export interface CanvasEditor {
  shapes(): readonly CanvasShape[];
  selection(): readonly string[];
  select(ids: readonly string[]): void;
  create(shapes: readonly NewShape[]): readonly string[];
  update(updates: readonly ShapeUpdate[]): void;
  /** The document to persist (JSON-serialisable). */
  snapshot(): unknown;
  /** Replace the document; null is an empty canvas. */
  load(document: unknown | null): void;
  /** The person changed the document. */
  onChange(listener: () => void): () => void;
  setReadOnly?(readOnly: boolean): void;
}

export const CANVAS_FORMAT = "boring-canvas";
export const serializeCanvas = (document: unknown) => `${JSON.stringify({ format: CANVAS_FORMAT, version: 1, document }, null, 1)}\n`;
export function parseCanvas(content: string): unknown | null {
  if (!content.trim()) return null;
  const parsed = JSON.parse(content) as { format?: string; document?: unknown };
  if (parsed.format !== CANVAS_FORMAT) throw new Error(`not a ${CANVAS_FORMAT} file`);
  return parsed.document ?? null;
}

export type CanvasState = Readonly<{
  address: string;
  status: "loading" | "ready" | "missing" | "error";
  saved: Readonly<{ content: string; revision: string }> | null;
  /** Bumped on every change of the document, whoever made it. */
  version: number;
  dirty: boolean;
  saving: boolean;
  conflict: Readonly<{ current: string | null }> | null;
  attached: boolean;
  shapes: number;
  readOnly: boolean;
  error: string | null;
  lastReceipt: Receipt | null;
}>;

export type CanvasOptions = Readonly<{ files: FileProvider; address: string; readOnly?: boolean; effect?: Effect }>;

const shapeSchema = {
  type: "object",
  properties: { type: { type: "string", enum: [...CANVAS_TYPES] }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" }, text: { type: "string" }, color: { type: "string", enum: [...CANVAS_COLORS] }, geo: { type: "string", enum: [...CANVAS_GEO] } },
  required: ["type", "x", "y"], additionalProperties: false,
};
const updateSchema = {
  type: "object",
  properties: { id: { type: "string" }, x: { type: "number" }, y: { type: "number" }, w: { type: "number" }, h: { type: "number" }, text: { type: "string" }, color: { type: "string", enum: [...CANVAS_COLORS] } },
  required: ["id"], additionalProperties: false,
};

export function createCanvasDocument(options: CanvasOptions) {
  const { address } = options;
  const at = splitAddress(address);
  const files = options.readOnly ? readOnlyProvider(options.files) : options.files;
  const effect: Effect = options.effect ?? { actor: "page" };
  const store = createStore<CanvasState>({ address, status: "loading", saved: null, version: 0, dirty: false, saving: false, conflict: null, attached: false, shapes: 0, readOnly: !!options.readOnly, error: null, lastReceipt: null });
  let editor: CanvasEditor | null = null;
  let loaded: unknown | null = null;
  let detach: (() => void) | null = null;
  const count = () => editor?.shapes().length ?? 0;

  async function load() {
    try {
      const { ref, content } = await files.read(at);
      loaded = parseCanvas(content);
      editor?.load(loaded);
      store.set(s => ({ status: "ready", saved: { content, revision: ref.revision }, version: s.version + 1, dirty: false, conflict: null, error: null, shapes: count() }));
    } catch (error) {
      if (isFileError(error, "missing")) store.set({ status: "missing", error: `${address} does not exist` });
      else store.set({ status: "error", error: (error as Error).message });
    }
  }

  async function save(expected: string | null = store.get().saved?.revision ?? null): Promise<UiResult> {
    if (store.get().readOnly) return denied({ reason: "read-only" });
    if (!editor) return { outcome: "unavailable", detail: { reason: "the canvas is not mounted" } };
    if (!expected) return conflict({ reason: "the canvas was never read" });
    const content = serializeCanvas(editor.snapshot());
    const version = store.get().version;
    store.set({ saving: true });
    try {
      const receipt = await files.write(at, content, { expectedRevision: expected }, effect);
      store.set(s => ({ saving: false, saved: { content, revision: receipt.after! }, dirty: s.version !== version, conflict: null, lastReceipt: receipt }));
      return committed(receipt, { path: address, revision: receipt.after, version });
    } catch (error) {
      store.set({ saving: false, ...(isFileError(error, "conflict") ? { conflict: { current: error.error.code === "conflict" ? error.error.current : null } } : {}), ...(isFileError(error, "readonly") ? { readOnly: true } : {}) });
      return fromError(error);
    }
  }

  const changed = () => store.set(s => ({ version: s.version + 1, dirty: true, shapes: count() }));
  const ready = (): UiResult | null => (!editor ? { outcome: "unavailable", detail: { reason: "the canvas is not mounted" } } : store.get().status !== "ready" ? { outcome: "unavailable", detail: { status: store.get().status } } : null);

  /** A change by a tool: bound to the version it read, refused over the person's unsaved work, then saved. */
  async function change(version: number | undefined, work: (e: CanvasEditor) => UiResult | unknown): Promise<UiResult> {
    const s = store.get();
    if (version !== undefined && version !== s.version) return stale({ reason: "the canvas changed since you read it", requested: version, current: s.version });
    if (s.dirty) return conflict({ reason: "the person has unsaved changes on the canvas" });
    const out = work(editor!);
    if (out && typeof out === "object" && "outcome" in (out as object)) return out as UiResult;
    changed();
    const result = await save();
    return result.outcome === "committed" ? { ...result, detail: { ...(result.detail as object), ...(out as object) } } : result;
  }

  const tools: ViewerTool[] = [
    defineTool({
      name: "get_shapes", effect: "read", description: "The shapes on the canvas (id, type, position, size, text, colour), the selection, the canvas version and the file revision.",
      input: { type: "object", properties: {}, additionalProperties: false },
      run: () => ready() ?? applied({ path: address, revision: store.get().saved?.revision ?? null, version: store.get().version, dirty: store.get().dirty, shapes: editor!.shapes(), selection: editor!.selection() }),
    }),
    defineTool<{ ids: string[] }>({
      name: "select", effect: "local", description: "Select shapes by id (an empty list clears the selection).",
      input: { type: "object", properties: { ids: { type: "array", items: { type: "string" } } }, required: ["ids"], additionalProperties: false },
      run: ({ ids }) => {
        const r = ready(); if (r) return r;
        const known = new Set(editor!.shapes().map(s => s.id));
        const unknown = ids.filter(id => !known.has(id));
        if (unknown.length) return denied({ reason: "unknown shapes", ids: unknown });
        editor!.select(ids);
        return applied({ selected: ids });
      },
    }),
    defineTool<{ shapes: NewShape[]; version?: number }>({
      name: "create_shapes", effect: "write", description: "Add shapes (geo boxes, text, sticky notes) and save the canvas. Pass the version from get_shapes to refuse if the canvas changed meanwhile.",
      input: { type: "object", properties: { shapes: { type: "array", items: shapeSchema }, version: { type: "integer" } }, required: ["shapes"], additionalProperties: false },
      run: async ({ shapes, version }) => {
        const r = ready(); if (r) return r;
        if (!shapes.length) return denied({ reason: "no shapes" });
        return change(version, e => ({ created: e.create(shapes) }));
      },
    }),
    defineTool<{ updates: ShapeUpdate[]; version: number }>({
      name: "update_shapes", effect: "write", description: "Move, resize, recolour or retext shapes by id, bound to the canvas version you read (get_shapes), and save.",
      input: { type: "object", properties: { updates: { type: "array", items: updateSchema }, version: { type: "integer" } }, required: ["updates", "version"], additionalProperties: false },
      run: async ({ updates, version }) => {
        const r = ready(); if (r) return r;
        const known = new Set(editor!.shapes().map(s => s.id));
        const unknown = updates.map(u => u.id).filter(id => !known.has(id));
        if (unknown.length) return denied({ reason: "unknown shapes", ids: unknown });
        return change(version, e => { e.update(updates); return { updated: updates.map(u => u.id) }; });
      },
    }),
  ].filter(t => !(options.readOnly && t.effect === "write"));

  return {
    store, tools, load,
    /** The drawing engine mounts: it shows what was read and reports the person's changes. */
    attach(next: CanvasEditor) {
      detach?.();
      editor = next;
      editor.setReadOnly?.(store.get().readOnly);
      if (store.get().status === "ready") editor.load(loaded);
      const off = editor.onChange(() => { if (!store.get().readOnly) changed(); });
      store.set({ attached: true, shapes: count() });
      detach = () => { off(); editor = null; store.set({ attached: false }); };
      return () => { detach?.(); detach = null; };
    },
    actions: {
      save: () => save(),
      reload: () => load(),
      async overwrite(): Promise<UiResult> {
        const current = await files.stat(at).catch(() => null);
        if (!current) return conflict({ reason: "the file no longer exists" });
        return save(current.revision);
      },
      dismissConflict() { store.set({ conflict: null }); },
    },
  };
}

export type CanvasDocument = ReturnType<typeof createCanvasDocument>;
export type UseCanvasOptions = CanvasOptions & Readonly<{ agent?: AgentBinding; namespace?: string; /** Save the person's changes after this many ms without one. */ autosave?: number }>;

export function useCanvasDocument(options: UseCanvasOptions) {
  const doc = useMemo(() => createCanvasDocument(options), [options.address, options.files, options.readOnly]);
  const state = useSyncExternalStore(doc.store.subscribe, doc.store.get, doc.store.get);
  useEffect(() => { void doc.load(); }, [doc]);
  useEffect(() => {
    if (!options.autosave || !state.dirty || state.conflict || state.saving) return;
    const timer = setTimeout(() => { void doc.actions.save(); }, options.autosave);
    return () => clearTimeout(timer);
  }, [doc, options.autosave, state.dirty, state.version, state.conflict, state.saving]);
  const { page } = useViewerAgent(doc.tools, { agent: options.agent, namespace: options.namespace ?? "canvas", target: { kind: "canvas", id: options.address } });
  return { state, tools: doc.tools, actions: doc.actions, attach: doc.attach, page, doc };
}
