"use client"

// Boring UI registry: chat. @boring/chat's BoringChat in headless mode, dressed with shadcn primitives and your
// tokens through its slots. The transcript is rebuilt from the wire (CHAT-1); this file only decides the look.
import { useCallback, useEffect, useRef, useState } from "react"
import { ArrowUp, Square } from "lucide-react"
import { BoringChat, type ChatClient, type SlotProps } from "@boring/chat"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { ChatMessage, ChatText } from "@/components/chat-message"
import { ToolCall } from "@/components/tool-call"
import { AskCard } from "@/components/ask-card"
import { ApprovalCard } from "@/components/approval-card"
import { cn } from "@/lib/utils"

export type ChatProps = {
  endpoint?: string
  conversation: string
  client?: ChatClient
  thread?: string
  onThread?: (thread: string) => void
  inputs?: Record<string, unknown>
  placeholder?: string
  className?: string
}

function Composer({ value, onChange, onSubmit, disabled, placeholder }: SlotProps["Composer"]) {
  return (
    <form data-boring="composer" className="flex items-end gap-2 rounded-lg border bg-card p-2" onSubmit={e => { e.preventDefault(); onSubmit() }}>
      <Textarea
        aria-label="message"
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (!disabled) onSubmit() } }}
        className="max-h-40 min-h-9 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
      />
      <Button type="submit" size="icon" className="size-8 shrink-0 rounded-full" disabled={disabled} aria-label="Send"><ArrowUp className="size-4" /></Button>
    </form>
  )
}

function RunStatus({ run, cancel }: SlotProps["RunStatus"]) {
  return (
    <li data-boring="run" data-run={run.id} data-status={run.status} className="flex items-center gap-2 self-start text-xs text-muted-foreground">
      <span className="size-2 animate-pulse rounded-full bg-primary" />{run.agent} is {run.status}…
      <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={cancel}><Square className="size-3" />stop</Button>
    </li>
  )
}

function UiRequest({ request }: SlotProps["UiRequest"]) {
  return <li data-boring="ui" data-state={request.state} className="self-start font-mono text-xs text-muted-foreground">page · {request.command} · {request.state}</li>
}

function Artefact({ part }: SlotProps["Artefact"]) {
  return <a data-boring="artefact" href={`#/${part.mount}/${part.path}`} className="font-mono text-xs text-primary underline-offset-2 hover:underline">/{part.mount}/{part.path} @ {part.revision}</a>
}

const slots = { Message: ChatMessage, Text: ChatText, ToolCall, AskCard, ApprovalCard, Artefact, UiRequest, RunStatus, Composer }

export function Chat({ endpoint = "/agent", conversation, client, thread, onThread, inputs, placeholder = "Ask the agent", className }: ChatProps) {
  const root = useRef<HTMLDivElement>(null)
  const [count, setCount] = useState(0)
  // Stable: BoringChat follows the thread again whenever onEvent changes.
  const onEvent = useCallback(() => setCount(c => c + 1), [])
  // Keep the newest message in view.
  useEffect(() => { const list = root.current?.querySelector("[data-boring=messages]"); list?.scrollTo({ top: list.scrollHeight }) }, [count])
  return (
    <div ref={root} className={cn("h-full min-h-0", className)}>
      <BoringChat
        headless
        endpoint={endpoint}
        conversation={conversation}
        client={client}
        thread={thread}
        onThread={onThread}
        inputs={inputs}
        placeholder={placeholder}
        onEvent={onEvent}
        slots={slots}
        className="flex h-full min-h-0 flex-col gap-3 text-foreground [&_[data-boring=messages]]:flex [&_[data-boring=messages]]:min-h-0 [&_[data-boring=messages]]:flex-1 [&_[data-boring=messages]]:flex-col [&_[data-boring=messages]]:gap-3 [&_[data-boring=messages]]:overflow-auto [&_[data-boring=error]]:text-sm [&_[data-boring=error]]:text-destructive"
      />
    </div>
  )
}
