// A viewer bound to the agent: its tools are page commands on the thread, answered by the same `call` the person's
// controls use (VIEWERS-1), bound to the document the viewer shows (VIEWERS-4), over the real runtime and wire.
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRuntime, loadApp, mountWire, FILE_TOOLS } from "@boring/agent";
import type { Event, UiRequestView } from "@boring/agent/wire";
import { createChatClient, type ChatClient } from "@boring/chat/client";
import { memoryProvider, memoryReceipts } from "@boring/files/web";
import { useMarkdownDocument, type ReceiptEvidence } from "@boring/viewers";
import { makeHost } from "../agent/helpers.ts";
import { renderHook } from "./dom.ts";

const hostDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../examples/registry-host");
const DOC = "# Plan\n\n## Risks\n\nNone yet.\n";

test("VIEWERS-1: the agent reads the open document and proposes a patch through the viewer's tools; the person accepts and the save carries the receipt", async t => {
  const receipts = memoryReceipts();
  const workspace = memoryProvider({ seed: { "plan.md": DOC }, receipts, name: "ws" });
  const app = await loadApp(hostDir);
  const allowed = [...FILE_TOOLS, ...app.agents.get("assistant")!.uiCommands];
  const host = makeHost({ async mounts() { return { workspace }; }, async allowedTools() { return allowed; } });
  const offered: string[][] = [];
  const runtime = await createRuntime({
    host, app, store: ":memory:", uiTimeout: 5000,
    model: { kind: "fake", script: request => {
      offered.push(request.tools.map(t => t.name));
      const results = request.messages.filter(m => m.role === "tool");
      if (results.length === 0) return { toolCalls: [{ name: "markdown_read_document", arguments: {} }] };
      if (results.length === 1) return { toolCalls: [{ name: "markdown_propose_patch", arguments: { summary: "name a risk", edits: [{ find: "None yet.", replace: "A stale save." }] } }] };
      return { text: "Proposed." };
    } },
  });
  t.after(() => runtime.stop());
  const wire = mountWire({ host, runtime, basePath: "/agent" });
  const client = createChatClient({ endpoint: "http://app.local/agent", fetch: (input, init) => wire.fetch(new Request(input, init)) });
  const thread = (await client.createThread()).id;

  const h = await renderHook(p => useMarkdownDocument(p), { files: workspace, address: "/workspace/plan.md", effect: { actor: "ana" }, agent: { client, thread } });
  for (let i = 0; i < 50 && (await client.uiRegistrations(thread)).length === 0; i++) await h.settle(10);
  const [registration] = await client.uiRegistrations(thread);
  assert.deepEqual(registration!.target, { kind: "markdown", id: "/workspace/plan.md" });
  assert.ok(registration!.commands.some(c => c.name === "markdown_propose_patch"));

  const { run } = await client.say("chat", "name a risk in my plan", { thread });
  await h.act(async () => { await runtime.idle(); });
  await h.settle(20);
  assert.equal((await client.run(run.id)).status, "completed");
  assert.ok(offered[0]!.includes("markdown_read_document") && offered[0]!.includes("markdown_apply_patch"), "the registered tools are offered");
  const outputs = runtime.store.eventsOf({ run: run.id }).flatMap(e => e.kind === "message" ? e.message.parts : []).filter(p => p.type === "tool") as { name: string; output: { outcome: string; detail: Record<string, unknown> } }[];
  assert.deepEqual(outputs.map(o => [o.name, o.output.outcome]), [["markdown_read_document", "applied"], ["markdown_propose_patch", "proposed"]]);
  assert.equal(outputs[0]!.output.detail.content, DOC);
  assert.equal(receipts.entries.length, 0, "the agent's proposal saved nothing");

  const [proposal] = h.result.current.state.proposals;
  assert.equal(proposal?.from, "agent");
  const accepted = await h.act(() => h.result.current.actions.accept(proposal!.id));
  assert.equal(accepted.outcome, "committed");
  assert.equal((accepted.evidence as ReceiptEvidence).receipt.after, receipts.entries[0]!.after);
  assert.equal((await workspace.read({ mount: "workspace", path: "plan.md" })).content, DOC.replace("None yet.", "A stale save."));
  await h.unmount();
  for (let i = 0; i < 50 && (await client.uiRegistrations(thread)).length; i++) await new Promise(r => setTimeout(r, 10));
  assert.deepEqual(await client.uiRegistrations(thread), [], "unmounting ends the binding");
});

