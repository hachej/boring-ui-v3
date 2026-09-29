/**
 * The manifest at /.well-known/boring.json: what an application's agents, jobs and conversations
 * are, so that another system can discover and invoke them over the wire. It carries definitions
 * and schemas only; never a credential, a prompt or a record (AGENT-7).
 */
import type { AppRegistry } from "../index.ts";

export type Manifest = Readonly<{
  protocol: 1;
  name: string;
  version: string;
  description?: string;
  agents: readonly Readonly<{
    name: string; title: string; description?: string; model: string; effort?: string; output: "tool" | "markdown";
    inputs: Readonly<Record<string, string>>; outputs: Readonly<Record<string, string>> | Readonly<{ schema: Record<string, unknown> }>; tools: readonly string[];
    invoke: string;
  }>[];
  jobs: readonly Readonly<{ name: string; title: string; description: string; children: readonly string[]; inputs: Readonly<Record<string, string>>; outputs: Readonly<Record<string, string>>; invoke: string }>[];
  conversations: readonly Readonly<{ name: string; title: string; description: string; agent: string; inputs: Readonly<Record<string, string>>; invoke: string }>[];
  endpoints: Readonly<Record<string, string>>;
}>;

export function manifestOf(app: AppRegistry): Manifest {
  return {
    protocol: 1,
    name: app.name,
    version: app.version,
    ...(app.description ? { description: app.description } : {}),
    agents: [...app.agents.values()].map(a => ({
      name: a.name, title: a.title, ...(a.description ? { description: a.description } : {}), model: a.model, ...(a.effort ? { effort: a.effort } : {}), output: a.output,
      inputs: a.inputs, outputs: a.tool ? { schema: a.tool.input } : Object.keys(a.outputs).length ? a.outputs : { markdown: "the agent's answer as markdown" },
      tools: a.helperTools, invoke: `POST /agents/${a.name}/runs`,
    })),
    jobs: [...app.jobs.values()].map(j => ({ name: j.name, title: j.title, description: j.description, children: j.children, inputs: j.inputs, outputs: j.outputs, invoke: `POST /jobs/${j.name}/start` })),
    conversations: [...app.conversations.values()].map(c => ({ name: c.name, title: c.title, description: c.description, agent: c.agent, inputs: c.inputs, invoke: `POST /conversations/${c.name}/messages` })),
    endpoints: {
      manifest: "GET /.well-known/boring.json",
      startRun: "POST /agents/:agent/runs",
      run: "GET /runs/:id",
      runEvents: "GET /runs/:id/events?cursor=",
      cancel: "POST /runs/:id/cancel",
      startJob: "POST /jobs/:job/start",
      job: "GET /jobs/:id",
      say: "POST /conversations/:conversation/messages",
      thread: "GET /threads/:id",
      threadEvents: "GET /threads/:id/events?cursor=",
    },
  };
}
