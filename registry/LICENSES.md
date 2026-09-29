# Licences of what the registry items bring

Every dependency an item installs, with its licence. An item may not depend on anything that needs a paid licence, with one declared exception: tldraw (canvas), which needs a licence key in production.

| Dependency | Licence | Used by | Notes |
|---|---|---|---|
| shadcn (CLI and the primitives it copies: button, input, dropdown-menu, alert, badge, separator, card, textarea) | MIT | every item | primitives come from ui.shadcn.com through `registryDependencies` |
| radix-ui | MIT | the shadcn primitives | |
| lucide-react | ISC | every item | icons |
| react-arborist 3 | MIT | file-tree | virtualised tree |
| @tiptap/react, @tiptap/pm, @tiptap/core 3 | MIT | markdown-editor | Tiptap's open-source core |
| @tiptap/starter-kit 3 | MIT | markdown-editor | includes Link and Underline in v3 |
| @tiptap/markdown 3 | MIT | markdown-editor | markdown parse and serialise |
| @tiptap/extensions 3 (Placeholder) | MIT | markdown-editor | |
| @tiptap/extension-list 3 (TaskList, TaskItem) | MIT | markdown-editor | |
| tldraw 5 | tldraw licence (source-available; **a licence key is required in production**, none for development on localhost) | canvas | the key is the application's runtime config: the example serves `TLDRAW_LICENSE_KEY` from `/config.json` and passes it as `licenseKey`; it is never bundled or committed. See https://tldraw.dev/pricing |
| dockview-react, dockview-core 8 | MIT | workspace | |
| @boring/viewers, @boring/files, @boring/chat | this repository | the items | headless, imported, never copied |

No Tiptap Pro extension is used (no collaboration, comments, AI or conversion extensions).
