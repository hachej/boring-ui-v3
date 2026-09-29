import type { Runtime, ModelAccess, Usage } from "@boring/agent";
import type { FileProvider, Receipt } from "@boring/files";
export type Started = {
  url: string;
  runtime: Runtime;
  wire: { fetch: (request: Request) => Promise<Response> };
  receipts: { readonly entries: readonly Receipt[] };
  records: { list(): { id: string; title: string; status: string; version: number }[]; get(id: string): { id: string; title: string; status: string; version: number } | null; setStatus(id: string, status: string, expectedVersion: number, by: string): { outcome: string; detail?: unknown; evidence?: { id: string; version: number; by: string } } };
  workspaceOf(actor: { id: string }): FileProvider;
  stop(): Promise<void>;
};
export declare const scriptedModel: ModelAccess;
export declare function startServer(options?: { port?: number; model?: ModelAccess; store?: string; log?: (usage: Usage) => void }): Promise<Started>;
