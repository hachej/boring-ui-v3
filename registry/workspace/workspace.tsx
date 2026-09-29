"use client"

// Boring UI registry: workspace. A dockview workspace whose panels are the other items (markdown-editor,
// image-viewer, canvas, ...). Which panels are open, the active one and the layout belong to @boring/viewers'
// useWorkspaceLayout, persisted per person as a file; its tools (workspace_open_panel, workspace_close_panel,
// workspace_focus_panel, workspace_list_panels) are the agent's. Dockview renders and reports; it holds no truth.
import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react"
import { DockviewReact, themeLight, type DockviewApi, type IDockviewPanelProps } from "dockview-react"
import "dockview-react/dist/styles/dockview.css"
import { LayoutPanelLeft } from "lucide-react"
import type { Panel, useWorkspaceLayout } from "@boring/viewers"
import { ConflictBanner } from "@/components/conflict-banner"
import { cn } from "@/lib/utils"

export type WorkspaceProps = {
  /** The hook's result: the app calls useWorkspaceLayout so its own controls (the tree) open panels through the same tools. */
  workspace: ReturnType<typeof useWorkspaceLayout>
  /** Render one panel: the app maps a kind to a registry item. */
  renderPanel: (panel: Panel) => ReactNode
  empty?: ReactNode
  className?: string
}

/** Dockview renders panels in portals that do not re-render with the page: they read what to show from this store. */
function panelSource() {
  let value: { panels: readonly Panel[]; render: (panel: Panel) => ReactNode } = { panels: [], render: () => null }
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next: typeof value) { value = next; for (const l of [...listeners]) l() },
    subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l) } },
  }
}

export function Workspace({ workspace, renderPanel, empty, className }: WorkspaceProps) {
  const { state, actions } = workspace
  const api = useRef<DockviewApi | null>(null)
  const latest = useRef({ state })
  latest.current = { state }
  const restored = useRef(false)
  const source = useRef(panelSource()).current
  useEffect(() => { source.set({ panels: state.panels, render: renderPanel }) }, [source, state.panels, renderPanel])

  // The hook's panels → dockview. Adding and removing only; dockview keeps positions, which it reports back as the grid.
  useEffect(() => {
    const dv = api.current
    if (!dv || state.status !== "ready") return
    if (!restored.current) {
      restored.current = true
      if (state.grid) try { dv.fromJSON(state.grid as Parameters<DockviewApi["fromJSON"]>[0]) } catch { dv.clear() }
    }
    for (const panel of state.panels) if (!dv.getPanel(panel.id)) dv.addPanel({ id: panel.id, component: "viewer", title: panel.title, params: { id: panel.id } })
    for (const panel of [...dv.panels]) if (!state.panels.some(p => p.id === panel.id)) panel.api.close()
    if (state.active && dv.activePanel?.id !== state.active) dv.getPanel(state.active)?.api.setActive()
  }, [state.status, state.panels, state.active, state.grid])

  const components = useRef({
    viewer: function Viewer({ params }: IDockviewPanelProps<{ id: string }>) {
      const { panels, render } = useSyncExternalStore(source.subscribe, source.get, source.get)
      const panel = panels.find(p => p.id === params.id)
      return <div data-boring="panel" data-panel={params.id} className="h-full min-h-0 bg-background">{panel ? render(panel) : null}</div>
    },
  }).current

  return (
    <div data-boring="workspace" className={cn("boring-dockview relative flex h-full min-h-0 flex-col bg-background text-foreground", className)}>
      {state.conflict && <ConflictBanner className="rounded-none border-x-0 border-t-0" current={state.conflict.current} onReload={actions.reload} onOverwrite={actions.overwrite} onDismiss={actions.dismissConflict} />}
      <div className="relative min-h-0 flex-1">
        <DockviewReact
          theme={themeLight}
          components={components}
          onReady={event => {
            const dv = event.api
            api.current = dv
            // The person closed a tab (a move also removes then re-adds: only a panel that stays gone is closed).
            dv.onDidRemovePanel(panel => queueMicrotask(() => { if (!dv.getPanel(panel.id) && latest.current.state.panels.some(p => p.id === panel.id)) void actions.close(panel.id) }))
            dv.onDidActivePanelChange(event => { const id = event.panel?.id; if (id && id !== latest.current.state.active && latest.current.state.panels.some(p => p.id === id)) void actions.focus(id) })
            dv.onDidLayoutChange(() => { if (restored.current) actions.layout(dv.toJSON()) })
          }}
        />
        {state.status === "ready" && state.panels.length === 0 && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-muted-foreground">
            {empty ?? <span className="flex items-center gap-2"><LayoutPanelLeft className="size-4" />Open a file from the tree, or ask the agent to.</span>}
          </div>
        )}
      </div>
    </div>
  )
}
