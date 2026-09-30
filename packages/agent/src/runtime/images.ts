/**
 * Reading images (AGENT-15): the application hands the runtime images (bytes and a media type), an
 * instruction and a model, and gets back one text per image. It is a run like any other: admitted by
 * the host, recorded on a thread before any model call, ended once, and every model call metered and
 * attributed (AGENT-10). The bytes go to the model through the host's model access and are never
 * stored; the run records their media type, size and hash. Which provider reads is the host's
 * `ModelAccess`; a model that does not accept images is refused before any call, never sent a placeholder.
 */
import { createHash } from "node:crypto";
import type { Api, Model, Models } from "@earendil-works/pi-ai";
import type { Actor, Effort, Usage } from "../index.ts";
import type { Phrases } from "../phrases.ts";
import type { RunRecord, Store } from "./store.ts";

/** The agent name a reading run is recorded under; no definition may take it. */
export const READ_IMAGES = "read-images";

/** Media types every image-reading provider accepts. */
export const IMAGE_TYPES: readonly string[] = ["image/png", "image/jpeg", "image/webp", "image/gif"];

export type ImageInput = Readonly<{ data: Uint8Array; mimeType: string }>;

export type ReadImagesRequest = Readonly<{
  images: readonly ImageInput[];
  /** What to do with each image, in the application's language; the model's system prompt. */
  instruction: string;
  /** provider/model, e.g. "openai-codex/gpt-5.5"; with the fake access every name routes to `fake/read-images`. */
  model: string;
  effort?: Effort;
  /** The thread to record the run on (the actor's own); a new one when omitted. */
  thread?: string;
  /** Aborts the calls still in flight (a timeout, a request that went away); the run ends cancelled. */
  signal?: AbortSignal;
}>;

/** One image's result, in the order given: its text, or why there is none. */
export type ImageReading = Readonly<{ text: string } | { error: string }>;

export type ReadImagesResult = Readonly<{ run: RunRecord; readings: readonly ImageReading[] }>;

export class ReadImagesRefused extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

/** Refuses a malformed request or a model without image input before anything is recorded. */
export function resolveReading(models: Models, name: string, request: ReadImagesRequest): Model<Api> {
  if (!Array.isArray(request.images) || !request.images.length) throw new ReadImagesRefused(400, "images: at least one image is required");
  for (const [i, image] of request.images.entries()) {
    if (!(image?.data instanceof Uint8Array) || !image.data.byteLength) throw new ReadImagesRefused(400, `images[${i}]: data must be non-empty bytes`);
    if (!IMAGE_TYPES.includes(image.mimeType)) throw new ReadImagesRefused(400, `images[${i}]: media type "${image.mimeType}" is not one of ${IMAGE_TYPES.join(", ")}`);
  }
  if (typeof request.instruction !== "string" || !request.instruction.trim()) throw new ReadImagesRefused(400, "instruction is required");
  const slash = name.indexOf("/");
  const model = slash > 0 ? models.getModel(name.slice(0, slash), name.slice(slash + 1)) : undefined;
  if (!model) throw new ReadImagesRefused(400, `unknown model "${name}"`);
  if (!model.input.includes("image")) throw new ReadImagesRefused(400, `model "${name}" does not accept images`);
  return model;
}

/** What the run records of its images: never the bytes. */
export const describeImages = (images: readonly ImageInput[]) => images.map(image => ({ mimeType: image.mimeType, bytes: image.data.byteLength, sha256: createHash("sha256").update(image.data).digest("hex") }));

export type ReadDeps = Readonly<{
  store: Store;
  models: Models;
  phrases: Phrases;
  /** Hands a usage row to the host before the run continues; a throw stops the reading (AGENT-10). */
  onUsage: (usage: Usage) => Promise<void>;
  /** The runtime's concurrency slots, shared with agent runs. */
  slot: () => Promise<void>;
  release: () => void;
}>;

/**
 * Reads each image with one model call, concurrently within the runtime's slots, and ends the run once:
 * completed when at least one image was read, cancelled on a stop, failed otherwise.
 */
export async function readAll(deps: ReadDeps, actor: Actor, run: RunRecord, model: Model<Api>, name: string, request: ReadImagesRequest, abort: AbortController): Promise<ReadImagesResult> {
  const { store, phrases } = deps;
  const stopped = () => abort.signal.aborted || !!store.run(run.id)?.cancelRequested;
  let refusal: Error | null = null;
  store.startRun(run.id);
  const readOne = async (image: ImageInput): Promise<ImageReading> => {
    await deps.slot();
    try {
      if (stopped() || refusal) return { error: phrases.stopped };
      const reply = await deps.models.completeSimple(model, {
        systemPrompt: request.instruction,
        messages: [{ role: "user", content: [{ type: "image", data: Buffer.from(image.data).toString("base64"), mimeType: image.mimeType }], timestamp: Date.now() }],
      }, { signal: abort.signal, ...(request.effort ? { reasoning: request.effort } : {}) } as never);
      const u = reply.usage;
      const row: Usage = { actor: actor.id, thread: run.thread, run: run.id, agent: READ_IMAGES, model: name, input: u?.input ?? 0, output: u?.output ?? 0, cached: (u?.cacheRead ?? 0) + (u?.cacheWrite ?? 0), cost: u?.cost?.total ?? 0, at: new Date().toISOString() };
      store.addUsage(row);
      try { await deps.onUsage(row); } catch (error) { refusal = error as Error; abort.abort(); }
      if (reply.stopReason === "aborted") return { error: phrases.stopped };
      if (reply.stopReason === "error" || reply.errorMessage) return { error: reply.errorMessage ?? "error" };
      return { text: reply.content.filter(part => part.type === "text").map(part => (part as { text: string }).text).join("").trim() };
    } catch (error) {
      return { error: stopped() ? phrases.stopped : (error as Error).message };
    } finally { deps.release(); }
  };
  const readings = await Promise.all(request.images.map(readOne));
  if (refusal) store.finishRun(run.id, { status: "failed", error: phrases.runFailed((refusal as Error).message), failure: "error", attempts: 1 });
  else if (stopped()) store.finishRun(run.id, { status: "cancelled", attempts: 1 });
  else if (readings.some(r => "text" in r)) store.finishRun(run.id, { status: "completed", output: readings, attempts: 1 });
  else store.finishRun(run.id, { status: "failed", error: phrases.runFailed((readings[0] as { error: string }).error), failure: "error", attempts: 1 });
  return { run: store.run(run.id)!, readings };
}
