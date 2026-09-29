# File tree

The file-tree item over `useFileTree` (`@boring/viewers`), in the registry host's left column over `/workspace` and `/code` (read-only). Virtualised (react-arborist). Laws: VIEWERS-1..3, BORING-4, FILES-6.

## Sub-features

- local: expand/collapse a folder (loads it), select a file (opens it in the host), filter loaded entries (a folder stays when a loaded descendant matches). Tools `tree_expand`, `tree_collapse`, `tree_select`, `tree_filter`; result `applied`, no receipt.
- read: `tree_list` returns entries with revisions.
- write: `tree_create` (create-only), `tree_rename` (create + remove at the revision seen; two receipts; the copy is undone on a conflict), `tree_remove` (at the revision seen). Result `committed` with the receipt, `conflict` when stale or existing, `denied` under `/code`.
- refresh: the host passes `refreshInterval`; a file written by the agent's `write_file` appears at its receipt's revision.
- read-only root: lock icon, no row actions, no create button; the tools refuse there.

## How to get to it (user POV)

Click a folder to open it, a file to open it in the viewer. The `+` button creates a file under `/workspace`; a file row's `…` menu renames or deletes it. Type in Filter.

## Driving it with boring

```bash
node bin/boring.mjs env up --example registry-host && node bin/boring.mjs thread --from-page
node bin/boring.mjs click "[data-path='/workspace/notes']" && node bin/boring.mjs wait-for "[data-path='/workspace/notes/plan.md']"
node bin/boring.mjs send "list my notes" --wait                   # tree_list → "Your notes: ideas.md, plan.md."
node bin/boring.mjs send "write a note" --wait                    # write_file; the tree shows it on its next refresh
node bin/boring.mjs wait-for "[data-path='/workspace/notes/agent-note.md']"
node bin/boring.mjs trace <run>                                   # the receipt: /workspace/notes/agent-note.md, before null, after <rev>
node bin/boring.mjs type "[aria-label='Filter files']" "plan"     # only plan.md under notes stays
```

Observed: `tree_list` `applied` with revisions; after `write a note` the row appears within the refresh interval; `trace` shows the receipt.

## Gotchas

- Filter works on loaded folders only; expand first (or `tree_list`).
- Rename is not atomic in the contract: two receipts, and a concurrent change to the source undoes the copy and reports `conflict`.
- `tree_select` on a folder expands it; on a file it opens it through the host's `onOpen`.
