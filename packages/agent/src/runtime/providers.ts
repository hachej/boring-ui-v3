/**
 * Model providers behind one door. Credentials come from the host's ModelAccess at mount time and
 * never touch a definition, a record or the wire (AGENT-7). The fake provider answers from the
 * host's script for tests and scripted runs; models named `fake/<agent>` route to it.
 */
import { createProvider, fauxProvider, fauxAssistantMessage, fauxText, fauxToolCall, createModels, type Models, type Provider } from "@earendil-works/pi-ai";
import { OPENROUTER_MODELS } from "@earendil-works/pi-ai/providers/openrouter.models";
import { OPENAI_CODEX_MODELS } from "@earendil-works/pi-ai/providers/openai-codex.models";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { openAICodexResponsesApi } from "@earendil-works/pi-ai/api/openai-codex-responses.lazy";
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { FakeReply, FakeRequest, ModelAccess } from "../index.ts";

export const FAKE_PROVIDER = "fake";

/** One JSON file (mode 0600) that pi-ai refreshes and this store persists, so a restart keeps the rotated token. */
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

type FauxContext = { messages: readonly { role: string; content: unknown; toolsAdded?: readonly { name: string }[] }[]; systemPrompt?: string };
type FauxPart = { type: string; text?: string; data?: string; mimeType?: string };

/** One message as the fake script sees it: its text, and each image as its media type and size (never its bytes). */
function fakeMessage(m: FauxContext["messages"][number]): FakeRequest["messages"][number] {
  const role = (m.role === "toolResult" ? "tool" : m.role) as FakeRequest["messages"][number]["role"];
  if (typeof m.content === "string") return { role, content: m.content };
  const parts = (m.content as FauxPart[]) ?? [];
  const images = parts.filter(c => c.type === "image").map(c => ({ mimeType: c.mimeType ?? "", bytes: Buffer.byteLength(c.data ?? "", "base64") }));
  return { role, content: parts.filter(c => c.type === "text").map(c => c.text ?? "").join(""), ...(images.length ? { images } : {}) };
}

/** A model collection over the same providers, for calls the loop makes outside an agent run (reading images). */
function collectionOf(providers: readonly Provider[]): Models {
  const models = createModels();
  for (const provider of providers) models.setProvider(provider);
  return models;
}

/**
 * The providers to register with Flue for this access, the model name every agent's model maps to
 * (the fake provider takes all of them), and the same providers as a collection for direct calls.
 * Nothing here is stored.
 */
export function providersFor(access: ModelAccess, agentModels: readonly string[], outputTools: readonly string[]): { providers: Provider[]; models: Models; modelFor: (agent: string, declared: string) => string } {
  if (access.kind === "fake") {
    const faux = fauxProvider({ provider: FAKE_PROVIDER, models: [...new Set([...agentModels, "none"])].map(id => ({ id })), tokensPerSecond: 1_000_000 });
    // Flue sends tools inside the system message (`toolsAdded`), next to its own inert `task` tool.
    const step = async (context: FauxContext, _options: unknown, _state: unknown, model: { id: string }) => {
      faux.appendResponses([step as never]);
      const messages = context.messages.map(fakeMessage);
      const tools = context.messages.flatMap(m => m.toolsAdded ?? []).filter(t => t.name !== "task");
      const outputTool = tools.find(t => outputTools.includes(t.name))?.name ?? null;
      const reply: FakeReply = await access.script({ model: `${FAKE_PROVIDER}/${model.id}`, system: context.systemPrompt ?? messages.find(m => (m.role as string) === "system")?.content ?? "", messages, tools, outputTool });
      const calls = reply.toolCalls ?? [];
      return fauxAssistantMessage(calls.length ? calls.map((c, i) => fauxToolCall(c.name, c.arguments as never, { id: c.id ?? `call-${Date.now()}-${i}` })) : [fauxText(reply.text ?? "")], { stopReason: calls.length ? "toolUse" : "stop" });
    };
    // Several runs share the provider: keep the queue well ahead of concurrent calls.
    faux.setResponses(Array.from({ length: 64 }, () => step as never));
    return { providers: [faux.provider], models: collectionOf([faux.provider]), modelFor: agent => `${FAKE_PROVIDER}/${agent}` };
  }
  if (access.kind === "openrouter") {
    const apiKey = access.apiKey;
    const provider = createProvider({
      id: "openrouter",
      name: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      auth: { apiKey: { name: "OpenRouter API key", resolve: async () => ({ auth: { apiKey } }) } },
      models: Object.values(OPENROUTER_MODELS),
      api: openAICompletionsApi(),
    } as never);
    return { providers: [provider], models: collectionOf([provider]), modelFor: (_agent, declared) => declared };
  }
  const models = createModels({ credentials: new FileCredentialStore(access.credentialsFile) as never });
  models.setProvider(openaiCodexProvider());
  const provider = createProvider({
    id: "openai-codex",
    baseUrl: "https://chatgpt.com/backend-api",
    auth: { apiKey: { name: "ChatGPT subscription (Codex OAuth)", resolve: async () => {
      const result = await models.getAuth("openai-codex");
      const key = (result as { auth?: { apiKey?: string } } | undefined)?.auth?.apiKey;
      if (!key) throw new Error("Codex login unavailable: check the credentials file");
      return { auth: { apiKey: key } };
    } } },
    models: Object.values(OPENAI_CODEX_MODELS),
    api: openAICodexResponsesApi(),
  } as never);
  return { providers: [provider], models: collectionOf([provider]), modelFor: (_agent, declared) => declared };
}
