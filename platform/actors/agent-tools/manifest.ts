import type { Database } from "../../environments/database.js";
import type { Filesystem } from "../../environments/filesystem.js";
import { assertSchema, validate, type Schema } from "../../resources/schema.js";
import type { AgentTool } from "./index.js";

/**
 * An app's tools are data (`tools.json`): a name, a description, an input schema and whether the tool mutates.
 * The app's own handler implements them against the app's database; the platform validates the input, admits
 * the operation on the database (write for a mutating tool, read otherwise) and receipts the effect.
 */
export type ToolDeclaration = Readonly<{ name: string; description: string; input: Schema; mutates?: boolean }>;
export type ToolManifest = Readonly<{ tools: readonly ToolDeclaration[] }>;
/** The app's handler, as the host loads it from the app's files. It receives admitted operations only. */
export type ToolHandler = (tool: string, input: unknown, resources: { db: Database; files: Filesystem }) => Promise<unknown>;

const NAME = /^[a-z][a-z0-9_]{0,63}$/;
export function assertManifest(manifest: unknown): asserts manifest is ToolManifest {
  const m = manifest as ToolManifest;
  if (!m || !Array.isArray(m.tools)) throw new Error("tools.json needs a tools array");
  const seen = new Set<string>();
  for (const tool of m.tools) {
    if (!tool || !NAME.test(tool.name) || typeof tool.description !== "string" || !tool.description) throw new Error("each tool needs a name and a description");
    if (tool.mutates !== undefined && typeof tool.mutates !== "boolean") throw new Error(`${tool.name}: mutates must be a boolean`);
    assertSchema(tool.input, `${tool.name}.input`);
    if (seen.has(tool.name)) throw new Error(`duplicate tool ${tool.name}`);
    seen.add(tool.name);
  }
}

export function manifestTools(manifest: ToolManifest, handler: ToolHandler, resources: { db: Database; files: Filesystem }): Readonly<Record<string, AgentTool>> {
  assertManifest(manifest);
  const tools: Record<string, AgentTool> = {};
  for (const tool of manifest.tools) {
    tools[tool.name] = Object.freeze({
      description: tool.description, input: tool.input,
      async run(input: unknown) {
        validate(tool.input, input, tool.name);
        // Admission first: a handler that receives a mutating call holds a write-admitted database, never more.
        resources.db.assertAllowed(tool.mutates ? "write" : "read");
        return handler(tool.name, input, resources);
      }
    });
  }
  return Object.freeze(tools);
}
