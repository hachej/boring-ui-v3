import type { ActorRef, ResourceRef } from "../identity.js";
import { assertResourceRef } from "../resources/resource.js";

export type JobStatus = "pending" | "running" | "completed" | "failed" | "cancelled";
export type JobDefinitionRef = ResourceRef & { kind: "job-definition" };
export type Job = Readonly<{
  id: string; kind: string; definition: JobDefinitionRef; parentId?: string; status: JobStatus; actor: ActorRef;
  inputs: readonly ResourceRef[]; outputs: readonly ResourceRef[]; createdAt: string;
  startedAt?: string; completedAt?: string; error?: { code: string; message: string };
}>;
/** Emitted inside the store transaction for every accepted Job change; a throwing observer rolls the change back. */
export type JobEvent = Readonly<{ type: "job"; job: Job }>;
export type JobObserver = (event: JobEvent) => void;
export interface JobTransaction {
  get(id: string): Job | null;
  children(parentId: string): Job[];
  put(job: Job): void;
}
/** A provider must serialize and atomically commit/roll back the entire synchronous callback. */
export interface JobStore {
  get(id: string): Job | null;
  children(parentId: string): Job[];
  transaction<T>(operation: (transaction: JobTransaction) => T): T;
}

/** Test/development store; explicitly not durable across process loss. */
export class MemoryJobStore implements JobStore {
  #jobs = new Map<string, Job>();
  #inTransaction = false;
  get(id: string): Job | null { return structuredClone(this.#jobs.get(id) ?? null); }
  children(parentId: string): Job[] { return structuredClone([...this.#jobs.values()].filter(job => job.parentId === parentId)); }
  transaction<T>(operation: (transaction: JobTransaction) => T): T {
    if (this.#inTransaction) throw new Error("nested Job transaction");
    this.#inTransaction = true;
    const pending = structuredClone(this.#jobs);
    try {
      const result = operation({
        get: id => structuredClone(pending.get(id) ?? null),
        children: id => structuredClone([...pending.values()].filter(job => job.parentId === id)),
        put: job => { pending.set(job.id, structuredClone(job)); }
      });
      if (result && typeof (result as { then?: unknown }).then === "function") throw new Error("Job transactions must be synchronous");
      this.#jobs = pending;
      return structuredClone(result);
    } finally { this.#inTransaction = false; }
  }
}

export class JobService {
  readonly #now: () => string;
  readonly #observer: JobObserver | undefined;
  constructor(
    private readonly store: JobStore,
    /** Trusted contract evaluator. Returning true is an explicit acceptance decision, not a formal proof. */
    private readonly accepts: (definition: JobDefinitionRef, job: Job, outputs: readonly ResourceRef[]) => boolean,
    options: { now?: () => string; observer?: JobObserver } = {}
  ) {
    this.#now = options.now ?? (() => new Date().toISOString());
    this.#observer = options.observer;
  }
  #put(tx: JobTransaction, job: Job): void {
    tx.put(job);
    this.#observer?.({ type: "job", job: structuredClone(job) });
  }
  create(input: { id: string; kind: string; definition: JobDefinitionRef; parentId?: string; actor: ActorRef; inputs?: readonly ResourceRef[] }): Job {
    if (!input.definition || input.definition.kind !== "job-definition" || !input.definition.id || !input.definition.revision) throw new Error("an exact Job definition revision is required");
    if (!input.id || !input.kind || !input.actor?.id || !["human", "agent", "service"].includes(input.actor.kind)) throw new Error("explicit Job identity and Actor are required");
    for (const ref of input.inputs ?? []) assertResourceRef(ref);
    return this.store.transaction(tx => {
      if (tx.get(input.id)) throw new Error("job exists");
      if (input.parentId !== undefined) {
        if (input.parentId === input.id) throw new Error("a Job cannot parent itself");
        const parent = tx.get(input.parentId);
        if (!parent) throw new Error("parent not found");
        if (parent.status !== "pending") throw new Error("parent composition is frozen");
      }
      const job: Job = { id: input.id, kind: input.kind, definition: structuredClone(input.definition), parentId: input.parentId, actor: structuredClone(input.actor), inputs: structuredClone(input.inputs ?? []), outputs: [], status: "pending", createdAt: this.#now() };
      this.#put(tx, job);
      return job;
    });
  }
  get(id: string): Job | null { return this.store.get(id); }
  children(id: string): Job[] { return this.store.children(id); }
  requireRunning(id: string): Job {
    const job = this.get(id);
    if (!job || job.status !== "running") throw new Error("job is not running");
    return job;
  }
  private change(id: string, from: readonly JobStatus[], operation: (job: Job, tx: JobTransaction) => Job): Job {
    return this.store.transaction(tx => {
      const job = tx.get(id);
      if (!job || !from.includes(job.status)) throw new Error("invalid job transition");
      const updated = operation(job, tx);
      this.#put(tx, updated);
      return updated;
    });
  }
  start(id: string): Job {
    return this.change(id, ["pending"], (job, tx) => {
      if (job.parentId && tx.get(job.parentId)?.status !== "running") throw new Error("parent must be running");
      return { ...job, status: "running", startedAt: this.#now() };
    });
  }
  complete(id: string, outputs: readonly ResourceRef[]): Job {
    outputs.forEach(assertResourceRef);
    return this.change(id, ["running"], (job, tx) => {
      if (tx.children(id).some(child => child.status !== "completed")) throw new Error("required children have not completed");
      if (this.accepts(structuredClone(job.definition), structuredClone(job), structuredClone(outputs)) !== true) throw new Error("Job acceptance conditions are not satisfied");
      return { ...job, status: "completed", outputs: structuredClone(outputs), completedAt: this.#now() };
    });
  }
  fail(id: string, error: { code: string; message: string }): Job {
    return this.change(id, ["running"], (job, tx) => {
      if (tx.children(id).some(child => child.status === "pending" || child.status === "running")) throw new Error("required children have not resolved");
      return { ...job, status: "failed", error: { ...error }, completedAt: this.#now() };
    });
  }
  cancel(id: string): Job {
    return this.change(id, ["pending", "running"], (job, tx) => {
      const completedAt = this.#now();
      const cancelChildren = (parentId: string): void => {
        for (const child of tx.children(parentId)) {
          cancelChildren(child.id);
          if (child.status === "pending" || child.status === "running") this.#put(tx, { ...child, status: "cancelled", completedAt });
        }
      };
      cancelChildren(id);
      return { ...job, status: "cancelled", completedAt };
    });
  }
}
