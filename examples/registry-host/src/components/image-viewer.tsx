import { useCallback, useLayoutEffect, useRef, useState } from "react"
import { Maximize, Minus, Plus, Scan } from "lucide-react"
import type { FileProvider } from "@boring/files/web"
import { useImage, type AgentBinding } from "@boring/viewers"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type ImageViewerProps = {
  files: FileProvider
  address: string
  /** A URL for raster bytes the text file contract cannot carry (the application serves them). */
  source?: (address: string, revision: string) => string | Promise<string>
  agent?: AgentBinding
  className?: string
}

export function ImageViewer({ files, address, source, agent, className }: ImageViewerProps) {
  const { state, actions } = useImage({ files, address, source, agent })
  const viewport = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)

  useLayoutEffect(() => {
    const el = viewport.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => setBox({ width: entry.contentRect.width, height: entry.contentRect.height }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  const fitted = useCallback((w: number, h: number) => (box.width && box.height ? Math.min(1, (box.width - 32) / w, (box.height - 32) / h) : 1), [box])
  // While fitting, the zoom follows the viewport; the hook keeps it so describe() reports what is shown.
  useLayoutEffect(() => { if (state.fit && state.width && state.height) actions.measured(state.width, state.height, fitted(state.width, state.height)) }, [state.fit, state.width, state.height, fitted, actions])

  const zoom = state.zoom
  return (
    <div data-boring="image-viewer" className={cn("flex h-full min-h-0 flex-col bg-background text-foreground", className)}>
      <div className="flex items-center gap-1 border-b px-3 py-1.5">
        <span className="mr-2 truncate text-sm font-medium" title={address}>{address.split("/").pop()}</span>
        <Badge variant="outline" className="font-mono">{state.mime.replace("image/", "")}</Badge>
        {state.width && <span className="text-xs text-muted-foreground">{state.width}×{state.height}</span>}
        <div className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-7" aria-label="Zoom out" onClick={() => void actions.zoomBy(1 / 1.25)}><Minus className="size-4" /></Button>
          <span data-boring="zoom" className="w-12 text-center font-mono text-xs tabular-nums">{Math.round(zoom * 100)}%</span>
          <Button variant="ghost" size="icon" className="size-7" aria-label="Zoom in" onClick={() => void actions.zoomBy(1.25)}><Plus className="size-4" /></Button>
          <Button variant="ghost" size="icon" className="size-7" aria-label="Actual size" onClick={() => void actions.zoom(1)}><Scan className="size-4" /></Button>
          <Button variant={state.fit ? "secondary" : "ghost"} size="icon" className="size-7" aria-label="Fit" aria-pressed={state.fit} onClick={() => void actions.fit()}><Maximize className="size-4" /></Button>
        </div>
      </div>
      <div
        ref={viewport}
        className="relative min-h-0 flex-1 cursor-grab touch-none overflow-hidden bg-[repeating-conic-gradient(var(--muted)_0%_25%,transparent_0%_50%)] bg-[length:16px_16px] active:cursor-grabbing"
        onWheel={e => { if (state.status === "ready") void actions.zoomBy(e.deltaY < 0 ? 1.1 : 1 / 1.1) }}
        onPointerDown={e => { drag.current = { x: e.clientX, y: e.clientY }; (e.target as HTMLElement).setPointerCapture?.(e.pointerId) }}
        onPointerMove={e => { if (!drag.current) return; const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y; drag.current = { x: e.clientX, y: e.clientY }; void actions.panBy(dx, dy) }}
        onPointerUp={() => { drag.current = null }}
      >
        {state.status === "error" && <p role="alert" className="absolute inset-0 grid place-items-center p-6 text-sm text-destructive">{state.error}</p>}
        {state.src && (
          <div className="absolute left-1/2 top-1/2" style={{ transform: `translate(calc(-50% + ${state.pan.x}px), calc(-50% + ${state.pan.y}px)) scale(${zoom})`, transformOrigin: "center" }}>
            <img
              src={state.src}
              alt={address}
              draggable={false}
              className="block max-w-none select-none shadow-sm"
              onLoad={e => actions.measured(e.currentTarget.naturalWidth || 300, e.currentTarget.naturalHeight || 150, fitted(e.currentTarget.naturalWidth || 300, e.currentTarget.naturalHeight || 150))}
            />
            {state.annotations.map(a => (
              <div key={a.id} data-boring="annotation" className="pointer-events-none absolute animate-pulse rounded-sm border-2 border-primary bg-primary/15" style={{ left: a.x, top: a.y, width: a.width, height: a.height }}>
                {a.label && <span className="absolute -top-6 left-0 whitespace-nowrap rounded bg-primary px-1.5 py-0.5 text-xs text-primary-foreground" style={{ transform: `scale(${1 / zoom})`, transformOrigin: "bottom left" }}>{a.label}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
