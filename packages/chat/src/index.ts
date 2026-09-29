/**
 * @boring/chat — the public contract of the chat component.
 *
 * One component, any layout (CHAT-2). It reads the wire and renders; it adds no rule (CHAT-1).
 * The only import from the agent package is its wire types (BORING-6); no Flue here.
 */
import type { Event, Inbound, Message, RunView } from "@boring/agent/wire";
import type { ChatClient, Fetch } from "./client.ts";

export { createChatClient, ndjson, WireRequestError, type ChatClient, type ChatClientOptions, type Fetch } from "./client.ts";
export { BoringChat } from "./BoringChat.tsx";

export type ChatProps = Readonly<{
  /** The agent endpoint the application mounted, e.g. "/agent". */
  endpoint: string;
  /** The conversation (conversations/<name>) a message goes to. */
  conversation: string;
  /** An existing thread to show; omitted, the first message creates one. */
  thread?: string;
  /** Extra inputs the conversation's context receives with every message. */
  inputs?: Record<string, unknown>;
  /** Called for every replayed or live event; the component keeps no other state (CHAT-1). */
  onEvent?: (event: Event) => void;
  /** The application's fetch (its cookies, its headers). Defaults to the global one. */
  fetch?: Fetch;
  /** A ready client, for tests or a page that already has one. */
  client?: ChatClient;
}>;

/** A command the application allows the agent to run on its page (CHAT-3). Deferred: no bridge yet. */
export type UiCommand<Input = unknown> = Readonly<{
  description: string;
  input: Record<string, unknown>;
  run: (input: Input) => void | Promise<void>;
}>;

export type UiRegistration = Readonly<{
  commands: Readonly<Record<string, UiCommand>>;
  /** Read-only report of what the page shows, for the agent's `get_ui_state` (CHAT-3). */
  state: () => unknown;
}>;

export type { Event, Inbound, Message, RunView };
