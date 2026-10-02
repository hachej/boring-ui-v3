"use client"

// Boring UI registry: canvas. A tldraw whiteboard persisted as one `.tldraw` JSON file through @boring/files; the
// document, its revision, saving and the agent's tools (canvas_get_shapes, canvas_select, canvas_create_shapes,
// canvas_update_shapes) are @boring/viewers' useCanvasDocument. tldraw needs a licence key in production: pass it from
// your application's config at runtime (e.g. TLDRAW_LICENSE_KEY served to the page), never bundled in this file.
import { useEffect, useState } from "react"
import { Tldraw, createShapeId, getSnapshot, loadSnapshot, renderPlaintextFromRichText, toRichText, type Editor, type TLShapeId, type TLShapePartial } from "tldraw"
import "tldraw/tldraw.css"
import { Lock, Save, Shapes } from "lucide-react"
import type { FileProvider } from "@boring/files/web"
import { useCanvasDocument, type AgentBinding, type CanvasEditor, type Effect, type NewShape, type ShapeUpdate } from "@boring/viewers"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ConflictBanner } from "@/components/conflict-banner"
import { cn } from "@/lib/utils"

export type CanvasProps = {
  files: FileProvider
  /** `/workspace/boards/plan.tldraw` */
  address: string
  readOnly?: boolean
  agent?: AgentBinding
  effect?: Effect
  /** tldraw's production licence key, from your app's config at runtime. Development on localhost needs none. */
  licenseKey?: string
  /** Save the person's changes after this many ms without one (default 1200; 0 turns it off). */
  autosave?: number
  className?: string
  /** The shapes the person selected (ids and their text), whenever the selection changes; null when none. */
  onSelection?: (selection: { ids: string[]; texts: string[] } | null) => void
}

/** tldraw behind the CanvasEditor adapter. Loads and tool changes are merged as remote, so only the person's edits count as theirs. */
export function tldrawAdapter(editor: Editor): CanvasEditor {
  const remote = (work: () => void) => editor.store.mergeRemoteChanges(work)
  const props = (s: { color?: string; text?: string; w?: number; h?: number; geo?: string }) => ({
    ...(s.color ? { color: s.color } : {}),
    ...(s.text !== undefined ? { richText: toRichText(s.text) } : {}),
    ...(s.w !== undefined ? { w: s.w } : {}),
    ...(s.h !== undefined ? { h: s.h } : {}),
    ...(s.geo ? { geo: s.geo } : {}),
  })
  const create = (s: NewShape, id: TLShapeId): TLShapePartial => {
    if (s.type === "geo") return { id, type: "geo", x: s.x, y: s.y, props: { geo: s.geo ?? "rectangle", w: s.w ?? 180, h: s.h ?? 90, ...props({ color: s.color, text: s.text ?? "" }) } } as TLShapePartial
    if (s.type === "note") return { id, type: "note", x: s.x, y: s.y, props: props({ color: s.color, text: s.text ?? "" }) } as TLShapePartial
    return { id, type: "text", x: s.x, y: s.y, props: props({ color: s.color, text: s.text ?? "" }) } as TLShapePartial
  }
  return {
    shapes: () => editor.getCurrentPageShapes().map(shape => {
      const p = shape.props as { w?: number; h?: number; color?: string; geo?: string; richText?: Parameters<typeof renderPlaintextFromRichText>[1] }
      return {
        id: shape.id, type: shape.type, x: Math.round(shape.x), y: Math.round(shape.y),
        ...(p.w !== undefined ? { w: Math.round(p.w) } : {}), ...(p.h !== undefined ? { h: Math.round(p.h) } : {}),
        ...(p.richText ? { text: renderPlaintextFromRichText(editor, p.richText) } : {}),
        ...(p.color ? { color: p.color } : {}), ...(p.geo ? { geo: p.geo } : {}),
      }
    }),
    selection: () => editor.getSelectedShapeIds(),
    select: ids => editor.setSelectedShapes(ids as TLShapeId[]),
    create: specs => { const ids = specs.map(() => createShapeId()); remote(() => editor.createShapes(specs.map((s, i) => create(s, ids[i])))); return ids },
    update: (updates: readonly ShapeUpdate[]) => remote(() => editor.updateShapes(updates.map(u => {
      const shape = editor.getShape(u.id as TLShapeId)!
      const sized = u.w !== undefined || u.h !== undefined ? (shape.type === "geo" ? { w: u.w, h: u.h } : {}) : {}
      return { id: shape.id, type: shape.type, ...(u.x !== undefined ? { x: u.x } : {}), ...(u.y !== undefined ? { y: u.y } : {}), props: props({ color: u.color, text: u.text, ...sized }) } as TLShapePartial
    }))),
    snapshot: () => getSnapshot(editor.store).document,
    load: document => remote(() => {
      if (document) loadSnapshot(editor.store, { document } as Parameters<typeof loadSnapshot>[1])
      else editor.deleteShapes([...editor.getCurrentPageShapeIds()])
    }),
    onChange: listener => editor.store.listen(() => listener(), { source: "user", scope: "document" }),
    setReadOnly: readOnly => editor.updateInstanceState({ isReadonly: readOnly }),
  }
}

function useDark() {
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"))
  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
    return () => observer.disconnect()
  }, [])
  return dark
}

export function Canvas({ files, address, readOnly, agent, effect, licenseKey, autosave = 1200, className, onSelection }: CanvasProps) {
  const { state, actions, attach } = useCanvasDocument({ files, address, readOnly, agent, effect, autosave })
  const dark = useDark()
  return (
    <div data-boring="canvas" data-dirty={state.dirty ? "" : undefined} className={cn("flex h-full min-h-0 flex-col bg-background text-foreground", className)}>
      <div className="flex items-center gap-2 border-b px-3 py-1.5">
        <span className="truncate text-sm font-medium" title={address}>{address.split("/").pop()}</span>
        <Badge variant="outline" className="gap-1"><Shapes className="size-3" />{state.shapes}</Badge>
        {state.readOnly && <Badge variant="secondary" className="gap-1"><Lock className="size-3" />read-only</Badge>}
        <span data-boring="save-state" className="ml-auto text-xs text-muted-foreground">
          {state.status !== "ready" ? state.status : state.saving ? "saving…" : state.dirty ? "unsaved" : `saved · r${state.saved?.revision ?? "?"}`}
        </span>
        {!state.readOnly && <Button size="sm" className="h-7" disabled={!state.dirty || state.saving} onClick={() => void actions.save()}><Save className="size-3.5" />Save</Button>}
      </div>
      {state.conflict && <ConflictBanner className="rounded-none border-x-0 border-t-0" current={state.conflict.current} onReload={actions.reload} onOverwrite={actions.overwrite} onDismiss={actions.dismissConflict} />}
      {state.error && state.status !== "ready" && <p role="alert" className="px-4 py-3 text-sm text-destructive">{state.error}</p>}
      <div className="relative min-h-0 flex-1">
        <Tldraw licenseKey={licenseKey} colorScheme={dark ? "dark" : "light"} onMount={editor => {
          const adapter = tldrawAdapter(editor)
          const detach = attach(adapter)
          // The host may show what the person selected (a chat's context): the same selection get_shapes reports.
          const report = () => { const ids = adapter.selection().map(String); onSelection?.(ids.length ? { ids, texts: adapter.shapes().filter(s => ids.includes(s.id)).map(s => s.text ?? "").filter(Boolean) } : null) }
          const stop = editor.store.listen(report, { scope: "session" })
          return () => { stop(); detach() }
        }} />
      </div>
    </div>
  )
}
