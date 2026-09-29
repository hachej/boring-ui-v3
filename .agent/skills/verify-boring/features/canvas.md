# Canvas

The canvas item (tldraw 5) over `useCanvasDocument`: a whiteboard persisted as one `.tldraw` JSON file through the file routes; autosave after 1.2 s idle, Save, and the conflict banner on a stale save. In the registry host, `/workspace/boards/plan.tldraw`. Laws: VIEWERS-1..5, UI-BOUNDARY-4.

## Sub-features

- read: `canvas_get_shapes` returns shapes (id, type, x, y, w, h, text, colour, geo), the selection, the canvas `version` and the file revision.
- local: `canvas_select` by ids.
- write: `canvas_create_shapes` (geo boxes, text, sticky notes) and `canvas_update_shapes` (move, resize, recolour, retext), each bound to the `version` read, applied as remote changes (not the person's) and saved at the revision read → `committed` with the receipt.
- refusals: an old `version` is `stale`; over the person's unsaved drawing `conflict`; an unknown id `denied`; no canvas mounted `unavailable`.
- the person: draws with tldraw's tools; the change marks the canvas unsaved; autosave or Save writes at the revision read; a stale save shows the conflict banner.
- licence: `licenseKey` from the app's runtime config (`TLDRAW_LICENSE_KEY` → `/config.json`); none needed on localhost.

## How to get to it (user POV)

Open `boards/plan.tldraw` in the tree; draw; ask the assistant "draw the plan", then "move it".

## Driving it with boring

```bash
node bin/boring.mjs env up --example registry-host
node bin/boring.mjs goto "/?open=/workspace/boards/plan.tldraw" && node bin/boring.mjs wait-for "[data-boring=canvas] .tl-container" && node bin/boring.mjs thread --from-page
node bin/boring.mjs send "draw the plan" --wait      # get_shapes → create_shapes: committed (revision 6)
node bin/boring.mjs send "move it" --wait            # get_shapes → update_shapes at the version read: committed (revision 7)
node bin/boring.mjs screenshot .cache/evidence/<time>/canvas.png
curl -s "<url>/files/read?path=/workspace/boards/plan.tldraw" | head -c 300   # the tldraw document under "document"
```

Observed: `The canvas change was committed (revision 6)`, then `(revision 7)`; the file's `document.store` holds the two shapes.

## Gotchas

- tldraw keeps its own undo history; an undo after an agent change is the person's change (it marks the canvas unsaved).
- The canvas must be mounted for its tools: an agent request before the page shows it answers `unavailable`.
- `version` changes on every change to the document, the person's included, and on every load; read it with `get_shapes` right before `update_shapes`.
