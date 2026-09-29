"use client"

// A proposed patch as the person sees it: the agent's summary and a line diff, with Accept and Reject.
// Accepting is the person's act (VIEWERS-6); it saves at the revision the proposal saw and shows the result.
import { useState } from "react"
import { Check, Sparkles, X } from "lucide-react"
import type { Proposal } from "@boring/viewers"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type Result = { outcome: string; detail?: unknown }
type Line = Proposal["diff"][number]

/** Changed lines with two lines of context; longer unchanged runs fold into one marker. */
function hunks(diff: readonly Line[], context = 2): (Line | { kind: "fold"; count: number })[] {
  const keep = diff.map((_, i) => diff.slice(Math.max(0, i - context), i + context + 1).some(l => l.kind !== "same"))
  const out: (Line | { kind: "fold"; count: number })[] = []
  diff.forEach((line, i) => {
    if (keep[i]) out.push(line)
    else if (out.at(-1)?.kind === "fold") (out.at(-1) as { count: number }).count++
    else out.push({ kind: "fold", count: 1 })
  })
  return out
}

export function ProposalDiff({ proposal, onAccept, onReject, readOnly }: { proposal: Proposal; onAccept: () => Promise<Result>; onReject: () => void; readOnly?: boolean }) {
  const [result, setResult] = useState<Result | null>(null)
  const changed = proposal.diff.filter(l => l.kind !== "same").length
  return (
    <section data-boring="proposal" data-proposal={proposal.id} className="border-b bg-muted/50 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-sm">
        <Sparkles className="size-4 text-primary" />
        <span className="font-medium">{proposal.summary || "Proposed change"}</span>
        <Badge variant="outline">{proposal.from}</Badge>
        <span className="text-xs text-muted-foreground">{changed} line{changed === 1 ? "" : "s"}</span>
        <div className="ml-auto flex gap-1">
          <Button size="sm" variant="ghost" className="h-7" onClick={onReject}><X className="size-3.5" />Reject</Button>
          <Button size="sm" className="h-7" disabled={readOnly} onClick={async () => setResult(await onAccept())}><Check className="size-3.5" />Accept</Button>
        </div>
      </div>
      <pre className="max-h-48 overflow-auto rounded-md border bg-background p-2 font-mono text-xs leading-5">
        {hunks(proposal.diff).map((line, i) => line.kind === "fold" ? (
          <div key={i} className="px-1 text-muted-foreground">⋯ {line.count} unchanged line{line.count === 1 ? "" : "s"}</div>
        ) : (
          <div key={i} data-diff={line.kind} className={cn("whitespace-pre-wrap px-1", line.kind === "add" && "bg-primary/10 text-primary", line.kind === "remove" && "bg-destructive/10 text-destructive line-through")}>
            {line.kind === "add" ? "+ " : line.kind === "remove" ? "- " : "  "}{line.text}
          </div>
        ))}
      </pre>
      {result && result.outcome !== "committed" && <p role="status" className="mt-1 text-xs text-destructive">{result.outcome}: {JSON.stringify(result.detail)}</p>}
    </section>
  )
}
