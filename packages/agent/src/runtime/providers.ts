/**
 * The runtime's side of the model port (AGENT-16, model-port.ts): the providers for the host's
 * ModelAccess, from the adapter its kind names. The runtime reaches adapters only through the
 * one table in ../adapters/models/index.ts; each adapter lives in its own folder under
 * adapters/models/ and is the only code that imports a provider SDK module (BORING-7). Nothing
 * here is stored.
 */
import type { ModelAccess } from "../index.ts";
import type { ModelAdapter, ModelProviders } from "./model-port.ts";
import { MODEL_ADAPTERS } from "../adapters/models/index.ts";

export function providersFor(access: ModelAccess, agentModels: readonly string[], outputTools: readonly string[]): ModelProviders {
  const adapter = MODEL_ADAPTERS[access.kind] as ModelAdapter | undefined;
  if (!adapter) throw new Error(`no model adapter for kind ${(access as { kind?: unknown }).kind}`);
  return adapter.providers(access as never, { agentModels, outputTools });
}
