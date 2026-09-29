# Boring UI registry

A [shadcn registry](https://ui.shadcn.com/docs/registry) of thin components: each is built on shadcn primitives and your theme tokens and calls one headless hook from [`@boring/viewers`](../packages/viewers) or [`@boring/chat`](../packages/chat). The hooks hold the behaviour and the agent's tools and are imported from npm, never copied; the components are copied into your app and are yours to restyle.

Sources: `registry/<item>/`, declared in [`registry.json`](../registry.json). Built: `public/r/<item>.json` (`node bin/boring.mjs registry build`), committed, and served from the repository to authenticated consumers (below). Licences: [LICENSES.md](LICENSES.md).

## Install

The repository is private, so the registry is served from it with a token: the built items are committed under `public/r/`, fetched from GitHub's raw endpoint with an `Authorization` header. Items name each other by namespace (`@boring/conflict-banner`), so one entry in your app's `components.json` resolves all of them:

```json
{
  "registries": {
    "@boring": {
      "url": "https://raw.githubusercontent.com/hachej/boring-ui-v3/main/public/r/{name}.json",
      "headers": { "Authorization": "token ${GITHUB_TOKEN}" }
    }
  }
}
```

`GITHUB_TOKEN` is any token that can read `hachej/boring-ui-v3` (a fine-grained personal access token with *Contents: read* on the repository, or `gh auth token`), in your environment or your app's `.env.local`. It is expanded by the shadcn CLI at install time and never written into your app's files.

Prerequisites: a React app with shadcn initialised (`npx shadcn init`, Tailwind v4), and `@boring/viewers`, `@boring/files` and `@boring/chat` resolvable from its `package.json`. They are not published to npm yet: depend on a checkout (`"@boring/viewers": "file:../boring-ui-v3/packages/viewers"`, same for files and chat) or a workspace. The CLI skips dependencies already declared, and an unresolvable one makes its `npm install` fail.

| Item | Install |
|---|---|
| file-tree | `npx shadcn add @boring/file-tree` |
| markdown-editor | `npx shadcn add @boring/markdown-editor` (brings conflict-banner) |
| conflict-banner | `npx shadcn add @boring/conflict-banner` |
| image-viewer | `npx shadcn add @boring/image-viewer` |
| canvas | `npx shadcn add @boring/canvas` (tldraw; pass `licenseKey` from your config in production) |
| workspace | `npx shadcn add @boring/workspace` (dockview; panels are the other items, rendered by your app) |
| chat | `npx shadcn add @boring/chat` (brings chat-message, tool-call, ask-card, approval-card) |
| chat-message, tool-call, ask-card, approval-card | `npx shadcn add @boring/<item>` |

Without the `registries` entry, a single item with no registry dependency can be added by URL with the same header, e.g. `curl -H "Authorization: token $GITHUB_TOKEN" -o file-tree.json https://raw.githubusercontent.com/hachej/boring-ui-v3/main/public/r/file-tree.json && npx shadcn add ./file-tree.json`; items that depend on others (markdown-editor, canvas, workspace, chat) need the entry. `public/r/registry.json` is the index.

From a checkout of this repository, `node bin/boring.mjs registry install [items] --into <your app>` builds the current source, serves it on a local port, points your app's `@boring` entry at it for the duration, and runs the same `shadcn add @boring/<item>`.

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
node bin/boring.mjs registry install    # shadcn add @boring/<item> into examples/registry-host from a local HTTP build of this checkout (CI)
GITHUB_TOKEN=$(gh auth token) node bin/boring.mjs registry install --from github   # the consumer's path: the example's components.json entry, main
```
