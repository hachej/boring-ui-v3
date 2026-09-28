import type { Database } from "../../environments/database.js";
import type { Filesystem } from "../../environments/filesystem.js";
import { filesystemAgentTools } from "./filesystem.js";
import { manifestTools, type ToolHandler, type ToolManifest } from "./manifest.js";

/** A tool carries its own model-facing metadata; a runtime hands the model exactly these, never a parallel table. */
export type AgentTool = Readonly<{ description: string; input: Readonly<Record<string, unknown>>; run(input: unknown): Promise<unknown> }>;
export type AgentToolName = keyof ReturnType<typeof filesystemAgentTools> | (string & {});

/**
 * Every tool a runtime may hand a model: the platform's file tools plus the app's declared tools, each closed
 * over admitted operations. An app tool shadows nothing: a manifest may not redeclare a platform tool name.
 */
export function agentTools(resources: { files: Filesystem; db: Database }, app?: { manifest: ToolManifest; handler: ToolHandler }): Readonly<Record<string, AgentTool>> {
  const platform = filesystemAgentTools(resources.files);
  const declared = app ? manifestTools(app.manifest, app.handler, resources) : {};
  for (const name of Object.keys(declared)) if (Object.hasOwn(platform, name)) throw new Error(`tool ${name} is a platform tool`);
  return Object.freeze({ ...platform, ...declared });
}
