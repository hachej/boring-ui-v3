# Boring UI registry

A [shadcn registry](https://ui.shadcn.com/docs/registry) of thin components: each is built on shadcn primitives and your theme tokens and calls one headless hook from [`@boring/viewers`](../packages/viewers) or [`@boring/chat`](../packages/chat). The hooks hold the behaviour and the agent's tools and are imported from npm, never copied; the components are copied into your app and are yours to restyle.

Sources: `registry/<item>/`, declared in [`registry.json`](../registry.json). Built: `public/r/<item>.json` (`node bin/boring.mjs registry build`), served from GitHub Pages by [`.github/workflows/registry-pages.yml`](../.github/workflows/registry-pages.yml). Licences: [LICENSES.md](LICENSES.md).

## Install

Prerequisites: a React app with shadcn initialised (`npx shadcn init`, Tailwind v4), and `@boring/viewers`, `@boring/files` and `@boring/chat` in its `package.json` (the CLI skips dependencies already declared; the `@boring/*` packages are not on the public npm registry yet).

| Item | Install |
|---|---|
| file-tree | `npx shadcn add https://hachej.github.io/boring-ui-v3/r/file-tree.json` |
| markdown-editor | `npx shadcn add https://hachej.github.io/boring-ui-v3/r/markdown-editor.json` (brings conflict-banner) |
| conflict-banner | `npx shadcn add https://hachej.github.io/boring-ui-v3/r/conflict-banner.json` |
| image-viewer | `npx shadcn add https://hachej.github.io/boring-ui-v3/r/image-viewer.json` |
| canvas | `npx shadcn add https://hachej.github.io/boring-ui-v3/r/canvas.json` (tldraw; pass `licenseKey` from your config in production) |
| workspace | `npx shadcn add https://hachej.github.io/boring-ui-v3/r/workspace.json` (dockview; panels are the other items, rendered by your app) |
| chat | `npx shadcn add https://hachej.github.io/boring-ui-v3/r/chat.json` (brings chat-message, tool-call, ask-card, approval-card) |
| chat-message, tool-call, ask-card, approval-card | `npx shadcn add https://hachej.github.io/boring-ui-v3/r/<item>.json` |

Fallback without Pages, from the repository itself: `npx shadcn add https://raw.githubusercontent.com/hachej/boring-ui-v3/main/public/r/<item>.json`. The items it depends on are still named by their Pages URL.

To name the registry once, add it to `components.json` and install by name:

```json
{ "registries": { "@boring": "https://hachej.github.io/boring-ui-v3/r/{name}.json" } }
```

```bash
npx shadcn add @boring/markdown-editor
```

## Use

```tsx
import { httpFiles } from "@boring/files/web"
import { createChatClient } from "@boring/chat/client"
import { FileTree } from "@/components/file-tree"
import { MarkdownEditor } from "@/components/markdown-editor"
import { Chat } from "@/components/chat"

const files = httpFiles({ endpoint: "/files" })        // your server mounts fileRoutes from @boring/files
const client = createChatClient({ endpoint: "/agent" }) // and mountWire from @boring/agent
const agent = thread ? { client, thread } : undefined   // the viewers' tools become the agent's

<FileTree files={files} roots={["/workspace", "/code"]} readOnlyRoots={["/code"]} agent={agent} onOpen={e => setOpen(e.address)} refreshInterval={1500} />
<MarkdownEditor files={files} address={open} agent={agent} />
<Chat conversation="chat" client={client} onThread={setThread} />
```

The agent may request a viewer's tool only if its `agent.md` lists it under `ui:` and your host allows it by name (see [packages/viewers](../packages/viewers/README.md) for the tools table). [examples/registry-host](../examples/registry-host) is an application built this way.

## Develop

```bash
node bin/boring.mjs registry build      # public/r from registry.json + registry/
node bin/boring.mjs registry check      # public/r is current (CI)
node bin/boring.mjs registry install    # shadcn add every item into examples/registry-host from a local build (the real install path)
```
