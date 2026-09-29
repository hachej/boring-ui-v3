/**
 * BoringChat: one React shell over the wire. It shows a thread rebuilt from events, sends a message to a
 * conversation and follows the run it started. It owns no layout and no global state (CHAT-2): every
 * style is inline and reads a `--boring-*` token with a default (theme.ts), `headless` renders bare
 * elements with data attributes only, and every piece is a slot the host can replace. Every line it
 * renders came from the wire (CHAT-1).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { Event, Message, Part, RunView, UiRequestView } from "@boring/agent/wire";
import { createChatClient, type ChatClient } from "./client.ts";
import type { ChatProps, ChatSlots, SlotProps } from "./index.ts";
import { v, type Theme } from "./theme.ts";

type State = { messages: Message[]; runs: Record<string, RunView>; ui: Record<string, UiRequestView>; cursor?: string };

export function reduce(state: State, event: Event): State {
  if (event.kind === "message") return { ...state, cursor: event.cursor, messages: state.messages.some(m => m.id === event.message.id) ? state.messages : [...state.messages, event.message] };
  if (event.kind === "run") return { ...state, cursor: event.cursor, runs: { ...state.runs, [event.run.id]: event.run } };
  if (event.kind === "ui") return { ...state, cursor: event.cursor, ui: { ...state.ui, [event.ui.id]: event.ui } };
  return { ...state, cursor: event.cursor };
}

const styled = (headless: boolean | undefined, style: CSSProperties): CSSProperties | undefined => (headless ? undefined : style);

/** The default slots. Each renders data attributes a host can style in headless mode. */
export const defaultSlots: ChatSlots = {
  Message: ({ message, headless, children }) => (
    <li data-boring="message" data-role={message.role} style={styled(headless, { alignSelf: message.role === "person" ? "flex-end" : "flex-start", maxWidth: v("--boring-bubble-max"), padding: "8px 12px", borderRadius: v("--boring-radius"), background: message.role === "person" ? v("--boring-person-bg") : v("--boring-agent-bg"), color: message.role === "person" ? v("--boring-person-fg") : v("--boring-agent-fg"), whiteSpace: "pre-wrap" })}>
      {children}
    </li>
  ),
  Text: ({ part }) => <span data-boring="text">{part.text}</span>,
  ToolCall: ({ part, headless }) => (
    <details data-boring="tool" data-state={part.state} style={styled(headless, { fontSize: "0.9em", background: v("--boring-tool-bg"), border: `1px solid ${v("--boring-border")}`, borderRadius: v("--boring-radius"), padding: "4px 8px" })}>
      <summary>{part.name} · {part.state}</summary>
      <pre style={styled(headless, { margin: 0, whiteSpace: "pre-wrap" })}>{JSON.stringify(part.input, null, 1)}</pre>
      {part.output !== undefined && <pre style={styled(headless, { margin: 0, whiteSpace: "pre-wrap" })}>{typeof part.output === "string" ? part.output : JSON.stringify(part.output, null, 1)}</pre>}
      {part.error && <p data-boring="error" style={styled(headless, { color: v("--boring-danger"), margin: 0 })}>{part.error}</p>}
    </details>
  ),
  AskCard: ({ part, headless }) => (
    <div data-boring="ask" data-answered={part.answered ? "" : undefined} style={styled(headless, { background: v("--boring-card-bg"), border: `1px solid ${v("--boring-border")}`, borderRadius: v("--boring-radius"), padding: "8px 12px" })}>
      <p style={styled(headless, { margin: 0 })}>{part.question}</p>
    </div>
  ),
  ApprovalCard: ({ part, headless }) => (
    <div data-boring="approve" data-answered={part.answered ? "" : undefined} style={styled(headless, { background: v("--boring-card-bg"), border: `1px solid ${v("--boring-border")}`, borderRadius: v("--boring-radius"), padding: "8px 12px" })}>
      <p style={styled(headless, { margin: 0 })}>Approve /{part.subject.mount}/{part.subject.path} at {part.subject.revision}?</p>
    </div>
  ),
  Artefact: ({ part, headless }) => <a data-boring="artefact" href={`#/${part.mount}/${part.path}`} style={styled(headless, { color: v("--boring-accent") })}>/{part.mount}/{part.path} @ {part.revision}</a>,
  UiRequest: ({ request, headless }) => (
    <li data-boring="ui" data-state={request.state} style={styled(headless, { alignSelf: "flex-start", color: v("--boring-muted"), fontSize: "0.9em" })}>
      page · {request.command} · {request.state}{request.result ? ` · ${request.result.outcome}` : ""}
    </li>
  ),
  RunStatus: ({ run, cancel, headless }) => (
    <li data-boring="run" data-run={run.id} data-status={run.status} style={styled(headless, { alignSelf: "flex-start", color: v("--boring-muted"), fontSize: "0.9em" })}>
      {run.agent} is {run.status}… <button type="button" onClick={cancel}>stop</button>
    </li>
  ),
  Composer: ({ value, onChange, onSubmit, disabled, placeholder, headless }) => (
    <form data-boring="composer" onSubmit={e => { e.preventDefault(); onSubmit(); }} style={styled(headless, { display: "flex", gap: v("--boring-gap") })}>
      <input aria-label="message" value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} style={styled(headless, { flex: 1, padding: 8, borderRadius: v("--boring-radius"), border: `1px solid ${v("--boring-border")}`, font: "inherit", color: "inherit", background: "transparent" })} />
      <button type="submit" disabled={disabled} style={styled(headless, { padding: "8px 12px", borderRadius: v("--boring-radius"), border: 0, background: v("--boring-accent"), color: v("--boring-accent-fg"), font: "inherit" })}>Send</button>
    </form>
  ),
};

