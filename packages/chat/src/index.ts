/**
 * @boring/chat — the public contract of the chat component.
 *
 * One component, any layout (CHAT-2). It reads the wire and renders; it adds no rule (CHAT-1).
 * The only import from the agent package is its wire types (BORING-6).
 */
import type { Event, Inbound, Message } from "@boring/agent/wire";

export type ChatProps = Readonly<{
  /** The agent endpoint the application mounted, e.g. "/agent". */
  endpoint: string;
  thread: string;
  /** Called for every replayed or live event; the component keeps no other state (CHAT-1). */
  onEvent?: (event: Event) => void;
}>;

/** A command the application allows the agent to run on its page (CHAT-3). */
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

export type { Event, Inbound, Message };
