/**
 * The page-command bridge (CHAT-3). A page instance registers the commands it offers on a thread, follows
 * the thread's `ui` events, and answers each request addressed to it exactly once. It refuses before the
 * handler runs what the schema does not allow, what another page was asked, and what was asked of a
 * target the page has left (UI-BOUNDARY-4). Its answers say whether the page merely did something locally
 * or the application committed something (UI-BOUNDARY-5). It speaks to the wire only, so it works the same
 * whether the runtime is in the application's process or a separate service. No React here.
 */
import type { Event, UiRequestView, UiResult, UiTarget } from "@boring/agent/wire";
import type { ChatClient } from "./client.ts";
import { validateInput } from "./schema.ts";

export { validateInput };

export type PageCommand<Input = unknown> = Readonly<{
  name: string;
  description: string;
  /** JSON schema of the input (an object schema). */
  input: Record<string, unknown>;
  /** Runs on the page. Return what happened: `applied` for local interaction, `committed` only for what the application's backend accepted. */
  handler: (input: Input, context: { request: UiRequestView; target?: UiTarget }) => UiResult | Promise<UiResult>;
}>;

export type UiBridgeOptions = Readonly<{
  client: ChatClient;
  thread: string;
  /** This page instance; a remount is a new page (UI-BOUNDARY-4). Random by default. */
  page?: string;
  commands: readonly PageCommand[];
  /** What the page shows now; reported at registration and compared when a request arrives. */
  target?: () => UiTarget | undefined;
  /** Every request seen and every answer given, for the page's own log. */
  onAnswer?: (request: UiRequestView, result: UiResult) => void;
}>;

export interface UiBridge {
  readonly page: string;
  readonly thread: string;
  /** Registers, then follows the thread live until stopped. */
  start(): Promise<void>;
  /** Unregisters; open requests to this page end `unavailable` on the runtime side. */
  stop(): Promise<void>;
  /** Handles one event from a stream the page already follows (instead of `start`'s own stream). */
  handle(event: Event): Promise<void>;
  /** The page moved to another target: re-registers so later requests bind to it. */
  retarget(): Promise<void>;
}

export const pageId = () => `p-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

export function createUiBridge(options: UiBridgeOptions): UiBridge {
  const { client, thread, commands } = options;
  const page = options.page ?? pageId();
  const byName = new Map(commands.map(c => [c.name, c]));
  const answered = new Set<string>();
  let controller: AbortController | null = null;
  const specs = commands.map(({ name, description, input }) => ({ name, description, input }));
  const register = () => client.registerUi(thread, page, { commands: specs, ...(options.target?.() ? { target: options.target()! } : {}) });
  const sameTarget = (a?: UiTarget, b?: UiTarget) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

  async function answer(request: UiRequestView, result: UiResult) {
    if (answered.has(request.id)) return;
    answered.add(request.id);
    options.onAnswer?.(request, result);
    try { await client.answerUi(request.run, request.id, { page, result }); } catch { /* expired or already answered on the runtime side: the record decides (BORING-4) */ }
  }

  async function handle(event: Event) {
    if (event.kind !== "ui" || event.ui.page !== page || event.ui.state !== "requested" || answered.has(event.ui.id)) return;
    const request = event.ui;
    const command = byName.get(request.command);
    if (!command) return answer(request, { outcome: "denied", detail: `this page does not offer ${request.command}` });
    const errors = validateInput(command.input, request.input);
    if (errors.length) return answer(request, { outcome: "denied", detail: errors });
    const current = options.target?.();
    if (request.target && !sameTarget(request.target, current)) return answer(request, { outcome: "stale", detail: { requested: request.target, current: current ?? null } });
    try { return await answer(request, await command.handler(request.input, { request, target: current })); }
    catch (error) { return answer(request, { outcome: "unavailable", detail: (error as Error).message }); }
  }

  return {
    page, thread,
    async start() {
      await register();
      controller = new AbortController();
      const signal = controller.signal;
      (async () => {
        try { for await (const event of client.follow({ thread }, { signal })) await handle(event); }
        catch { /* aborted or disconnected: the runtime expires what we did not answer */ }
      })();
    },
    async stop() {
      controller?.abort(); controller = null;
      try { await client.unregisterUi(thread, page); } catch { /* the thread may be gone */ }
    },
    handle,
    retarget: async () => { await register(); },
  };
}
