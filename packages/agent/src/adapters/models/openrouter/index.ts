/**
 * The OpenRouter model adapter: the OpenAI chat-completions API at OpenRouter (or at `baseUrl`, an
 * OpenAI-compatible gateway), with the API key the host passes. The key lives only in the closure
 * that answers pi-ai's auth request (AGENT-7).
 */
import { createProvider, type Provider } from "@earendil-works/pi-ai";
import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import type { ModelAdapter } from "../../../runtime/model-port.ts";

export const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";

/** The OpenRouter provider for one API key. */
/** `baseUrl`, when given, replaces every model's endpoint (an OpenAI-compatible gateway, or a test double). */
export function openrouterProvider({ apiKey, baseUrl }: { apiKey: string; baseUrl?: string }): Provider {
  if (typeof apiKey !== "string" || !apiKey) throw new Error("openrouter: an API key is required");
  return createProvider({
    id: "openrouter",
    name: "OpenRouter",
    baseUrl: baseUrl ?? OPENROUTER_BASE_URL,
    auth: { apiKey: { name: "OpenRouter API key", resolve: async () => ({ auth: { apiKey } }) } },
    models: baseUrl ? Object.values(OPENROUTER_MODELS).map(model => ({ ...model, baseUrl })) : Object.values(OPENROUTER_MODELS),
    api: openAICompletionsApi(),
  } as never);
}

export const openrouter: ModelAdapter<"openrouter"> = {
  kind: "openrouter",
  providers(access) {
    return { providers: [openrouterProvider({ apiKey: access.apiKey, baseUrl: access.baseUrl })], modelFor: (_agent, declared) => declared };
  },
};
