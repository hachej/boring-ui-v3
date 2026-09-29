# Registry

The shadcn registry (`registry.json`, `registry/<item>/`, built to `public/r/`) and the application built from it, `examples/registry-host`: its components under `src/components/` were installed with `npx shadcn add` from a local build, and CI reinstalls them and diffs. Items: file-tree, conflict-banner, markdown-editor, image-viewer, canvas, chat, chat-message, tool-call, ask-card, approval-card. Laws: VIEWERS-1..7, CHAT-5.

## Sub-features

- build: `registry build` writes `public/r/<item>.json` with the Pages URLs in cross-item dependencies; `registry check` fails when the committed build is stale.
- install: `registry install [items] [--into dir]` serves a local build, rewrites the cross-item URLs to it, runs `shadcn add -y -o` per item in the app; dependencies already in the app's `package.json` are skipped by the CLI.
- the host: tree (`/workspace` writable, `/code` read-only), the open file's viewer, the chat; theme `moss`, light and dark (`?theme=dark`), the open file in `?open=`, the thread in `#thread=`.
- the chat items: messages, tool calls with their outcome badge (`data-outcome`), ask and approval cards (render only until decisions exist), run status with stop, composer (Enter sends).

## How to get to it (user POV)

`boring env up --example registry-host`, open the URL. Pick a file in the tree; ask the assistant in the chat ("open /workspace/notes/plan.md", "name a risk in my plan", "write a note", "zoom the image", "read the code").

## Driving it with boring

```bash
node bin/boring.mjs registry check                    # public/r is current
node bin/boring.mjs registry install                  # the real install path; then: git diff -- examples/registry-host ':!examples/registry-host/src/components/ui'
node bin/boring.mjs env up --example registry-host
node bin/boring.mjs goto "/?open=/workspace/notes/plan.md" && node bin/boring.mjs wait-for ".boring-prose h2"
node bin/boring.mjs thread --from-page                # send continues the page's thread, where its viewers registered their tools
node bin/boring.mjs send "open /workspace/images/diagram.svg" --wait
node bin/boring.mjs wait-for "[data-boring=image-viewer] img" && node bin/boring.mjs screenshot .cache/evidence/<time>/host.png
node bin/boring.mjs goto "/?theme=dark&open=/workspace/notes/plan.md#thread=<id>"   # dark, same thread
```

Observed: `installed file-tree, …, chat into examples/registry-host`, no diff outside `ui/`; the page's hash carries `thread=<id>`; after the send the tree selects the file and the image viewer shows it. The browser journey and every screenshot (light and dark per item): `node --test test/registry/browser.test.ts` → `.cache/evidence/registry/*.png`.

## Gotchas

- `boring send` without `thread --from-page` starts or continues the CLI's own thread, on which no page registered tools: the assistant answers that there is no editor or tree.
- A page registers its tools when its chat has a thread; wait for `#thread=` before sending.
- The cross-item dependencies in `public/r` name GitHub Pages; while the repository is private, Pages and raw URLs are not reachable from outside: install with `registry install --into <app>`.
- `registry install` needs the network for shadcn's own primitives (ui.shadcn.com).