test("VIEWERS-4: after the viewer moves to another document, a request made for the first is answered stale and does not run", async () => {
  const queue: Event[] = [];
  let wake: (() => void) | null = null;
  const registrations: { page: string; target?: unknown }[] = [];
  const answers: { request: string; outcome: string }[] = [];
  const client: ChatClient = {
    say: async () => { throw new Error("unused"); }, cancel: async () => { throw new Error("unused"); }, run: async () => { throw new Error("unused"); }, job: async () => { throw new Error("unused"); },
    createThread: async () => ({ id: "t", createdAt: "" }),
    async *follow(_scope, options) {
      while (!options?.signal?.aborted) { const next = queue.shift(); if (next) yield next; else await new Promise<void>(r => { wake = r; setTimeout(r, 20); }); }
    },
    async registerUi(_thread, page, registration) { registrations.push({ page, target: registration.target }); return { page, commands: registration.commands }; },
    async unregisterUi() {}, async uiRegistrations() { return []; },
    async answerUi(run, request, answer) { answers.push({ request, outcome: answer.result.outcome }); return { id: request, run, thread: "t", page: answer.page, command: "", input: null, state: "answered", result: answer.result, at: "" }; },
  };
  const files = memoryProvider({ seed: { "a.md": "# A\n", "b.md": "# B\n" } });
  const h = await renderHook(p => useMarkdownDocument(p), { files, address: "/workspace/a.md", agent: { client, thread: "t" } });
  await h.settle(30);
  const page = registrations[0]!.page;
  await h.rerender({ files, address: "/workspace/b.md", agent: { client, thread: "t" } });
  await h.settle(30);
  assert.deepEqual(registrations.map(r => r.target), [{ kind: "markdown", id: "/workspace/a.md" }, { kind: "markdown", id: "/workspace/b.md" }], "the viewer re-registered on its new document");
  const request: UiRequestView = { id: "q1", run: "r", thread: "t", page, command: "markdown_go_to_heading", input: { heading: "A" }, target: { kind: "markdown", id: "/workspace/a.md" }, state: "requested", at: "" };
  queue.push({ cursor: "1", kind: "ui", ui: request });
  (wake as (() => void) | null)?.();
  await h.settle(60);
  assert.deepEqual(answers, [{ request: "q1", outcome: "stale" }]);
  const navigation = () => h.result.current.state.navigation;
  assert.equal(navigation(), null, "the handler did not run");
  queue.push({ cursor: "2", kind: "ui", ui: { ...request, id: "q2", input: { heading: "B" }, target: { kind: "markdown", id: "/workspace/b.md" } } });
  await h.settle(60);
  assert.deepEqual(answers.at(-1), { request: "q2", outcome: "applied" });
  assert.equal(navigation()?.heading.text, "B");
  await h.unmount();
});

test("the viewers of one page share one live stream per thread (a browser has few connections per host)", async () => {
  let follows = 0, aborted = 0;
  const client: ChatClient = {
    say: async () => { throw new Error("unused"); }, cancel: async () => { throw new Error("unused"); }, run: async () => { throw new Error("unused"); }, job: async () => { throw new Error("unused"); },
    createThread: async () => ({ id: "t", createdAt: "" }),
    async *follow(_scope, options) { follows++; await new Promise<void>(r => options?.signal?.addEventListener("abort", () => { aborted++; r(); })); yield* []; },
    async registerUi(_t, page, registration) { return { page, commands: registration.commands }; },
    async unregisterUi() {}, async uiRegistrations() { return []; },
    async answerUi() { throw new Error("unused"); },
  };
  const files = memoryProvider({ seed: { "a.md": "# A", "b.md": "# B", "c.md": "# C" } });
  const views = await Promise.all(["a", "b", "c"].map(n => renderHook(p => useMarkdownDocument(p), { files, address: `/workspace/${n}.md`, namespace: n, agent: { client, thread: "t" } })));
  for (const v of views) await v.settle(20);
  assert.equal(follows, 1, "one stream for three viewers");
  for (const v of views) await v.unmount();
  assert.equal(aborted, 1, "closed when the last viewer leaves");
});
