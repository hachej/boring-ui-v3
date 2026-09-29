/**
 * The markdown document's behaviour: the saved revision, the person's buffer, proposals, selection and the
 * tools over them. The editor (Tiptap in the registry item) renders the buffer and reports edits and selection;
 * it holds no truth. Saving writes at the revision last read: a stale save is a conflict the person resolves
 * (VIEWERS-5), never an overwrite. An agent's patch is a proposal the person accepts, or an apply bound to the
 * revision it read; neither replaces the person's unsaved work (UI-BOUNDARY-4).
 */
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { isFileError, readonly as readOnlyProvider, type Effect, type FileProvider, type Receipt } from "@boring/files/web";
import type { UiResult } from "@boring/chat";
import { useViewerAgent, type AgentBinding } from "./agent.ts";
import { createStore } from "./store.ts";
import { applied, call, committed, conflict, defineTool, denied, fromError, proposed, splitAddress, stale, type ViewerTool } from "./tool.ts";
import { applyEdits, diffLines, headingsOf, type DiffLine, type Edit, type Heading } from "./text.ts";

export type Proposal = Readonly<{ id: string; summary: string; edits: readonly Edit[]; baseVersion: number; baseRevision: string | null; before: string; after: string; diff: readonly DiffLine[]; from: "agent" | "person" }>;
export type Selection = Readonly<{ from: number; to: number; text: string }>;

export type MarkdownState = Readonly<{
  address: string;
  status: "loading" | "ready" | "missing" | "error";
  /** What the provider holds: content and revision as last read or written. */
  saved: Readonly<{ content: string; revision: string }> | null;
  /** The person's buffer and its local version (bumped on every change of the buffer). */
  buffer: string;
  version: number;
  dirty: boolean;
  saving: boolean;
  /** A save was refused because the file changed: the person reloads, overwrites or keeps editing (ConflictBanner). */
  conflict: Readonly<{ current: string | null }> | null;
  proposals: readonly Proposal[];
  selection: Selection | null;
  headings: readonly Heading[];
  /** The last navigation asked of the editor; `seq` changes each time so the same heading can be asked twice. */
  navigation: Readonly<{ heading: Heading; seq: number }> | null;
  readOnly: boolean;
  error: string | null;
  lastReceipt: Receipt | null;
}>;

export type MarkdownOptions = Readonly<{
  files: FileProvider;
  /** `/workspace/notes/plan.md` */
  address: string;
  /** The person may not change this document: the provider is wrapped read-only and write tools are not offered (VIEWERS-2). */
  readOnly?: boolean;
  effect?: Effect;
}>;

let proposalSeq = 0;
const editsSchema = { type: "array", items: { type: "object", properties: { find: { type: "string", description: "Exact text to replace; must occur once" }, replace: { type: "string" } }, required: ["find", "replace"], additionalProperties: false } };

