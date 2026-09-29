/**
 * Binding a viewer to the agent: its tools become page commands on the thread, through @boring/chat's bridge
 * (CHAT-3). One mounted viewer is one page instance; a remount or another document is a new binding, and a
 * request made for the old target is answered `stale` (UI-BOUNDARY-4, VIEWERS-4). Without `agent` nothing is
 * registered and the viewer works for the person alone.
 */
import { useEffect, useMemo, useRef } from "react";
import type { ChatClient, PageCommand, UiRequestView, UiResult, UiTarget } from "@boring/chat";
import { createUiBridge, pageId } from "@boring/chat/bridge";
import { call, type ViewerTool } from "./tool.ts";

export type AgentBinding = Readonly<{
  client: ChatClient;
  /** The chat's thread; until it exists there is nothing to register on. */
  thread?: string;
  /** Every request this viewer answered, for the page's own log. */
  onAnswer?: (request: UiRequestView, result: UiResult) => void;
}>;

/** The page commands of a viewer: `<namespace>_<tool>`, each running the same `call` as the person's control. */
export function pageCommands(tools: readonly ViewerTool[], namespace: string): PageCommand[] {
  return tools.map(tool => ({
    name: namespace ? `${namespace}_${tool.name}` : tool.name,
    description: `${tool.description} [${tool.effect}]`,
    input: tool.input as Record<string, unknown>,
    handler: input => call(tool, input),
  }));
}

export function useViewerAgent(tools: readonly ViewerTool[], options: { agent?: AgentBinding; namespace: string; target?: UiTarget }): { page: string } {
  const { agent, namespace, target } = options;
  const page = useMemo(pageId, []);
  const latest = useRef({ tools, target, onAnswer: agent?.onAnswer });
  latest.current = { tools, target, onAnswer: agent?.onAnswer };
  const key = JSON.stringify(tools.map(t => [t.name, t.description, t.input, t.effect]));
  const targetKey = JSON.stringify(target ?? null);
  const bridge = useRef<ReturnType<typeof createUiBridge> | null>(null);
  const registeredTarget = useRef<string | null>(null);
  const client = agent?.client, thread = agent?.thread;

  useEffect(() => {
    if (!client || !thread) return;
    // Handlers resolve the tool by name at call time, so a re-render never answers with a stale closure.
    const commands = pageCommands(latest.current.tools, namespace).map((command, i) => {
      const name = latest.current.tools[i]!.name;
      return { ...command, handler: (input: unknown) => call(latest.current.tools.find(t => t.name === name)!, input) };
    });
    const instance = createUiBridge({ client, thread, page: `${page}-${namespace}`.slice(0, 64), commands, target: () => latest.current.target, onAnswer: (r, res) => latest.current.onAnswer?.(r, res) });
    bridge.current = instance;
    registeredTarget.current = JSON.stringify(latest.current.target ?? null);
    void instance.start().catch(() => {});
    return () => { bridge.current = null; void instance.stop(); };
  }, [client, thread, page, namespace, key]);

  useEffect(() => {
    if (!bridge.current || registeredTarget.current === targetKey) return;
    registeredTarget.current = targetKey;
    void bridge.current.retarget().catch(() => {});
  }, [targetKey]);
  return { page: `${page}-${namespace}` };
}
