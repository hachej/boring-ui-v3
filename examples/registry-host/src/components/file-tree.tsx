"use client"

// Boring UI registry: file-tree. The look is yours (shadcn primitives + your tokens); the behaviour and the
// agent's tools are @boring/viewers' useFileTree. Virtualised with react-arborist: only visible rows render.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { Tree, type NodeApi, type NodeRendererProps, type TreeApi } from "react-arborist"
import { ChevronRight, File, FileImage, FileText, Folder, FolderOpen, Lock, MoreHorizontal, Plus, RefreshCw, Search } from "lucide-react"
import type { FileProvider } from "@boring/files/web"
import { useFileTree, type AgentBinding, type TreeEntry, type TreeNode } from "@boring/viewers"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"

export type FileTreeProps = {
  files: FileProvider
  /** Mount roots to show, e.g. ["/workspace", "/code"]. */
  roots: string[]
  readOnlyRoots?: string[]
  readOnly?: boolean
  /** The chat's client and thread: the tree's tools become the agent's (tree_expand, tree_create, ...). */
  agent?: AgentBinding
  onOpen?: (entry: TreeEntry) => void
  /** Re-list loaded folders on this interval (ms) so the agent's writes appear. */
  refreshInterval?: number
  rowHeight?: number
  className?: string
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [size, setSize] = useState({ width: 0, height: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return [ref, size] as const
}

const iconFor = (node: TreeNode, open: boolean): ReactNode => {
  if (node.kind === "dir") return open ? <FolderOpen className="size-4 text-primary" /> : <Folder className="size-4 text-primary" />
  if (/\.(png|jpe?g|webp|svg|gif)$/i.test(node.name)) return <FileImage className="size-4 text-muted-foreground" />
  if (/\.(md|txt)$/i.test(node.name)) return <FileText className="size-4 text-muted-foreground" />
  return <File className="size-4 text-muted-foreground" />
}

export function FileTree({ files, roots, readOnlyRoots, readOnly, agent, onOpen, refreshInterval, rowHeight = 28, className }: FileTreeProps) {
  const tree = useFileTree({ files, roots, readOnlyRoots, readOnly, agent, onOpen, refreshInterval })
  const { state, nodes, actions } = tree
  const api = useRef<TreeApi<TreeNode> | null>(null)
  const [box, size] = useSize<HTMLDivElement>()
  const [creating, setCreating] = useState<string | null>(null)
  const [draft, setDraft] = useState("")
  const [message, setMessage] = useState<string | null>(null)

  // The hook owns which folders are open (the agent can expand one); arborist follows it.
  useEffect(() => {
    const t = api.current
    if (!t) return
    for (const id of state.expanded) if (!t.get(id)?.isOpen) t.open(id)
    t.visibleNodes.forEach(node => { if (node.isOpen && !state.expanded.includes(node.id)) t.close(node.id) })
  }, [state.expanded, nodes])
  useEffect(() => { if (state.selected) api.current?.get(state.selected)?.select() }, [state.selected, nodes])

  const report = (outcome: string, detail?: unknown) => setMessage(outcome === "committed" || outcome === "applied" ? null : `${outcome}: ${typeof detail === "object" && detail && "reason" in detail ? String((detail as { reason: unknown }).reason) : JSON.stringify(detail)}`)
  const writableRoot = roots.find(r => !readOnly && !(readOnlyRoots ?? []).includes(r))

  const Row = ({ node, style }: NodeRendererProps<TreeNode>) => {
    const data = node.data
    const isRoot = roots.includes(data.id)
    return (
      <div
        style={style}
        data-path={data.id}
        data-kind={data.kind}
        className={cn("group flex h-full items-center gap-1.5 rounded-md pr-1 text-sm", node.isSelected ? "bg-accent text-accent-foreground" : "hover:bg-muted", isRoot && "font-medium")}
        onClick={() => (data.kind === "dir" ? node.toggle() : void actions.select(data.id))}
      >
        <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", data.kind !== "dir" && "invisible", node.isOpen && "rotate-90")} />
        {iconFor(data, node.isOpen)}
        <span className="min-w-0 flex-1 truncate">{isRoot ? data.id : data.name}</span>
        {isRoot && data.readOnly && <Lock className="size-3 text-muted-foreground" aria-label="read-only" />}
        {!data.readOnly && !isRoot && data.kind === "file" && data.revision && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild onClick={e => e.stopPropagation()}>
              <Button variant="ghost" size="icon" className="size-6 opacity-0 group-hover:opacity-100" aria-label={`Actions for ${data.name}`}><MoreHorizontal className="size-3.5" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={e => e.stopPropagation()}>
              <DropdownMenuItem onSelect={async () => { const to = window.prompt("Rename to", data.id); if (to && to !== data.id) { const r = await actions.rename(data.id, to, data.revision!); report(r.outcome, r.detail) } }}>Rename</DropdownMenuItem>
              <DropdownMenuItem variant="destructive" onSelect={async () => { const r = await actions.remove(data.id, data.revision!); report(r.outcome, r.detail) }}>Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    )
  }

  return (
    <div data-boring="file-tree" className={cn("flex h-full min-h-0 flex-col gap-2 bg-background text-foreground", className)}>
      <div className="flex items-center gap-1 px-2 pt-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input aria-label="Filter files" placeholder="Filter" value={state.filter} onChange={e => void actions.filter(e.target.value)} className="h-8 pl-7" />
        </div>
        {writableRoot && <Button variant="ghost" size="icon" className="size-8" aria-label="New file" onClick={() => { setCreating(writableRoot); setDraft("") }}><Plus className="size-4" /></Button>}
        <Button variant="ghost" size="icon" className="size-8" aria-label="Refresh" onClick={() => void tree.refresh()}><RefreshCw className={cn("size-4", state.loading.length > 0 && "animate-spin")} /></Button>
      </div>
      {creating && (
        <form className="flex gap-1 px-2" onSubmit={async e => { e.preventDefault(); const path = `${creating}/${draft.replace(/^\/+/, "")}`; const r = await actions.create(path); report(r.outcome, r.detail); if (r.outcome === "committed") { setCreating(null); void actions.select(path) } }}>
          <Input autoFocus aria-label="New file name" placeholder="notes/new.md" value={draft} onChange={e => setDraft(e.target.value)} onKeyDown={e => { if (e.key === "Escape") setCreating(null) }} className="h-8" />
          <Button type="submit" size="sm" className="h-8" disabled={!draft.trim()}>Create</Button>
        </form>
      )}
      {(message || state.error) && <p role="status" className="px-3 text-xs text-destructive">{message ?? state.error}</p>}
      <div ref={box} className="min-h-0 flex-1 px-1">
        {size.height > 0 && (
          <Tree<TreeNode>
            ref={api}
            data={nodes}
            idAccessor="id"
            childrenAccessor={d => (d.kind === "dir" ? d.children ?? [] : null)}
            width={size.width}
            height={size.height}
            rowHeight={rowHeight}
            indent={14}
            openByDefault={false}
            initialOpenState={Object.fromEntries(state.expanded.map(id => [id, true]))}
            disableDrag
            disableDrop
            disableEdit
            disableMultiSelection
            onToggle={(id: string) => { const open = api.current?.get(id)?.isOpen; void (open ? actions.expand(id) : actions.collapse(id)) }}
            onActivate={(node: NodeApi<TreeNode>) => { if (node.data.kind === "file") void actions.select(node.id) }}
            aria-label="Files"
          >
            {Row}
          </Tree>
        )}
      </div>
    </div>
  )
}
