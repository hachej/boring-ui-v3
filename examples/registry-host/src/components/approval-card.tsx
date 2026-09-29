"use client"

// Boring UI registry: approval-card. An approval the agent requested on one file revision (the ApprovalCard slot).
// Approval binds the authenticated person and that exact revision (UI-BOUNDARY-5); the card shows what is asked.
import { ShieldCheck } from "lucide-react"
import type { SlotProps } from "@boring/chat"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

export function ApprovalCard({ part }: SlotProps["ApprovalCard"]) {
  const { mount, path, revision } = part.subject
  return (
    <Card data-boring="approve" data-answered={part.answered ? "" : undefined} className="gap-0 py-0 shadow-none">
      <CardContent className="flex items-start gap-2 p-3 text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-primary" />
        <div className="flex-1">
          <p>Approve this version?</p>
          <p className="font-mono text-xs text-muted-foreground">/{mount}/{path} @ {revision}</p>
        </div>
        <Badge variant={part.answered ? "secondary" : "outline"}>{part.answered ? "decided" : "awaiting you"}</Badge>
      </CardContent>
    </Card>
  )
}
