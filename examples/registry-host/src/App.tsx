// The registry host: an application assembled from Boring UI registry items installed with `npx shadcn add`
// (src/components/*.tsx) and its own theme (index.css). It owns the layout and the choice of what is open;
// the items own the look; @boring/viewers owns behaviour and the agent's tools.
import { useCallback, useEffect, useMemo, useState } from "react"
import { Moon, Sun } from "lucide-react"
import { createChatClient } from "@boring/chat/client"
import { httpFiles } from "@boring/files/web"
import { isImage, type AgentBinding, type TreeEntry } from "@boring/viewers"
import { FileTree } from "@/components/file-tree"
import { MarkdownEditor } from "@/components/markdown-editor"
import { ImageViewer } from "@/components/image-viewer"
import { Chat } from "@/components/chat"
import { Button } from "@/components/ui/button"

const initialTheme = () => new URLSearchParams(location.search).get("theme") ?? (() => { try { return localStorage.getItem("theme") } catch { return null } })() ?? "light"

export function App() {
  const client = useMemo(() => createChatClient({ endpoint: "/agent" }), [])
  const files = useMemo(() => httpFiles({ endpoint: "/files" }), [])
  // The page keeps only the thread id, in the URL hash: a reload rebuilds the transcript, and `boring thread --from-page` adopts it.
  const [initialThread] = useState(() => new URLSearchParams(location.hash.slice(1)).get("thread") ?? undefined)
  const [thread, setThread] = useState<string | undefined>(initialThread)
  const onThread = useCallback((id: string) => {
    setThread(id)
    if (new URLSearchParams(location.hash.slice(1)).get("thread") !== id) history.replaceState(null, "", `${location.pathname}${location.search}#thread=${id}`)
  }, [])
  const [open, setOpen] = useState<string | null>(new URLSearchParams(location.search).get("open"))
  const [theme, setTheme] = useState(initialTheme)
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    try { localStorage.setItem("theme", theme) } catch { /* private mode */ }
  }, [theme])
  const agent: AgentBinding | undefined = useMemo(() => (thread ? { client, thread } : undefined), [client, thread])
  const onOpen = useCallback((entry: TreeEntry) => setOpen(entry.address), [])
  const readOnly = open?.startsWith("/code/") ?? false

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex h-11 shrink-0 items-center gap-3 border-b px-4">
        <span className="size-3 rounded-full bg-primary" />
        <h1 className="text-sm font-semibold tracking-tight">Registry host</h1>
        <span className="truncate text-xs text-muted-foreground" data-testid="open-file">{open ?? "nothing open"}</span>
        <Button variant="ghost" size="icon" className="ml-auto size-8" aria-label="Toggle theme" onClick={() => setTheme(t => (t === "dark" ? "light" : "dark"))}>
          {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </Button>
      </header>
      <main className="grid min-h-0 flex-1 grid-cols-[260px_minmax(0,1fr)_360px]">
        <aside className="min-h-0 border-r"><FileTree files={files} roots={["/workspace", "/code"]} readOnlyRoots={["/code"]} agent={agent} onOpen={onOpen} refreshInterval={1500} /></aside>
        <section className="min-h-0" data-testid="viewer">
          {!open && <p className="grid h-full place-items-center text-sm text-muted-foreground">Pick a file in the tree, or ask the assistant to open one.</p>}
          {open && /\.(md|txt)$/i.test(open) && <MarkdownEditor key={open} files={files} address={open} readOnly={readOnly} agent={agent} />}
          {open && isImage(open) && <ImageViewer key={open} files={files} address={open} agent={agent} />}
          {open && !/\.(md|txt)$/i.test(open) && !isImage(open) && <p className="grid h-full place-items-center text-sm text-muted-foreground">No viewer for {open} yet.</p>}
        </section>
        <aside className="min-h-0 border-l p-3"><Chat conversation="chat" client={client} thread={initialThread} onThread={onThread} placeholder="Ask the assistant" /></aside>
      </main>
    </div>
  )
}
