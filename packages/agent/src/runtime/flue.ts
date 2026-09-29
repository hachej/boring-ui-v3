/**
 * The agents run in the Flue harness (@flue/runtime), in the application's process. One generic
 * agent serves every run: its instance is created with the run's id in `initialData` and reads
 * its definition (prompt, output tool, helper tools, model) from this module's registry of active
 * runs. Public seams only: `defineTool` with `terminate`, `useResponseFinish` for usage,
 * `handle.abort()` for a durable stop, `sqlite()` for Flue's own conversation records.
 *
 * - Structured agents (output: tool) must call their output tool; the definition's `validate`
 *   runs inside the tool, and a refusal goes back to the model in the same turn (repairs, then give up).
 * - Markdown agents answer in text; an invalid answer gets a follow-up message on the same instance.
 */
import { start, sqlite, type Flue } from "@flue/runtime/node";
import { init, useModel, useTool, defineTool, useInitialData, useResponseFinish, AgentRunError, type PromptUsage } from "@flue/runtime";
import type { Provider } from "@earendil-works/pi-ai";
import * as v from "valibot";
import { OutputError, type AgentDefinition, type Effort } from "../index.ts";

/** A helper tool as the loop offers it to the model: the runtime wraps admission and receipts around `run`. */
export type OfferedTool = Readonly<{ name: string; description: string; input: Record<string, unknown>; run: (input: Record<string, unknown>) => Promise<string> }>;

export type ModelUsage = Readonly<{ input: number; output: number; cached: number; model: string }>;

export type RunAgentOptions = Readonly<{
  runId: string;
  message: string;
  history?: readonly { role: "user" | "assistant"; content: string }[];
  tools?: readonly OfferedTool[];
  validate?: (output: unknown) => unknown;
  model: string;
  effort?: Effort;
  repairs?: number;
  /** Called after every model response with its usage, before the loop continues (AGENT-10). A throw stops the run. */
  onUsage: (usage: ModelUsage) => Promise<void>;
  /** True once a stop was requested: no further effect, the turn ends (AGENT-6). */
  cancelled: () => boolean;
}>;

export type RunAgentResult = Readonly<{ output: unknown; model: string; attempts: number; trace: readonly { tool: string; input: Record<string, unknown> }[] }>;

type ActiveRun = {
  definition: AgentDefinition;
  tools: readonly OfferedTool[];
  validate: (output: unknown) => unknown;
  repairs: number;
  attempts: number;
  output: unknown;
  error: OutputError | null;
  trace: { tool: string; input: Record<string, unknown> }[];
  cancelled: () => boolean;
};

const runs = new Map<string, ActiveRun>();
let flue: Flue | null = null;

function toValibot(schema: Record<string, unknown>): v.GenericSchema {
  if (Array.isArray(schema.enum)) return v.picklist(schema.enum as string[]);
  if (schema.type === "string") return v.string();
  if (schema.type === "integer" || schema.type === "number") return v.number();
  if (schema.type === "boolean") return v.boolean();
  if (schema.type === "array") return v.array(toValibot((schema.items as Record<string, unknown>) ?? {}));
  if (schema.type === "object") {
    const required = new Set((schema.required as string[]) ?? []);
    const properties = (schema.properties as Record<string, Record<string, unknown>>) ?? {};
    return v.object(Object.fromEntries(Object.entries(properties).map(([key, sub]) => [key, required.has(key) ? toValibot(sub) : v.optional(toValibot(sub))])));
  }
  return v.any();
}

function BoringAgent() {
  "use agent";
  const { runId, model, effort } = useInitialData<{ runId?: string; model?: string; effort?: Effort }>() ?? {};
  const run = runId ? runs.get(runId) : undefined;
  useModel(model ?? "fake/none", effort ? { thinkingLevel: effort } : undefined);
  useResponseFinish(ctx => ({ usage: ctx.response.usage }));
  // A run whose process died has no registry entry: it can only stop (AGENT-1).
  if (!run) return "This task was interrupted. Reply only with the word: interrupted.";
  for (const helper of run.tools) {
    useTool(defineTool({
      name: helper.name,
      description: helper.description,
      input: toValibot(helper.input) as never,
      run: async ({ data }: { data: Record<string, unknown> }) => {
        if (run.cancelled()) return { output: "Refused: this run was stopped.", terminate: true };
        run.trace.push({ tool: helper.name, input: data ?? {} });
        return await helper.run(data ?? {});
      },
    }));
  }
  const tool = run.definition.tool;
  if (tool) {
    useTool(defineTool({
      name: tool.name,
      description: tool.description,
      input: toValibot(tool.input) as never,
      run: async ({ data }: { data: Record<string, unknown> }) => {
        if (run.cancelled()) return { output: "Refused: this run was stopped.", terminate: true };
        run.attempts++;
        const known = Object.keys((tool.input.properties as Record<string, unknown>) ?? {});
        const args = Object.fromEntries(Object.entries(data ?? {}).filter(([key]) => known.includes(key)));
        try {
          run.output = run.validate(args);
          run.error = null;
          return { output: "Recorded.", terminate: true };
        } catch (error) {
          if (!(error instanceof OutputError)) throw error;
          run.error = error;
          if (run.attempts > run.repairs) return { output: `Refused: ${error.message}`, terminate: true };
          return { output: `Refused: ${error.message}. Call the tool again with the complete corrected output.` };
        }
      },
    }));
  }
  return run.definition.system;
}

