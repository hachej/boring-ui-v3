"use client"

// Boring UI registry: tool-call. One tool call in the transcript (the ToolCall slot). A page command's result
// says what happened (UI-BOUNDARY-5): applied locally, proposed to the person, committed with a receipt, or refused.
import { ChevronRight, Wrench } from "lucide-react"
import type { SlotProps } from "@boring/chat"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const OUTCOME: Record<string, string> = {
  applied: "bg-secondary text-secondary-foreground",
  proposed: "bg-accent text-accent-foreground",
  committed: "bg-primary text-primary-foreground",
  stale: "bg-destructive/15 text-destructive",
  conflict: "bg-destructive/15 text-destructive",
  denied: "bg-destructive/15 text-destructive",
  unavailable: "bg-muted text-muted-foreground",
}

export function ToolCall({ part }: SlotProps["ToolCall"]) {
  const outcome = typeof part.output === "object" && part.output && "outcome" in part.output ? String((part.output as { outcome: unknown }).outcome) : null
  const show = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value, null, 2))
  return (
    <details data-boring="tool" data-state={part.state} data-outcome={outcome ?? undefined} className="group rounded-md border bg-muted/40 text-xs text-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-1.5">
        <ChevronRight className="size-3 transition-transform group-open:rotate-90" />
        <Wrench className="size-3 text-muted-foreground" />
        <span className="font-mono">{part.name}</span>
        {outcome ? <Badge className={cn("ml-auto h-5 border-0", OUTCOME[outcome])}>{outcome}</Badge> : <Badge variant="outline" className="ml-auto h-5">{part.state}</Badge>}
      </summary>
      <div className="space-y-1 border-t px-2 py-1.5">
        <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">{show(part.input)}</pre>
        {part.output !== undefined && <pre className="max-h-56 overflow-auto whitespace-pre-wrap font-mono text-[11px]">{show(part.output)}</pre>}
        {part.error && <p className="text-destructive">{part.error}</p>}
      </div>
    </details>
  )
}
