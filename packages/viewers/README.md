# @boring/viewers

Headless viewers: one hook per experience holds its behaviour and its typed tools. The person's controls and the agent call the same tools (VIEWERS-1); data goes through a `FileProvider` from `@boring/files` (in a page, `httpFiles` over the application's `fileRoutes`); the agent reaches a viewer only through `@boring/chat`'s page-command bridge. No styling: the look is the [registry](../../registry/README.md)'s, copied into the application with `npx shadcn add`.

Laws: [INVARIANTS.md](INVARIANTS.md). Evidence: [VERIFY.json](VERIFY.json). Contract: [src/index.ts](src/index.ts).

```tsx
import { httpFiles } from "@boring/files/web";
import { useMarkdownDocument } from "@boring/viewers";

const files = httpFiles({ endpoint: "/files" });
const { state, actions, tools } = useMarkdownDocument({ files, address: "/workspace/notes/plan.md", agent: { client, thread } });
// state: saved revision, buffer, dirty, conflict, proposals, headings, selection…
// actions: edit, save, reload, overwrite, accept(proposal), reject, goToHeading…  (the person's controls)
// tools:   the same operations as ViewerTools; with `agent` they are registered as page commands `markdown_*`
```

Every hook also exists without React (`createFileTree`, `createMarkdownDocument`, `createImage`, `createCanvasDocument`, `createWorkspaceLayout`) for tests and scripts.

## The tools

A tool's name reaches the agent as `<namespace>_<name>` (namespaces `tree`, `markdown`, `image`, `canvas`, `workspace` by default); the agent's definition lists the ones it may request under `ui:` and the host allows them by name. Each result is one of `applied` (local), `proposed` (waits for the person), `committed` (with the provider's receipt), `stale`, `conflict`, `denied`, `unavailable` (VIEWERS-3).

| Hook | Tool | Effect | Result |
|---|---|---|---|
| `useFileTree` | `expand`, `collapse`, `select`, `filter` | local | `applied` |
| | `list` | read | `applied` with entries and revisions |
| | `create` | write (`{ create: true }`) | `committed` + receipt, `conflict` if it exists |
| | `rename` | write (create the new address, remove the old at its revision) | `committed` + two receipts; the copy is undone on a conflict |
| | `remove` | write (at the revision seen) | `committed` + receipt, `conflict` when stale |
| `useMarkdownDocument` | `go_to_heading` | local | `applied`, `denied` for an unknown heading |
| | `get_selection`, `read_document` | read (what the person sees: buffer, revision, dirty, headings) | `applied` |
| | `propose_patch` | proposal (exact `find`/`replace` edits, shown as a diff) | `proposed`; only the person's accept saves (VIEWERS-6) |
| | `apply_patch` | write (bound to the revision read) | `committed` + receipt; `stale` at another revision; `conflict` while the person has unsaved edits |
| `useImage` | `zoom`, `pan`, `fit`, `annotate` | local (a highlight is temporary) | `applied` |
| | `describe` | read (metadata only, never pixels) | `applied` |
| `useCanvasDocument` | `get_shapes` | read (shapes, selection, canvas `version`, file revision) | `applied` |
| | `select` | local | `applied`, `denied` for an unknown id |
| | `create_shapes` | write (geo, text, note; optional `version` guard), saved at the revision read | `committed` + receipt and the new ids |
| | `update_shapes` | write (by id, bound to the `version` read), saved | `committed` + receipt; `stale` at another version; `conflict` over the person's unsaved changes |
| `useWorkspaceLayout` | `open_panel(target, kind?)` | local (focuses an open panel instead of duplicating it) | `applied`, `denied` for a kind the app did not register |
| | `close_panel`, `focus_panel` | local | `applied`, `denied` for an unknown panel |
| | `list_panels` | read | `applied` with panels and the active one |
| | (the layout file) | write, autosaved at the revision read (`/workspace/.boring/layout.json` in the example) | `committed` + receipt; a stale save sets `conflict` |

A read-only viewer (`readOnly`, or a read-only root of the tree) gets a provider that refuses every mutation and offers no `write` tool (VIEWERS-2). Saving writes at the revision last read; a stale save sets `state.conflict` for the conflict banner and changes nothing (VIEWERS-5).

## Images and the text contract

The file contract carries text. An SVG shows from its text; a raster stored as a `data:image/…;base64,` URL shows as is; any other raster file needs `source(address, revision)`, a URL the application serves. A byte-level provider operation is not in the contract yet.

## The canvas and its engine

`useCanvasDocument` never imports a drawing engine: the component attaches one through the `CanvasEditor` adapter (shapes, selection, create, update, snapshot, load, the person's changes). The registry's canvas item attaches tldraw. The file is `{ "format": "boring-canvas", "version": 1, "document": <engine snapshot> }`.

## One stream per page

Every bound viewer registers its own page instance, but they share one live stream of the thread (`followThread`): a browser holds about six HTTP/1.1 connections per host, and a stream per viewer would starve the page's own requests.