function renderPart(part: Part, message: Message, slots: ChatSlots, headless: boolean | undefined, key: number): ReactNode {
  const common = { message, headless };
  switch (part.type) {
    case "text": return <slots.Text key={key} part={part} {...common} />;
    case "tool": return <slots.ToolCall key={key} part={part} {...common} />;
    case "ask": return <slots.AskCard key={key} part={part} {...common} />;
    case "approve": return <slots.ApprovalCard key={key} part={part} {...common} />;
    case "artefact": return <slots.Artefact key={key} part={part} {...common} />;
  }
}

export function BoringChat({ endpoint, conversation, thread: initialThread, inputs, onEvent, onThread, fetch: doFetch, client: given, slots: custom, theme, headless, className, style, placeholder = "Say something" }: ChatProps) {
  const client = useRef<ChatClient>(given ?? createChatClient({ endpoint, fetch: doFetch })).current;
  const slots = useMemo<ChatSlots>(() => ({ ...defaultSlots, ...custom }), [custom]);
  const [thread, setThread] = useState<string | undefined>(initialThread);
  const [state, setState] = useState<State>({ messages: [], runs: {}, ui: {} });
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const cursor = useRef<string | undefined>(undefined);

  useEffect(() => { if (thread) onThread?.(thread); }, [thread, onThread]);
  // No thread yet: make one now, so the page's commands are registered before the first message (CHAT-3).
  useEffect(() => {
    if (thread) return;
    let alive = true;
    client.createThread().then(t => { if (alive) setThread(t.id); }).catch(e => { if (alive) setError((e as Error).message); });
    return () => { alive = false; };
  }, [client, thread]);

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
  const open = Object.values(state.ui).filter(r => r.state === "requested");
  const rootStyle: CSSProperties | undefined = headless ? style : { display: "flex", flexDirection: "column", gap: v("--boring-gap"), height: "100%", minHeight: 0, boxSizing: "border-box", fontFamily: v("--boring-font"), fontSize: v("--boring-font-size"), color: v("--boring-fg"), background: v("--boring-bg"), ...(theme as CSSProperties | undefined), ...style };

  return (
    <div data-boring-chat="" data-headless={headless ? "" : undefined} className={className} style={rootStyle}>
      <ol data-boring="messages" style={styled(headless, { listStyle: "none", margin: 0, padding: 0, flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: v("--boring-gap") })}>
        {state.messages.map(message => <slots.Message key={message.id} message={message} headless={headless}>{message.parts.map((part, i) => renderPart(part, message, slots, headless, i))}</slots.Message>)}
        {open.map(request => <slots.UiRequest key={request.id} request={request} headless={headless} />)}
        {active.map(run => <slots.RunStatus key={run.id} run={run} headless={headless} cancel={() => client.cancel(run.id).catch(e => setError((e as Error).message))} />)}
      </ol>
      {error && <p role="alert" data-boring="error" style={styled(headless, { color: v("--boring-danger"), margin: 0 })}>{error}</p>}
      <slots.Composer value={text} onChange={setText} onSubmit={() => void send()} disabled={!text.trim()} placeholder={placeholder} headless={headless} />
    </div>
  );
}

export type { Theme, SlotProps };
