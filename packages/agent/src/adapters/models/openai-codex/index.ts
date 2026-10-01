/**
 * The ChatGPT subscription through pi-ai's openai-codex OAuth pair: the credentials file the host
 * names (mode 0600) is refreshed by pi-ai and persisted here, so a restart keeps the rotated token.
 * The token is read at each request and never leaves this adapter (AGENT-7).
 */
import { createProvider, createModels, type Provider } from "@earendil-works/pi-ai";
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { ModelAdapter } from "../../../runtime/model-port.ts";

export const OPENAI_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

/** One JSON file (mode 0600) that pi-ai refreshes and this store persists. */
class FileCredentialStore {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly file: string;
  constructor(file: string) { this.file = file; }
  private load(): Record<string, unknown> { return existsSync(this.file) ? JSON.parse(readFileSync(this.file, "utf8")) : {}; }
  private save(all: Record<string, unknown>) {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    writeFileSync(tmp, JSON.stringify(all, null, 1), { mode: 0o600 });
    renameSync(tmp, this.file);
    chmodSync(this.file, 0o600);
  }
  async read(providerId: string) { return this.load()[providerId]; }
  async list() { return Object.entries(this.load()).map(([providerId, c]) => ({ providerId, type: (c as { type?: string })?.type })); }
  modify(providerId: string, fn: (current: unknown) => Promise<unknown>) {
    const run = this.chain.then(async () => {
      const all = this.load();
      const next = await fn(all[providerId]);
      if (next === undefined) delete all[providerId]; else all[providerId] = next;
      this.save(all);
      return next;
    });
    this.chain = run.catch(() => {});
    return run;
  }
  async delete(providerId: string) { return this.modify(providerId, async () => undefined); }
}

/** The openai-codex provider over one credentials file; `baseUrl`, when given, replaces every model's endpoint. */
export function codexProvider({ credentialsFile, baseUrl }: { credentialsFile: string; baseUrl?: string }): Provider {
  if (typeof credentialsFile !== "string" || !credentialsFile) throw new Error("openai-codex: a credentials file is required");
  const models = createModels({ credentials: new FileCredentialStore(credentialsFile) as never });
  models.setProvider(openaiCodexProvider());
  return createProvider({
    id: "openai-codex",
    baseUrl: baseUrl ?? OPENAI_CODEX_BASE_URL,
    auth: { apiKey: { name: "ChatGPT subscription (Codex OAuth)", resolve: async () => {
      const result = await models.getAuth("openai-codex");
      const key = (result as { auth?: { apiKey?: string } } | undefined)?.auth?.apiKey;
      if (!key) throw new Error("Codex login unavailable: check the credentials file");
      return { auth: { apiKey: key } };
    } } },
    models: baseUrl ? Object.values(OPENAI_CODEX_MODELS).map(model => ({ ...model, baseUrl })) : Object.values(OPENAI_CODEX_MODELS),
    api: openAICodexResponsesApi(),
  } as never);
}

export const openaiCodex: ModelAdapter<"openai-codex"> = {
  kind: "openai-codex",
  providers(access) {
    return { providers: [codexProvider({ credentialsFile: access.credentialsFile, baseUrl: access.baseUrl })], modelFor: (_agent, declared) => declared };
  },
};
