/**
 * The model port (AGENT-16): what a model adapter is. An adapter turns the host's ModelAccess
 * into the pi-ai providers Flue registers, and says which model name each agent runs on.
 * Credentials come from the host's ModelAccess at mount time and never touch a definition, a
 * record or the wire (AGENT-7); usage is metered by the runtime on every response, whatever the
 * adapter (AGENT-10). Types only: adapters import this file and nothing else of the runtime.
 */
import type { Provider } from "@earendil-works/pi-ai";
import type { ModelAccess } from "../index.ts";

/** What the runtime tells an adapter about the application it serves. */
export type ModelContext = Readonly<{ agentModels: readonly string[]; outputTools: readonly string[] }>;

/** What an adapter returns: the providers to register, and the model each agent's declared model maps to. */
export type ModelProviders = { providers: Provider[]; modelFor: (agent: string, declared: string) => string };

/** One model adapter: exactly one ModelAccess kind. */
export interface ModelAdapter<K extends ModelAccess["kind"] = ModelAccess["kind"]> {
  readonly kind: K;
  providers(access: Extract<ModelAccess, { kind: K }>, context: ModelContext): ModelProviders;
}
