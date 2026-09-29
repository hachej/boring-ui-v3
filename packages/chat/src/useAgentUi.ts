/**
 * `useAgentUi`: the bridge as a React hook. The page declares its commands and what it shows; the hook
 * keeps one registration per mounted component and thread, and re-registers when the target changes.
 * Unmounting stops the bridge: a new mount is a new page instance (UI-BOUNDARY-4).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { UiRequestView, UiResult, UiTarget } from "@boring/agent/wire";
import type { ChatClient } from "./client.ts";
import { createUiBridge, pageId, type PageCommand } from "./bridge.ts";

export type UseAgentUiOptions = Readonly<{
  client: ChatClient;
  /** The thread the chat is on; until it exists there is nothing to register on. */
  thread?: string;
  commands: readonly PageCommand[];
  target?: UiTarget;
  onAnswer?: (request: UiRequestView, result: UiResult) => void;
}>;

export function useAgentUi({ client, thread, commands, target, onAnswer }: UseAgentUiOptions): { page: string; registered: boolean } {
  const page = useMemo(pageId, []);
  const latest = useRef({ commands, target, onAnswer });
  latest.current = { commands, target, onAnswer };
  const [registered, setRegistered] = useState(false);
  const commandsKey = JSON.stringify(commands.map(({ name, description, input }) => ({ name, description, input })));
  const targetKey = JSON.stringify(target ?? null);
  const bridge = useRef<ReturnType<typeof createUiBridge> | null>(null);

  useEffect(() => {
    if (!thread) return;
    const instance = createUiBridge({
      client, thread, page,
      commands: latest.current.commands.map(command => ({ ...command, handler: (input, context) => (latest.current.commands.find(c => c.name === command.name) ?? command).handler(input, context) })),
      target: () => latest.current.target,
      onAnswer: (request, result) => latest.current.onAnswer?.(request, result),
    });
    bridge.current = instance;
    let alive = true;
    instance.start().then(() => { if (alive) setRegistered(true); }).catch(() => {});
    return () => { alive = false; setRegistered(false); bridge.current = null; void instance.stop(); };
  }, [client, thread, page, commandsKey]);

  useEffect(() => { if (registered) void bridge.current?.retarget(); }, [targetKey, registered]);

  return { page, registered };
}
