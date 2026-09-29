/**
 * The image viewer's behaviour: which revision is shown, zoom and pan, temporary highlights, and `describe`,
 * which returns metadata only, never pixels (UI-BOUNDARY-1: what the agent learns is what the tool says).
 * Everything here is local interaction; the viewer never writes.
 *
 * The file contract is text. An SVG is shown from its text; a raster file stored as a `data:image/…` URL is
 * shown as is; any other raster needs the host's `source(address, revision)` (a URL the application serves).
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import type { FileProvider } from "@boring/files/web";
import { useViewerAgent, type AgentBinding } from "./agent.ts";
import { createStore } from "./store.ts";
import { applied, call, defineTool, denied, fromError, splitAddress, type ViewerTool } from "./tool.ts";

export const IMAGE_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", svg: "image/svg+xml", gif: "image/gif" } as const;
export const isImage = (address: string) => (address.split(".").pop()?.toLowerCase() ?? "") in IMAGE_TYPES;

export type Annotation = Readonly<{ id: string; x: number; y: number; width: number; height: number; label?: string; until: number }>;

export type ImageState = Readonly<{
  address: string;
  status: "loading" | "ready" | "error";
  src: string | null;
  mime: string;
  revision: string | null;
  /** Natural size in image pixels, reported by the renderer once the image decoded. */
  width: number | null;
  height: number | null;
  zoom: number;
  /** Offset of the image's centre from the viewport's centre, in screen pixels. */
  pan: Readonly<{ x: number; y: number }>;
  /** `fit` asks the renderer to fit the viewport; any explicit zoom clears it. */
  fit: boolean;
  annotations: readonly Annotation[];
  error: string | null;
}>;

export type ImageOptions = Readonly<{
  files: FileProvider;
  address: string;
  /** A URL for raster content the text contract cannot carry (the application serves the bytes). */
  source?: (address: string, revision: string) => string | Promise<string>;
  /** How long a highlight stays (ms, default 4000). */
  highlightFor?: number;
  now?: () => number;
}>;

export const ZOOM = { min: 0.05, max: 32 } as const;
const clamp = (z: number) => Math.min(ZOOM.max, Math.max(ZOOM.min, z));
let annotationSeq = 0;

