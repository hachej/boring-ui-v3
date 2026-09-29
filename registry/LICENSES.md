# Licences of what the registry items bring

Every dependency an item installs, with its licence. An item may not depend on anything that needs a paid licence, with one declared exception (tldraw, when the canvas item lands, which needs a production licence key the application supplies).

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
| @boring/viewers, @boring/files, @boring/chat | this repository | the items | headless, imported, never copied |

No Tiptap Pro extension is used (no collaboration, comments, AI or conversion extensions).
