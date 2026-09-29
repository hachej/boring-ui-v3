/**
 * BoringChat: one React component over the wire. It shows a thread rebuilt from events, sends a
 * message to a conversation, and follows the run it started. It owns no layout and no global
 * state (CHAT-2); every line it renders came from the wire (CHAT-1).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { Event, Message, RunView } from "@boring/agent/wire";
import { createChatClient, type ChatClient } from "./client.ts";
import type { ChatProps } from "./index.ts";

type State = { messages: Message[]; runs: Record<string, RunView>; cursor?: string };

function reduce(state: State, event: Event): State {
  if (event.kind === "message") return { ...state, cursor: event.cursor, messages: state.messages.some(m => m.id === event.message.id) ? state.messages : [...state.messages, event.message] };
  if (event.kind === "run") return { ...state, cursor: event.cursor, runs: { ...state.runs, [event.run.id]: event.run } };
  return { ...state, cursor: event.cursor };
}

export function BoringChat({ endpoint, conversation, thread: initialThread, inputs, onEvent, fetch: doFetch, client: given }: ChatProps) {
  const client = useRef<ChatClient>(given ?? createChatClient({ endpoint, fetch: doFetch })).current;
  const [thread, setThread] = useState<string | undefined>(initialThread);
  const [state, setState] = useState<State>({ messages: [], runs: {} });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef<string | undefined>(undefined);

  // Follow the thread: replay after the last cursor, then live. Reconnecting rebuilds everything from records.
  useEffect(() => {
    if (!thread) return;
    const controller = new AbortController();
    (async () => {
      try {
        for await (const event of client.follow({ thread }, { cursor: cursor.current, signal: controller.signal })) {
          cursor.current = event.cursor;
          setState(s => reduce(s, event));
          onEvent?.(event);
        }
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
    })();
    return () => controller.abort();
  }, [client, thread, onEvent]);

  const send = useCallback(async () => {
    const line = text.trim();
    if (!line) return;
    setText(""); setError(null);
    try {
      const { thread: id } = await client.say(conversation, line, { thread, inputs });
      if (id !== thread) setThread(id);
    } catch (e) { setError((e as Error).message); }
  }, [client, conversation, thread, inputs, text]);

  const active = Object.values(state.runs).filter(r => r.status === "pending" || r.status === "running");

  return (
    <div data-boring-chat="" style={{ display: "flex", flexDirection: "column", gap: 8, height: "100%", fontFamily: "system-ui, sans-serif" }}>
      <ol style={{ listStyle: "none", margin: 0, padding: 0, flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 8 }}>
        {state.messages.map(message => (
          <li key={message.id} data-role={message.role} style={{ alignSelf: message.role === "person" ? "flex-end" : "flex-start", maxWidth: "80%", padding: "8px 12px", borderRadius: 12, background: message.role === "person" ? "#dbeafe" : "#f3f4f6", whiteSpace: "pre-wrap" }}>
            {message.parts.map((part, i) => part.type === "text" ? <span key={i}>{part.text}</span> : <code key={i}>{part.type}</code>)}
          </li>
        ))}
        {active.map(run => (
          <li key={run.id} data-run={run.id} style={{ alignSelf: "flex-start", color: "#6b7280", fontSize: 13 }}>
            {run.agent} is {run.status}… <button type="button" onClick={() => client.cancel(run.id).catch(e => setError((e as Error).message))}>stop</button>
          </li>
        ))}
      </ol>
      {error && <p role="alert" style={{ color: "#b91c1c", margin: 0 }}>{error}</p>}
      <form onSubmit={e => { e.preventDefault(); void send(); }} style={{ display: "flex", gap: 8 }}>
        <input aria-label="message" value={text} onChange={e => setText(e.target.value)} placeholder="Say something" style={{ flex: 1, padding: 8 }} />
        <button type="submit" disabled={!text.trim()}>Send</button>
      </form>
    </div>
  );
}