export function createImage(options: ImageOptions) {
  const { address } = options;
  const ext = address.split(".").pop()?.toLowerCase() ?? "";
  const mime = IMAGE_TYPES[ext as keyof typeof IMAGE_TYPES] ?? "application/octet-stream";
  const now = options.now ?? (() => Date.now());
  const store = createStore<ImageState>({ address, status: "loading", src: null, mime, revision: null, width: null, height: null, zoom: 1, pan: { x: 0, y: 0 }, fit: true, annotations: [], error: null });
  const timers = new Set<ReturnType<typeof setTimeout>>();

  async function load() {
    try {
      const { ref, content } = await options.files.read(splitAddress(address));
      let src: string;
      if (mime === "image/svg+xml" && content.trimStart().startsWith("<")) src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(content)}`;
      else if (/^data:image\/[a-z+.-]+;base64,/i.test(content.trimStart())) src = content.trim();
      else if (options.source) src = await options.source(address, ref.revision);
      else throw new Error(`${address} is binary: the host must supply source(address, revision)`);
      store.set({ status: "ready", src, revision: ref.revision, error: null });
    } catch (error) {
      const result = fromError(error);
      store.set({ status: "error", error: result.outcome === "unavailable" ? String(result.detail) : JSON.stringify(result.detail) });
    }
  }

  const tools: ViewerTool[] = [
    defineTool<{ level?: number; factor?: number }>({
      name: "zoom", effect: "local", description: "Zoom to a level (1 = actual pixels) or by a factor (2 doubles).",
      input: { type: "object", properties: { level: { type: "number" }, factor: { type: "number" } }, additionalProperties: false },
      run: ({ level, factor }) => {
        if (level === undefined && factor === undefined) return denied({ reason: "give level or factor" });
        if ((level !== undefined && level <= 0) || (factor !== undefined && factor <= 0)) return denied({ reason: "zoom must be positive" });
        const zoom = clamp(level ?? store.get().zoom * factor!);
        store.set({ zoom, fit: false });
        return applied({ zoom });
      },
    }),
    defineTool<{ x?: number; y?: number; dx?: number; dy?: number }>({
      name: "pan", effect: "local", description: "Move the view: by dx/dy screen pixels, or centre on image pixel x/y.",
      input: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, dx: { type: "number" }, dy: { type: "number" } }, additionalProperties: false },
      run: ({ x, y, dx, dy }) => {
        const s = store.get();
        let pan = s.pan;
        if (x !== undefined || y !== undefined) {
          if (s.width === null || s.height === null) return denied({ reason: "the image has not decoded yet" });
          pan = { x: ((s.width / 2) - (x ?? s.width / 2)) * s.zoom, y: ((s.height / 2) - (y ?? s.height / 2)) * s.zoom };
        } else if (dx !== undefined || dy !== undefined) pan = { x: s.pan.x + (dx ?? 0), y: s.pan.y + (dy ?? 0) };
        else return denied({ reason: "give x/y or dx/dy" });
        store.set({ pan, fit: false });
        return applied({ pan });
      },
    }),
    defineTool({
      name: "fit", effect: "local", description: "Fit the whole image in the viewport.",
      input: { type: "object", properties: {}, additionalProperties: false },
      run: () => { store.set({ fit: true, pan: { x: 0, y: 0 } }); return applied({ fit: true }); },
    }),
    defineTool<{ x: number; y: number; width: number; height: number; label?: string }>({
      name: "annotate", effect: "local", description: "Highlight a rectangle of the image (image pixels) for a few seconds, with an optional label. Temporary: nothing is saved.",
      input: { type: "object", properties: { x: { type: "number" }, y: { type: "number" }, width: { type: "number" }, height: { type: "number" }, label: { type: "string" } }, required: ["x", "y", "width", "height"], additionalProperties: false },
      run: ({ x, y, width, height, label }) => {
        if (width <= 0 || height <= 0) return denied({ reason: "width and height must be positive" });
        const s = store.get();
        if (s.width !== null && s.height !== null && (x < 0 || y < 0 || x + width > s.width || y + height > s.height)) return denied({ reason: `the rectangle leaves the image (${s.width}×${s.height})` });
        const ms = options.highlightFor ?? 4000;
        const annotation: Annotation = { id: `a${++annotationSeq}`, x, y, width, height, ...(label ? { label } : {}), until: now() + ms };
        store.set(state => ({ annotations: [...state.annotations, annotation] }));
        const timer = setTimeout(() => { timers.delete(timer); store.set(state => ({ annotations: state.annotations.filter(a => a.id !== annotation.id) })); }, ms);
        timers.add(timer);
        return applied({ annotation: annotation.id, saved: false });
      },
    }),
    defineTool({
      name: "describe", effect: "read", description: "Metadata of the image shown: path, type, revision, natural size and the current view. Never the pixels.",
      input: { type: "object", properties: {}, additionalProperties: false },
      run: () => {
        const s = store.get();
        return applied({ path: address, mime: s.mime, revision: s.revision, status: s.status, width: s.width, height: s.height, zoom: s.zoom, fit: s.fit, pan: s.pan, annotations: s.annotations.length });
      },
    }),
  ];

  const byName = (name: string) => tools.find(t => t.name === name)!;
  return {
    store, tools, load,
    actions: {
      zoom: (level: number) => call(byName("zoom"), { level }),
      zoomBy: (factor: number) => call(byName("zoom"), { factor }),
      panBy: (dx: number, dy: number) => call(byName("pan"), { dx, dy }),
      fit: () => call(byName("fit")),
      annotate: (rect: { x: number; y: number; width: number; height: number; label?: string }) => call(byName("annotate"), rect),
      /** The renderer reports the decoded size and, while fitting, the zoom it chose. */
      measured(width: number, height: number, fittedZoom?: number) { store.set(s => ({ width, height, ...(s.fit && fittedZoom ? { zoom: fittedZoom } : {}) })); },
    },
    dispose() { for (const t of timers) clearTimeout(t); timers.clear(); },
  };
}

export type ImageViewer = ReturnType<typeof createImage>;
export type UseImageOptions = ImageOptions & Readonly<{ agent?: AgentBinding; namespace?: string }>;

export function useImage(options: UseImageOptions) {
  const image = useMemo(() => createImage(options), [options.address, options.files]);
  const state = useSyncExternalStore(image.store.subscribe, image.store.get, image.store.get);
  useEffect(() => { void image.load(); return () => image.dispose(); }, [image]);
  const { page } = useViewerAgent(image.tools, { agent: options.agent, namespace: options.namespace ?? "image", target: { kind: "image", id: options.address } });
  return { state, tools: image.tools, actions: image.actions, page, image };
}
