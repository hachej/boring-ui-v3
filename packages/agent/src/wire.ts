/**
 * The wire between the agent endpoint and a chat. Types only: @boring/chat depends on this file
 * and on nothing else in the package (BORING-6). Every event is replayable by cursor (CHAT-1).
 */
export type Cursor = string;

export type Part =
  | { type: "text"; text: string }
  | { type: "tool"; name: string; input: unknown; state: "running" | "done" | "error"; output?: unknown; error?: string }
  | { type: "ask"; decision: string; question: string; answered?: boolean }
  | { type: "approve"; decision: string; subject: { mount: string; path: string; revision: string }; answered?: boolean }
  | { type: "artefact"; mount: string; path: string; revision: string };

export type Message = Readonly<{ id: string; role: "person" | "agent"; parts: readonly Part[]; at: string }>;

export type Event =
  | { cursor: Cursor; kind: "message"; message: Message }
  | { cursor: Cursor; kind: "run"; run: { id: string; status: string } }
  | { cursor: Cursor; kind: "decision"; decision: string; answered: boolean };

/** What a chat sends. The actor is never in the body; it comes from the session (CHAT-4). */
export type Inbound =
  | { type: "say"; thread: string; text: string }
  | { type: "answer"; decision: string; value: unknown }
  | { type: "cancel"; run: string };
