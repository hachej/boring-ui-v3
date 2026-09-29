import type { SlotProps } from "@boring/chat"
import { cn } from "@/lib/utils"

export function ChatMessage({ message, children }: SlotProps["Message"]) {
  const person = message.role === "person"
  return (
    <li data-boring="message" data-role={message.role} className={cn("flex max-w-[85%] flex-col gap-2 rounded-lg px-3 py-2 text-sm leading-relaxed", person ? "self-end bg-primary text-primary-foreground" : "self-start border bg-card text-card-foreground")}>
      {children}
    </li>
  )
}

export function ChatText({ part }: SlotProps["Text"]) {
  return <span data-boring="text" className="whitespace-pre-wrap">{part.text}</span>
}
