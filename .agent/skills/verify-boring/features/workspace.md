# Workspace

The workspace item (dockview) over `useWorkspaceLayout`: the registry host's centre, holding the open files as panels rendered by the other items (markdown-editor, image-viewer, canvas). The open panels, the active one and dockview's layout are the person's file `/workspace/.boring/layout.json`, autosaved at the revision read. Laws: VIEWERS-1, VIEWERS-3, VIEWERS-5, BORING-4.

## Sub-features

- open: `workspace_open_panel(target, kind?)`; the kind is inferred from the extension (md/txt → markdown, images → image, .tldraw → canvas); an open panel is focused, not duplicated; an unregistered kind is `denied`. The tree's selection opens through the same tool.
- close / focus: `workspace_close_panel`, `workspace_focus_panel` by id (`<kind>:<target>`); the person's tab close and tab click go through the same operations.
- list: `workspace_list_panels`.
- persistence: every change is saved ~0.8 s later; a reload restores the panels, the active one and their positions.
- panels register their own tools while mounted; hidden tabs are unmounted, so a hidden document's tools are not offered.
- one live stream: the viewers of the page share one follow of the thread.

## How to get to it (user POV)

Click files in the tree: each opens a tab; drag tabs to split; close a tab with its ×. Ask the assistant "show /workspace/notes/plan.md", "panels", "close".

## Driving it with boring

```bash
node bin/boring.mjs env up --example registry-host && node bin/boring.mjs wait-for "[data-boring=workspace]" && node bin/boring.mjs thread --from-page
node bin/boring.mjs send "show /workspace/notes/plan.md" --wait     # workspace_open_panel: applied
node bin/boring.mjs wait-for "[data-boring=panel] .boring-prose h2"
node bin/boring.mjs send "name a risk in my plan" --wait            # the panel's markdown tools
node bin/boring.mjs wait-for "[data-boring=proposal]" && node bin/boring.mjs click "[data-boring=proposal] button:has-text('Accept')"
node bin/boring.mjs send "show /workspace/images/diagram.svg" --wait
node bin/boring.mjs send "write a note" --wait && node bin/boring.mjs click "[data-path='/workspace/notes']" && node bin/boring.mjs wait-for "[data-path='/workspace/notes/agent-note.md']"
node bin/boring.mjs send "panels" --wait                            # "Open panels: plan.md, diagram.svg."
node bin/boring.mjs reload && node bin/boring.mjs eval "[...document.querySelectorAll('.dv-tab')].map(t => t.textContent)"   # ["plan.md", "diagram.svg"]
```

Observed as written: every reply above, the note in the tree, and the two tabs back after the reload.

## Gotchas

- The layout file lives under `/workspace/.boring/`, so the tree shows a `.boring` folder.
- A request to a panel that was just opened needs the next turn: a run offers the page commands registered when it started.
- Two panels of one kind (two markdown files, one hidden) mount one at a time; the visible one's tools are offered.
