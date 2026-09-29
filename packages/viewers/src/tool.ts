/**
 * A viewer tool: one schema and one handler, shared by the person's control and the agent (VIEWERS-1). The
 * person's button calls `call(tool, input)`; the agent reaches the same function through the page-command
 * bridge. Every result says what happened (UI-BOUNDARY-5, VIEWERS-3): `applied` is local interaction only,
 * `proposed` waits for the person, `committed` carries the provider's receipt, the rest are refusals.
 */
import type { UiResult } from "@boring/chat";
import { validateInput } from "@boring/chat/bridge";
import { formatAddress, isFileError, type FileAddress, type Receipt } from "@boring/files/web";

/** What a tool may do. `write` tools are not offered, and their operations refuse, on a read-only viewer (VIEWERS-2). */
export type ToolEffect = "local" | "read" | "proposal" | "write";

export type ViewerTool<Input = Record<string, unknown>> = Readonly<{
  name: string;
  description: string;
  /** JSON schema of the input, checked before `run` for the person and for the agent alike. */
  input: Readonly<Record<string, unknown>>;
  effect: ToolEffect;
  run: (input: Input) => Promise<UiResult> | UiResult;
}>;

export const defineTool = <Input = Record<string, unknown>>(tool: ViewerTool<Input>): ViewerTool => tool as unknown as ViewerTool;

/** Runs a tool the one way: schema first, then the handler; a thrown error is `unavailable`, never a success. */
export async function call(tool: ViewerTool, input: unknown = {}): Promise<UiResult> {
  const errors = validateInput(tool.input, input);
  if (errors.length) return { outcome: "denied", detail: errors };
  try { return await tool.run(input as Record<string, unknown>); }
  catch (error) { return fromError(error); }
}

export const applied = (detail?: unknown): UiResult => (detail === undefined ? { outcome: "applied" } : { outcome: "applied", detail });
export const proposed = (detail: unknown): UiResult => ({ outcome: "proposed", detail });
export const denied = (detail: unknown): UiResult => ({ outcome: "denied", detail });
export const stale = (detail: unknown): UiResult => ({ outcome: "stale", detail });
export const conflict = (detail: unknown): UiResult => ({ outcome: "conflict", detail });

/** The evidence a committed result carries: the provider's receipt, never one the page made up (VIEWERS-3). */
export type ReceiptEvidence = Readonly<{ receipt: { address: string; before: string | null; after: string | null; actor: string; at: string } }>;
export const receiptEvidence = (receipt: Receipt): ReceiptEvidence => ({ receipt: { address: formatAddress(receipt.address), before: receipt.before, after: receipt.after, actor: receipt.effect.actor, at: receipt.at } });
export const committed = (receipt: Receipt, detail?: unknown): UiResult => ({ outcome: "committed", ...(detail === undefined ? {} : { detail }), evidence: receiptEvidence(receipt) });

/** A provider's refusal as a tool result: the backend decided, the viewer only reports (UI-BOUNDARY-3). */
export function fromError(error: unknown): UiResult {
  if (!isFileError(error)) return { outcome: "unavailable", detail: (error as Error)?.message ?? String(error) };
  const e = error.error;
  switch (e.code) {
    case "conflict": return { outcome: "conflict", detail: { reason: "the file changed since it was read", current: e.current } };
    case "exists": return { outcome: "conflict", detail: { reason: "the file already exists" } };
    case "missing": return { outcome: "conflict", detail: { reason: "the file does not exist" } };
    case "unavailable": return { outcome: "stale", detail: { reason: "that revision is not available", requested: e.requested, current: e.current } };
    case "readonly": return { outcome: "denied", detail: { reason: "read-only" } };
    case "bad-address": return { outcome: "denied", detail: { reason: error.message } };
    case "unverified": return { outcome: "unavailable", detail: { reason: error.message } };
  }
}

/** `/workspace/notes/a.md` ↔ { mount, path }, for viewers whose mounts are the address's first segment(s). */
export function splitAddress(address: string): FileAddress {
  const parts = address.split("/").filter(Boolean);
  if (parts[0] === "mnt" && parts.length >= 2) return { mount: `mnt/${parts[1]}`, path: parts.slice(2).join("/") };
  return { mount: parts[0] ?? "", path: parts.slice(1).join("/") };
}
export const joinAddress = (address: FileAddress) => formatAddress(address);
