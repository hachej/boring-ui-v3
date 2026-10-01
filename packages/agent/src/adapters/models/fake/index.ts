/**
 * The fake model adapter: answers from the host's script, for tests and scripted runs; every agent
 * runs on `fake/<agent>`. No network, no credential.
 */
import { fauxProvider, fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { FakeReply, FakeRequest } from "../../../index.ts";
import type { ModelAdapter } from "../../../runtime/model-port.ts";

export const FAKE_PROVIDER = "fake";

type FauxContext = { messages: readonly { role: string; content: unknown; toolsAdded?: readonly { name: string }[] }[]; systemPrompt?: string };

export const fake: ModelAdapter<"fake"> = {
  kind: "fake",
  providers(access, { agentModels, outputTools }) {
    const faux = fauxProvider({ provider: FAKE_PROVIDER, models: [...new Set([...agentModels, "none"])].map(id => ({ id })), tokensPerSecond: 1_000_000 });
    // Flue sends tools inside the system message (`toolsAdded`), next to its own inert `task` tool.
    const step = async (context: FauxContext, _options: unknown, _state: unknown, model: { id: string }) => {
      faux.appendResponses([step as never]);
      const messages = context.messages.map(m => ({
        role: (m.role === "toolResult" ? "tool" : m.role) as FakeRequest["messages"][number]["role"],
        content: typeof m.content === "string" ? m.content : ((m.content as { type: string; text?: string }[]) ?? []).filter(c => c.type === "text").map(c => c.text ?? "").join(""),
      }));
      const tools = context.messages.flatMap(m => m.toolsAdded ?? []).filter(t => t.name !== "task");
      const outputTool = tools.find(t => outputTools.includes(t.name))?.name ?? null;
      const reply: FakeReply = await access.script({ model: `${FAKE_PROVIDER}/${model.id}`, system: context.systemPrompt ?? "", messages, tools, outputTool });
      const calls = reply.toolCalls ?? [];
      return fauxAssistantMessage(calls.length ? calls.map((c, i) => fauxToolCall(c.name, c.arguments as never, { id: c.id ?? `call-${Date.now()}-${i}` })) : [fauxText(reply.text ?? "")], { stopReason: calls.length ? "toolUse" : "stop" });
    };
    // Several runs share the provider: keep the queue well ahead of concurrent calls.
    faux.setResponses(Array.from({ length: 64 }, () => step as never));
    return { providers: [faux.provider], modelFor: agent => `${FAKE_PROVIDER}/${agent}` };
  },
};
