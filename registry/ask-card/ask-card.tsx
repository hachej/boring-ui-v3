"use client"

// Boring UI registry: ask-card. A question the agent asked (the AskCard slot). The answer is the person's, sent
// with their session (CHAT-4); until the runtime records decisions the card shows the question and its state.
import { MessageCircleQuestion } from "lucide-react"
import type { SlotProps } from "@boring/chat"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"

export function AskCard({ part }: SlotProps["AskCard"]) {
  return (
    <Card data-boring="ask" data-answered={part.answered ? "" : undefined} className="gap-0 py-0 shadow-none">
      <CardContent className="flex items-start gap-2 p-3 text-sm">
        <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-primary" />
        <p className="flex-1">{part.question}</p>
        <Badge variant={part.answered ? "secondary" : "outline"}>{part.answered ? "answered" : "asked"}</Badge>
      </CardContent>
    </Card>
  )
}
