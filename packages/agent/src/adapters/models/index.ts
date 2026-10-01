/**
 * The library's model adapters, one per ModelAccess kind: the only table the runtime reads
 * (BORING-7). Adding a provider is adding a folder here and a line to this map, and a ModelAccess
 * variant; the runtime does not change. Each adapter passes test/agent/model-adapters.test.ts.
 */
import type { ModelAccess } from "../../index.ts";
import type { ModelAdapter } from "../../runtime/model-port.ts";
import { fake } from "./fake/index.ts";
import { openrouter } from "./openrouter/index.ts";
import { openaiCodex } from "./openai-codex/index.ts";

export const MODEL_ADAPTERS: { readonly [K in ModelAccess["kind"]]: ModelAdapter<K> } = {
  fake,
  openrouter,
  "openai-codex": openaiCodex,
};

export { openrouterProvider } from "./openrouter/index.ts";
export { codexProvider } from "./openai-codex/index.ts";