/** Starts the Flue runtime once per process. `dbFile`: a SQLite file, or omitted for memory (tests). */
export async function startFlue({ dbFile, providers }: { dbFile?: string; providers: readonly Provider[] }): Promise<Flue> {
  if (flue) return flue;
  flue = await start({ agents: [{ agent: BoringAgent, name: "boring" }], providers, ...(dbFile ? { db: sqlite(dbFile) } : {}) });
  return flue;
}

export async function stopFlue() { if (flue) { const current = flue; flue = null; await current.stop(); } }

const usageOf = (metadata: Record<string, unknown> | undefined, model: string): ModelUsage => {
  const u = (metadata?.usage as Partial<PromptUsage> | undefined) ?? {};
  return { input: u.input ?? 0, output: u.output ?? 0, cached: (u.cacheRead ?? 0) + (u.cacheWrite ?? 0), model };
};

export class CancelledError extends Error {}

/** Runs one agent once on Flue: one message in, one validated output out, repairs in between. */
export async function runAgent(definition: AgentDefinition, options: RunAgentOptions): Promise<RunAgentResult> {
  if (!flue) throw new Error("the Flue runtime is not started");
  const { runId, model, repairs = 2 } = options;
  const run: ActiveRun = { definition, tools: options.tools ?? [], validate: options.validate ?? (x => x), repairs, attempts: 0, output: undefined, error: null, trace: [], cancelled: options.cancelled };
  runs.set(runId, run);
  const history = options.history ?? [];
  const text = history.length
    ? `# Earlier turns\n\n${history.map(m => `**${m.role === "user" ? "Person" : "Agent"}**: ${m.content}`).join("\n\n")}\n\n---\n\n${options.message}`
    : options.message;
  const handle = init(BoringAgent, { id: `${definition.name}-${runId}` });
  const send = async (message: string, initialData?: Record<string, unknown>) => {
    if (options.cancelled()) throw new CancelledError("stopped before the next model call");
    const reply = await handle.read(await handle.dispatch({ message, ...(initialData ? { initialData } : {}) }));
    await options.onUsage(usageOf(reply.metadata, model));
    return reply;
  };
  try {
    let reply = await send(text, { runId, model, effort: options.effort });
    if (definition.output === "tool") {
      const tool = definition.tool!;
      // The model answered in text instead of calling its tool: ask once more per repair.
      for (let i = 0; i < repairs && run.output === undefined && run.attempts <= repairs; i++) {
        reply = await send(run.error ? `Refused: ${run.error.message}` : `Call the tool ${tool.name} with the complete output.`);
      }
      if (run.output === undefined) throw new OutputError(run.error?.message ?? `Call the tool ${tool.name} with the complete output.`);
      return { output: run.output, model, attempts: Math.max(1, run.attempts), trace: run.trace };
    }
    let lastError: OutputError | null = null;
    for (let attempt = 0; attempt <= repairs; attempt++) {
      try {
        if (!reply.text?.trim()) throw new OutputError("Empty answer: reply with the document in markdown.");
        return { output: run.validate(reply.text.trim()), model, attempts: attempt + 1, trace: run.trace };
      } catch (error) {
        if (!(error instanceof OutputError)) throw error;
        lastError = error;
        if (attempt === repairs) break;
        reply = await send(`Refused: ${error.message}`);
      }
    }
    throw lastError;
  } catch (error) {
    if (error instanceof AgentRunError && error.outcome === "aborted") throw new CancelledError("aborted");
    if (error instanceof CancelledError) throw error;
    if (error instanceof OutputError) throw new OutputError(`the agent did not produce a valid output: ${error.message}`);
    throw error;
  } finally {
    runs.delete(runId);
  }
}

/** A durable abort of the instance behind a run; a live read observes the aborted settlement. */
export async function abortRun(definition: AgentDefinition, runId: string): Promise<void> {
  if (!runs.has(runId)) return;
  await init(BoringAgent, { id: `${definition.name}-${runId}` }).abort();
}
