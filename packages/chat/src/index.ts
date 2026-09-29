/**
 * @boring/chat — the public contract of the chat shell and the page-command bridge.
 *
 * One component, any layout, any skin (CHAT-2, CHAT-5). It reads the wire and renders; it adds no rule
 * (CHAT-1). The bridge lets the agent drive the page only through commands the page registered (CHAT-3).
 * The only import from the agent package is its wire types (BORING-6); no Flue here.
 */
import type { ComponentType, ReactNode } from "react";
import type { Event, Inbound, Message, Part, RunView, UiRequestView, UiResult, UiTarget } from "@boring/agent/wire";
import type { ChatClient, Fetch } from "./client.ts";
import type { Theme } from "./theme.ts";

export { createChatClient, ndjson, WireRequestError, type ChatClient, type ChatClientOptions, type Fetch } from "./client.ts";
export { BoringChat, defaultSlots } from "./BoringChat.tsx";
export { createUiBridge, pageId, type PageCommand, type UiBridge, type UiBridgeOptions } from "./bridge.ts";
export { useAgentUi, type UseAgentUiOptions } from "./useAgentUi.ts";
export { validateInput } from "./schema.ts";
export { TOKENS, v as token, type Theme, type Token } from "./theme.ts";

type PartOf<T extends Part["type"]> = Extract<Part, { type: T }>;

/** What each slot receives. `headless` asks the slot to render no style of its own. */
export type SlotProps = {
  Message: { message: Message; headless?: boolean; children?: ReactNode };
  Text: { part: PartOf<"text">; message: Message; headless?: boolean };
  ToolCall: { part: PartOf<"tool">; message: Message; headless?: boolean };
  AskCard: { part: PartOf<"ask">; message: Message; headless?: boolean };
  ApprovalCard: { part: PartOf<"approve">; message: Message; headless?: boolean };
  Artefact: { part: PartOf<"artefact">; message: Message; headless?: boolean };
  UiRequest: { request: UiRequestView; headless?: boolean };
  RunStatus: { run: RunView; cancel: () => void; headless?: boolean };
  Composer: { value: string; onChange: (value: string) => void; onSubmit: () => void; disabled: boolean; placeholder?: string; headless?: boolean };
};
export type ChatSlots = { [K in keyof SlotProps]: ComponentType<SlotProps[K]> };

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
  /** The thread the shell is on, as soon as it exists: what `useAgentUi` registers on. */
  onThread?: (thread: string) => void;
  /** The application's fetch (its cookies, its headers). Defaults to the global one. */
  fetch?: Fetch;
  /** A ready client, for tests or a page that already has one. */
  client?: ChatClient;
  /** Replace any piece of the shell. */
  slots?: Partial<ChatSlots>;
  /** Token values set on the root; any ancestor's `--boring-*` custom properties work too. */
  theme?: Theme;
  /** Render bare elements with `data-boring` attributes and no inline style; the host styles everything. */
  headless?: boolean;
  className?: string;
  style?: React.CSSProperties;
  placeholder?: string;
}>;

export type { Event, Inbound, Message, Part, RunView, UiRequestView, UiResult, UiTarget };
