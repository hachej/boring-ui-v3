# Viewers laws

A viewer is the behaviour of one experience — a file tree, a markdown document, an image, a canvas, a workspace — without its look. Each hook holds component-local state and a set of typed tools. The person's controls and the agent call the same tools; data goes through a [FileProvider](../files/src/index.ts); the agent reaches a viewer only through the [page-command bridge](../chat/src/bridge.ts). The look lives in the registry (`registry/`), copied into an application. These laws refine the hub's UI-BOUNDARY-1..6 for this package; they do not restate BORING-1..6 or CHAT-3.

## VIEWERS-1 — one tool, every caller

A tool is one name, one input schema and one handler. The person's control, the agent's page command and a script call it through the same `call`, with the same schema check before the handler, and observe the same result and state change.

## VIEWERS-2 — read-only is enforced where the effect happens

A viewer declared read-only receives a provider that refuses every mutation and offers no tool whose effect is `write`. A refusal from the provider (`readonly`) is reported as `denied` and changes nothing; disabled buttons are not the boundary.

## VIEWERS-3 — a result names what happened

Local interaction is `applied`, a patch waiting for the person is `proposed`, and only a mutation the provider accepted is `committed`, carrying that provider's receipt (address, revisions before and after, actor). A changed revision is `stale` or `conflict`, a refused operation `denied`, a missing peer `unavailable`. A viewer never reports a success its provider did not return.

## VIEWERS-4 — a binding is one mounted instance on one target

A mounted viewer is one page instance whose target names the document it shows. Another document or a remount is a new binding; a request made for the old target is answered `stale`, never applied to the new one.

## VIEWERS-5 — a save names the revision it read, and unsaved work is kept

Saving writes at the revision the document last read. A stale save is a conflict the person resolves (reload, overwrite having seen it, or keep editing); nothing overwrites newer content silently. An agent's direct edit is bound to the revision it read and is refused while the person has unsaved edits.

## VIEWERS-6 — the person's decision stays the person's

An agent's patch is a proposal. Only the person's accept applies and saves it; no tool accepts, and an accepted proposal that no longer applies to the buffer is `stale`.

## VIEWERS-7 — headless and portable

The package renders nothing and styles nothing. It imports `@boring/files/web`, `@boring/chat` and React only: never the agent runtime, Flue, a provider SDK or Node, so it runs in any page and in a test without a server.
