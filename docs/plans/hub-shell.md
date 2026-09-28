# Plan: hub shell as a registry item

Status: draft, 2026-09-24. No registry code yet. This is the structure plan for the first boring-ui-v3 slice.

## What this repo is

boring-ui-v3 is our UI library, published as our own shadcn registry. The hub does not live here. The hub installs items from this registry and assembles them.

boring-ui-v2 is ignored as a dependency. Nothing in v3 imports it. When a component there is useful, we copy that block into this repo and rebuild it on shadcn + Base UI. We do not wrap the v2 kit or depend on it.

Items in the registry are built with shadcn on Base UI, not Radix. Design and review of every item follows [jakubkrehel/skills](https://github.com/jakubkrehel/skills) and [emilkowalski/skills](https://github.com/emilkowalski/skills).

## Goal

The first items are the building blocks and one layout that receives them.

`hub-shell` is a registry item. It has slots. It does not know what a chat, a viewer, or an account menu is. `chats`, `chat`, `viewer`, and `user-menu` are separate items. A hub screen installs them and passes them into the shell.

The viewers stay in the hub. They already import their buttons, cards, fields, and tabs from `@hachej/boring-ui-kit`. Those imports move to this registry. The clearest case is the `ui` viewer (`shell/viewers/ui-editor.tsx`), which renders a catalog of kit components (`Button`, `Card`, `Input`, `Tabs`, `List`, and the rest). That catalog should list registry items instead. File panes, the markdown editor, tldraw, and dashboard charts stay hub code. They are documents and tools, not pieces of the library.

Later items replace the placeholders. The shell item stays.

## Why this shape

The current products grew the other way around.

- In boring-hub, `ColumnPage` (`agent/agent-flue/shell/pages/column.tsx`) is the layout and the product at once: media queries, collapse, ask attention, process refresh, UI commands, and the grid. `UserMenu` is mounted from three different headers. There is no shared chrome component.
- In boring-ui-v2, the workspace people actually use is `PluginTabsWorkspaceShell` plus `ChatLayout`, but the composition lives inside `WorkspaceAgentFront` (about three thousand lines of sessions, fleet, and persistence). The frame is custom flex, a hand-rolled resize handle, and dockview. The UI kit is shadcn-style and has no `Sidebar` and no `Resizable` panel group.

A shell with slots fixes the part that went wrong: chrome copied per page, and product state living in the frame. It does not try to absorb either runtime.

boring-ui-v3 has no UI source. `README.md` is an index of imported explorations. This plan is the first architecture for the registry. It does not modify boring-hub or boring-ui-v2.

## Stack and design

- **Registry.** A shadcn registry (`registry.json`) whose items are the primitives we keep, plus `hub-shell` and the blocks. The hub is a consumer.
- **Base UI.** `components.json` uses the Base UI style. Primitives such as `Sidebar`, `Resizable`, and `Sheet` come from shadcn's Base UI set, then live in this registry so the hub installs our copies.
- **Design skills, required when building or reviewing an item.**
  - jakubkrehel: `better-layout` for the shell regions, then `better-ui`, `better-typography`, `better-colors`, `better-accessibility`, and `better-writing` on the blocks. `better-interface` is the pass that runs those together.
  - emilkowalski: `emil-design-eng` for craft, `pick-ui-library` before adding any dependency, `animate` and `review-animations` only where motion earns its place. The shell does not animate panel swaps. Hidden panes stay mounted and still.

## Regions

Decided in the layout interview. The first screen is one app's workspace.

```
┌ trail ┬ chat                          ┬ artefact (only if open) ┐
│ app   │                               │                         │
│ chat* │  full width when no artefact  │                         │
│ user  │                               │                         │
└───────┴───────────────────────────────┴─────────────────────────┘
```

`chat*` is the icon that shows only while the chat column is collapsed.

| Place | What |
|---|---|
| Trail, top | App switcher, the shadcn sidebar header pattern |
| Trail | Chat icon, only when the chat column is collapsed. Activating it opens the chat again. No library button in this version |
| Trail, bottom | User menu |
| Main, left | The one conversation. There is no conversation list in this layout |
| Main, right | The open artefact. Absent means the chat uses the full width |

`Chat` and `Viewer` must also be usable with no shell around them. The hub already mounts chat inside an app (`mountChat`) and mounts a view alone at its URL (`ViewPage`). The shell is the hub's assembly, not a required parent of those blocks.

## What the shell owns

Built only from shadcn primitives in `src/components/ui`:

- `Sidebar` for the left region: expanded list, collapsed rail, mobile `Sheet`.
- `ResizablePanelGroup` for the center/right split.
- `Button`, `Separator` for the rail and the narrow Chat | View switch.

The shell owns:

- Which region is visible at which width.
- Panel sizes for the center/right split, stored under a `boring:shell:` key.
- Keeping `chat` and `viewer` mounted when one is hidden (`hidden` + `inert`, not unmount). A `Sheet` that closes would drop the transcript and the open view. The sheet is only for the left region on a narrow screen.
- Collapsing the left region to a rail on a wide screen.

The shell does not fetch, does not import `src/blocks`, and does not branch on conversation id, view kind, publish state, or unread counts. An empty `viewer` slot means the center column takes the width. The screen decides the slot is empty. The shell does not know why.

## What a block owns

A block is a React component in its own folder. It owns its markup and, later, its data. It does not read the shell's breakpoint, write panel sizes, or position itself.

Passing `hidden` from the shell is allowed so a block can pause work while off-screen. Passing slug, conversation id, or a view address is the screen's job, as props on the block, when those blocks become real. The first slice's blocks take no product props.

## Assembly

One screen fills the slots. There is no block registry and no second layout mode.

```tsx
export function HubScreen() {
  return (
    <HubShell
      chats={<Chats />}
      userMenu={<UserMenu />}
      chat={<Chat />}
      viewer={<Viewer />}
    />
  )
}
```

A new block is a folder under `src/blocks/` and one prop on this screen. A new region is a new prop on `HubShell` plus the place the shell paints it. Blocks do not invent regions by nesting another shell.

A second screen, such as an apps list, does not have to use `HubShell`. The apps list in the hub is a different page (title, create, list, menu). Reuse `UserMenu` there later. Do not stretch this shell into a universal page wrapper.

## Breakpoints

One module, `src/shell/breakpoints.ts`. Numbers follow the hub, which already treats these as layout policy: 48rem and 64rem. v2's 640 vs 768 disagreement stays behind.

| Width | Left region | Center and right |
|---|---|---|
| < 48rem | Closed. Opens in a `Sheet`. Trigger lives in the top bar. | One of the two is visible. A switch flips visibility. Both stay mounted. |
| 48rem–64rem | Inline, not collapsible. | Side by side, resizable. |
| ≥ 64rem | Inline, collapsible to a rail. Collapse preference is a shell preference. | Side by side, resizable. |

## Folder structure

A shadcn registry at the repo root, plus a small preview app whose only job is to install the items and show the assembly. The preview is not the hub. Not a dependency on `@hachej/boring-ui-kit`.

```
registry.json
registry/
  ui/                     primitives, Base UI, one item each
  hub-shell/              the layout item
  chats/
  chat/
  viewer/
  user-menu/
apps/preview/             consumes the registry, one screen
```

| Item | Owns | Does not own |
|---|---|---|
| `ui/*` | One shadcn + Base UI primitive | Product copy, fetching |
| `hub-shell` | Regions, visibility, sizes, keep-mounted | Which block is mounted, server data |
| `chats`, `chat`, `viewer`, `user-menu` | That block's UI and state | Other columns, breakpoints |
| Preview screen | The slot assignment, for review | CSS grid, resize math, hub data |

## Where we start

Keep this small. The first thing is a layout in the hub (`boring-hub`), built with shadcn on Base UI. No registry yet. The hub's theme is customized in the hub. boring-ui-v2 is ignored.

The layout has empty slots: chats, user menu, chat, viewer. Nothing in those slots is real yet.

boring-ui-v3 comes second. That is where the viewers will live. The hub layout will consume them after the layout is in place. Until then the viewer slot is a placeholder.

## First slice

The hub repo is already full stack. `agent/agent-flue/src/` is the backend. `shell/` is the front experiment. Do not invent a second server, and do not reshape `ColumnPage`.

Add the new client beside the experiment and move one piece into it at a time.

```
agent/agent-flue/
  src/                 backend, already running
  shell/               experiment, left in place
  front/               new client
    src/
      main.tsx
      app.tsx
      index.css
      components/ui/   shadcn + Base UI only
      layout/          the frame and its slots
      features/        chats, chat, viewer, user-menu
```

`components/ui` holds shadcn. `layout` holds the frame. Each folder under `features/` stays empty until that piece is mounted. The frame does not import a feature before that step. User-control routes are added later inside `src/`, and TanStack Query arrives with them. TanStack Router arrives when those screens need their own addresses.

Done when the new layout renders four empty slots with shadcn and Base UI, and the existing column page is unchanged.

1. New layout component in the hub. Slots: chats, user menu, chat, viewer. Placeholders only.
2. shadcn on Base UI for that layout: sidebar, resizable split, sheet. Theme tokens live next to the layout.
3. Leave chat, viewers, and the user menu on the old page until each one is deliberately mounted into a slot.

Order after that: user menu, then chat, then a viewer from boring-ui-v3. One at a time.

## Later, in order

These are not the first slice. Each one replaces or extends a block. None of them edit the shell unless a task below says so.

1. `Chats` lists real conversations and tells the screen which one is open. The screen passes that id to `Chat`.
2. `Chat` renders the conversation. It stays mountable without `HubShell`.
3. `Viewer` renders one view from an address the screen passes in. The screen owns the address. The block does not import the shell.
4. `UserMenu` loads the account and opens its panels with `Sheet` or `DropdownMenu`.
5. An apps screen reuses `UserMenu` and does not use `HubShell`.
6. The hub adds this registry to its `components.json` and installs `hub-shell` plus the blocks. Routing, page-data, and the worker stay in boring-hub. This repo never becomes the hub.

Process status, ask-user cards, and unread dots belong to the block that displays them (`Chat` or `Chats`), not to new shell slots.

## Leave in place

Do not port these into the first slice, and do not import them:

- boring-hub: `ColumnPage`, `column-bar.tsx`, `Chat.tsx`, `viewers/`, `UserMenu`, `ui-channel`, `commands`, `process`, `AppList`, `ViewPage`, the worker.
boring-ui-v2 stays untouched. Do not import `WorkspaceAgentFront`, `ChatLayout`, dockview, or `@hachej/boring-ui-kit`. Copy a single component's source into v3 only when the first slice needs that block.

Copy the region map and the keep-mounted rule. Leave the engines.

## Defaults

- This repo is the shadcn registry. The preview app is a fixture.
- shadcn on Base UI. No Radix primitives, no `@hachej/boring-ui-kit`, no dockview.
- Every new item is reviewed with the jakubkrehel and emilkowalski skills named above.
- `userMenu` is the left footer, matching v2. It is not a second header on the chat column.
- English placeholder labels.
- Panel-size and left-collapse keys belong to the shell item. Conversation and view state belong to the hub screen and the block items, later.

## Risks

- A stock `Sidebar` sheet that unmounts its content is fine for the chats list. Using that same unmount for `chat` or `viewer` loses the transcript and the iframe. The keep-mounted rule is the one behavior to test on purpose.
- The hub installs UI from this registry. It does not keep using the v2 kit for those same pieces. Tokens come from this registry.
- The hub's tests assert `data-shell-*` attributes, collapse, and attention. Those tests stay on boring-hub. This slice does not claim to satisfy them.
