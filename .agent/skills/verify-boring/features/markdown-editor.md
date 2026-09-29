# Markdown editor

The markdown-editor item (Tiptap 3, MIT core) over `useMarkdownDocument`, with the conflict banner and proposal diffs. In the registry host it opens `.md`/`.txt` files; `/code` files open read-only. Laws: VIEWERS-1..6, UI-BOUNDARY-4/5.

## Sub-features

- edit and save: typing changes the buffer (`unsaved`); Save (or Ctrl/Cmd+S) writes at the revision read → `saved · r<rev>`.
- stale save: another writer saved first → the conflict banner; Reload theirs / Overwrite with mine (at the revision now seen) / Keep editing. Nothing is overwritten silently.
- agent tools: `markdown_read_document` (content as the person sees it, revision, dirty, headings), `markdown_get_selection`, `markdown_go_to_heading` (scrolls and flashes the heading), `markdown_propose_patch` (a diff with Accept/Reject; saves nothing), `markdown_apply_patch` (at the revision read; `stale` at another, `conflict` while the person has unsaved edits).
- accept: only the person; saves at the proposal's base and carries the receipt; a proposal the buffer moved past is `stale`.
- MD toggle: the raw markdown in a textarea, same buffer.
- read-only: badge, no toolbar, no Save, no `apply_patch` tool.
- fidelity: the editor emits only on the person's own edits; opening a file never rewrites it.

## How to get to it (user POV)

Open `/workspace/notes/plan.md`; ask the assistant "name a risk in my plan"; accept the proposal above the text.

## Driving it with boring

```bash
node bin/boring.mjs env up --example registry-host
node bin/boring.mjs goto "/?open=/workspace/notes/plan.md" && node bin/boring.mjs wait-for ".boring-prose h2" && node bin/boring.mjs thread --from-page
node bin/boring.mjs send "name a risk in my plan" --wait          # read_document → propose_patch: proposed
node bin/boring.mjs wait-for "[data-boring=proposal]" && node bin/boring.mjs click "[data-boring=proposal] button:has-text('Accept')"
node bin/boring.mjs wait-for "[data-boring=save-state]:has-text('saved · r')"
node bin/boring.mjs send "go to Notes" --wait                      # go_to_heading: applied
node bin/boring.mjs send "apply a risk" --wait                     # apply_patch at the revision read: committed (receipt in the tool output)
```

Observed: the proposal shows `Name two risks · agent · 3 lines`; after Accept `saved · r5`; the tool-call badges read `applied`, `proposed`, `committed`. The stale-save path is driven in `test/registry/browser.test.ts` (another writer via the host's provider, then Save): the banner shows and the file keeps the other writer's content until Overwrite.

## Gotchas

- Tiptap normalises markdown on the first edit (list markers, spacing); that is the buffer from then on.
- `apply_patch` while you have unsaved edits is refused by design (`conflict`): propose instead.
- Two markdown editors on one thread: the runtime offers a command name once; the first registered page wins. Use `namespace` to tell them apart.
