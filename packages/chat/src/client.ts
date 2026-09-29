/**
 * The wire client: plain fetch and NDJSON, no framework. It sends what a person says and replays
 * or follows a thread's events by cursor; it keeps no state the wire could not rebuild (CHAT-1).
 */
import type { Event, JobView, RunView } from "@boring/agent/wire";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type ChatClientOptions = Readonly<{
  /** The agent endpoint the application mounted, e.g. "/agent". */
  endpoint: string;
  /** Defaults to the global fetch. Cookies and headers are the application's; pass a wrapper to add them. */
  fetch?: Fetch;
}>;

/** The boundary between the chat and the wire; a page can implement it over anything that speaks the wire. */
export interface ChatClient {
  say(conversation: string, text: string, options?: { thread?: string; inputs?: Record<string, unknown>; idempotencyKey?: string }): Promise<{ thread: string; run: RunView }>;
  cancel(run: string): Promise<RunView>;
  run(id: string): Promise<RunView>;
  job(id: string): Promise<JobView>;
  /** Replays the thread's events after the cursor, then follows live ones until the signal aborts. */
  follow(scope: { thread: string } | { run: string }, options?: { cursor?: string; live?: boolean; signal?: AbortSignal }): AsyncIterable<Event>;
}

export class WireRequestError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function json<T>(response: Response): Promise<T> {
  const text = await response.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  if (!response.ok) throw new WireRequestError(response.status, (parsed as { error?: string } | null)?.error ?? `${response.status}`);
  return parsed as T;
}

/** Splits a byte stream into NDJSON lines; a partial trailing line waits for the next chunk. */
export async function* ndjson(stream: ReadableStream<Uint8Array> | null, signal?: AbortSignal): AsyncIterable<Event> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const stop = () => reader.cancel().catch(() => {});
  signal?.addEventListener("abort", stop, { once: true });
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) yield JSON.parse(line) as Event;
      }
    }
    if (buffer.trim()) yield JSON.parse(buffer) as Event;
  } finally { signal?.removeEventListener("abort", stop); }
}

export function createChatClient({ endpoint, fetch: doFetch = (input, init) => fetch(input, init) }: ChatClientOptions): ChatClient {
  const base = endpoint.replace(/\/$/, "");
  const post = (route: string, body: unknown) => doFetch(`${base}${route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return {
    say: (conversation, text, options = {}) => post(`/conversations/${encodeURIComponent(conversation)}/messages`, { text, ...options }).then(r => json<{ thread: string; run: RunView }>(r)),
    cancel: run => post(`/runs/${encodeURIComponent(run)}/cancel`, {}).then(r => json<RunView>(r)),
    run: id => doFetch(`${base}/runs/${encodeURIComponent(id)}`).then(r => json<RunView>(r)),
    job: id => doFetch(`${base}/jobs/${encodeURIComponent(id)}`).then(r => json<JobView>(r)),
    async *follow(scope, options = {}) {
      const query = new URLSearchParams();
      if (options.cursor) query.set("cursor", options.cursor);
      if (options.live === false) query.set("live", "0");
      const route = "run" in scope ? `/runs/${encodeURIComponent(scope.run)}/events` : `/threads/${encodeURIComponent(scope.thread)}/events`;
      const response = await doFetch(`${base}${route}?${query}`, { signal: options.signal });
      if (!response.ok) await json(response);
      yield* ndjson(response.body, options.signal);
    },
  };
}