export function createMarkdownDocument(options: MarkdownOptions) {
  const { address } = options;
  const at = splitAddress(address);
  const files = options.readOnly ? readOnlyProvider(options.files) : options.files;
  const effect: Effect = options.effect ?? { actor: "page" };
  const store = createStore<MarkdownState>({ address, status: "loading", saved: null, buffer: "", version: 0, dirty: false, saving: false, conflict: null, proposals: [], selection: null, headings: [], navigation: null, readOnly: !!options.readOnly, error: null, lastReceipt: null });
  let navSeq = 0;

  const setBuffer = (buffer: string, extra: Partial<MarkdownState> = {}) => store.set(s => ({ buffer, version: s.version + 1, headings: headingsOf(buffer), dirty: buffer !== (extra.saved ?? s.saved)?.content, ...extra }));

  async function load() {
    try {
      const { ref, content } = await files.read(at);
      setBuffer(content, { status: "ready", saved: { content, revision: ref.revision }, conflict: null, error: null, dirty: false });
    } catch (error) {
      if (isFileError(error, "missing")) store.set({ status: "missing", error: `${address} does not exist` });
      else store.set({ status: "error", error: (error as Error).message });
    }
  }

  /** Writes `content` at the revision the document last read. The only effect path, for the person and the agent (UI-BOUNDARY-3). */
  async function write(content: string, expected: string | null = store.get().saved?.revision ?? null): Promise<UiResult> {
    if (store.get().readOnly) return denied({ reason: "read-only" });
    if (!expected) return conflict({ reason: "the document was never read" });
    store.set({ saving: true });
    try {
      const receipt = await files.write(at, content, { expectedRevision: expected }, effect);
      store.set(s => ({ saving: false, saved: { content, revision: receipt.after! }, dirty: s.buffer !== content, conflict: null, lastReceipt: receipt }));
      return committed(receipt, { path: address, revision: receipt.after });
    } catch (error) {
      const result = fromError(error);
      store.set({ saving: false, ...(isFileError(error, "conflict") ? { conflict: { current: error.error.code === "conflict" ? error.error.current : null } } : {}), ...(isFileError(error, "readonly") ? { readOnly: true } : {}) });
      return result;
    }
  }

  function propose(edits: readonly Edit[], summary: string, from: Proposal["from"]): UiResult {
    const s = store.get();
    const result = applyEdits(s.buffer, edits);
    if (!result.ok) return denied({ reason: result.reason, edit: result.edit });
    const proposal: Proposal = { id: `p${++proposalSeq}`, summary, edits, baseVersion: s.version, baseRevision: s.saved?.revision ?? null, before: s.buffer, after: result.text, diff: diffLines(s.buffer, result.text), from };
    store.set(state => ({ proposals: [...state.proposals, proposal] }));
    return proposed({ proposal: proposal.id, summary, changes: proposal.diff.filter(l => l.kind !== "same").length, awaiting: "the person accepts or rejects it in the editor" });
  }

  const tools: ViewerTool[] = [
    defineTool<{ heading: string }>({
      name: "go_to_heading", effect: "local", description: "Scroll the editor to a heading, by its text or id (see read_document's headings).",
      input: { type: "object", properties: { heading: { type: "string" } }, required: ["heading"], additionalProperties: false },
      run: ({ heading }) => {
        const found = store.get().headings.find(h => h.id === heading || h.text.toLowerCase() === heading.toLowerCase());
        if (!found) return denied({ reason: `no heading "${heading}"`, headings: store.get().headings.map(h => h.text) });
        store.set({ navigation: { heading: found, seq: ++navSeq } });
        return applied({ heading: found.text, id: found.id });
      },
    }),
    defineTool({
      name: "get_selection", effect: "read", description: "The text the person has selected in the editor, if any.",
      input: { type: "object", properties: {}, additionalProperties: false },
      run: () => applied({ selection: store.get().selection }),
    }),
    defineTool({
      name: "read_document", effect: "read", description: "The document as the person sees it: content, the revision it was read at, whether it has unsaved edits, and its headings.",
      input: { type: "object", properties: {}, additionalProperties: false },
      run: () => {
        const s = store.get();
        if (s.status !== "ready") return { outcome: "unavailable", detail: { status: s.status, error: s.error } };
        return applied({ path: address, revision: s.saved?.revision ?? null, version: s.version, dirty: s.dirty, content: s.buffer, headings: s.headings.map(h => ({ id: h.id, level: h.level, text: h.text })) });
      },
    }),
    defineTool<{ edits: Edit[]; summary?: string }>({
      name: "propose_patch", effect: "proposal", description: "Propose exact edits, shown to the person as a diff to accept or reject. Nothing is saved until they accept.",
      input: { type: "object", properties: { edits: editsSchema, summary: { type: "string" } }, required: ["edits"], additionalProperties: false },
      run: ({ edits, summary = "" }) => (store.get().status === "ready" ? propose(edits, summary, "agent") : { outcome: "unavailable", detail: { status: store.get().status } }),
    }),
    defineTool<{ edits: Edit[]; revision: string }>({
      name: "apply_patch", effect: "write", description: "Apply exact edits and save, bound to the revision you read (read_document). A changed file is stale; unsaved edits by the person are a conflict.",
      input: { type: "object", properties: { edits: editsSchema, revision: { type: "string" } }, required: ["edits", "revision"], additionalProperties: false },
      run: async ({ edits, revision }) => {
        const s = store.get();
        if (s.saved?.revision !== revision) return stale({ reason: "the document is at another revision", requested: revision, current: s.saved?.revision ?? null });
        if (s.dirty) return conflict({ reason: "the person has unsaved edits; propose the patch instead" });
        const result = applyEdits(s.buffer, edits);
        if (!result.ok) return denied({ reason: result.reason, edit: result.edit });
        const saved = await write(result.text, revision);
        if (saved.outcome === "committed") setBuffer(result.text, { dirty: false });
        return saved;
      },
    }),
  ].filter(t => !(options.readOnly && t.effect === "write"));

  const byName = (name: string) => tools.find(t => t.name === name);
  return {
    store, tools, load,
    actions: {
      /** The person typed: the buffer changes, nothing is saved. */
      edit(text: string) { if (store.get().readOnly || text === store.get().buffer) return; setBuffer(text); },
      select(selection: Selection | null) { store.set({ selection: selection && selection.to > selection.from ? selection : null }); },
      save: () => write(store.get().buffer),
      /** Discard the buffer and read what the provider holds now. */
      reload: () => load(),
      /** The person chose to keep their version: save it over the current revision, which they have now seen. */
      async overwrite(): Promise<UiResult> {
        const current = await files.stat(at).catch(() => null);
        if (!current) return conflict({ reason: "the file no longer exists" });
        return write(store.get().buffer, current.revision);
      },
      dismissConflict() { store.set({ conflict: null }); },
      goToHeading: (heading: string) => call(byName("go_to_heading")!, { heading }),
      propose: (edits: readonly Edit[], summary = "") => propose(edits, summary, "person"),
      /** The person accepts: apply to the buffer and save at the revision the proposal saw. Only the person can (UI-BOUNDARY-5). */
      async accept(id: string): Promise<UiResult> {
        const s = store.get();
        const proposal = s.proposals.find(p => p.id === id);
        if (!proposal) return denied({ reason: `no proposal ${id}` });
        const result = applyEdits(s.buffer, proposal.edits);
        if (!result.ok) return stale({ reason: "the document changed and the proposal no longer applies", proposal: id });
        store.set(state => ({ proposals: state.proposals.filter(p => p.id !== id) }));
        setBuffer(result.text);
        if (s.readOnly) return applied({ proposal: id, saved: false });
        return write(result.text);
      },
      reject(id: string) { store.set(s => ({ proposals: s.proposals.filter(p => p.id !== id) })); return applied({ rejected: id }); },
    },
  };
}

export type MarkdownDocument = ReturnType<typeof createMarkdownDocument>;

export type UseMarkdownOptions = MarkdownOptions & Readonly<{ agent?: AgentBinding; namespace?: string }>;

export function useMarkdownDocument(options: UseMarkdownOptions) {
  // Another address or provider is another document: a new binding, and requests for the old one answer stale (UI-BOUNDARY-4).
  const doc = useMemo(() => createMarkdownDocument(options), [options.address, options.files, options.readOnly]);
  const state = useSyncExternalStore(doc.store.subscribe, doc.store.get, doc.store.get);
  useEffect(() => { void doc.load(); }, [doc]);
  const { page } = useViewerAgent(doc.tools, { agent: options.agent, namespace: options.namespace ?? "markdown", target: { kind: "markdown", id: options.address } });
  return { state, tools: doc.tools, actions: doc.actions, page, doc };
}
