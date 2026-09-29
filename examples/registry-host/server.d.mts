import type { Runtime } from "@boring/agent";
import type { FileProvider, Receipt } from "@boring/files";
export type Started = {
  url: string;
  runtime: Runtime;
  wire: { fetch: (request: Request) => Promise<Response> };
  files: { fetch: (request: Request) => Promise<Response> };
  receipts: { readonly entries: readonly Receipt[] };
  workspaceOf(actor: { id: string }): FileProvider;
  spec: string;
  stop(): Promise<void>;
};
export declare function startServer(options?: { port?: number; hostname?: string; store?: string; spec?: string; log?: (usage: unknown) => void }): Promise<Started>;
