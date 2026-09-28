import type { ActorRef, ResourceRef } from "../identity.js";
import type { Grant } from "../environments/admission.js";
import type { Database } from "../environments/database.js";
import type { Filesystem } from "../environments/filesystem.js";
import type { Job } from "../jobs/job.js";
import type { AgentTool, AgentToolName } from "./agent-tools/index.js";
import type { ToolHandler, ToolManifest } from "./agent-tools/manifest.js";

export type AgentDefinition = Readonly<{
  actor: ActorRef & { kind: "agent" };
  definition: ResourceRef & { kind: "agent-definition" };
  instructions: ResourceRef;
  /** Selection only. Credentials belong to the host's model service (ACTOR-4); `options` are provider-specific knobs. */
  model?: { provider: string; model: string; options?: Readonly<Record<string, string | number | boolean>> };
  /** Tool names come from the platform's file tools or the app's manifest; grants bound what those tools may touch. */
  needs: { tools: readonly AgentToolName[]; grants: readonly Grant[] };
}>;
/** Admitted operations the host hands a runtime for one execution; `read` resolves a Job input through them. */
export type AdmittedResources = Readonly<{
  files: Filesystem; db: Database;
  read(ref: ResourceRef): Promise<{ ref: ResourceRef; content: unknown }>;
}>;
/** The app whose tools an execution may call: its declared tools (data) and the handler loaded from its files. */
export type AppTools = Readonly<{ manifest: ToolManifest; handler: ToolHandler }>;
/** One execution: the Job, the Agent, its instructions as resolved by the host, the app's tools, and the Environment reachable only through `resources`. */
export type AgentExecution = Readonly<{ job: Job; agent: AgentDefinition; instructions: string; app?: AppTools; resources: AdmittedResources }>;
export interface AgentRuntime { run(execution: AgentExecution): Promise<unknown> }
/** What a runtime hands its trusted host executor: the execution and exactly the declared tools. */
export type AgentExecutor = (input: { execution: AgentExecution; tools: Readonly<Record<string, AgentTool>> }) => Promise<unknown>;
