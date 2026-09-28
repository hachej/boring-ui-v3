import type { ActorRef } from "../identity.js";
import type { Job } from "../jobs/job.js";
import { safeName, type EffectContext } from "../resources/resource.js";

/** One grant model for every Resource kind: a space (a mount, a record kind), a name pattern inside it, operations. */
export type Operation = "stat" | "read" | "write" | "remove";
export type Grant = Readonly<{ space: string; pattern: string; operations: readonly Operation[] }>;
export type Environment = Readonly<{ id: string; jobId: string; actor: ActorRef; grants: readonly Grant[] }>;
type Admission = { active: () => boolean; revoked: boolean };
const admissions = new WeakMap<Environment, Admission>();
const operations: readonly string[] = ["stat", "read", "write", "remove"];

/** `*` is the whole space; `dir/*` a subtree; otherwise one exact canonical name. */
function validPattern(value: string): boolean {
  return value === "*" || safeName(value) !== null || (value.endsWith("/*") && safeName(value.slice(0, -2)) !== null);
}
function covers(broad: string, narrow: string): boolean {
  return broad === "*" || broad === narrow || (broad.endsWith("/*") && narrow.startsWith(broad.slice(0, -1)));
}
function copyGrant(grant: Grant): Grant {
  if (!grant || typeof grant.space !== "string" || !grant.space || grant.space.includes("\0") || typeof grant.pattern !== "string" || !validPattern(grant.pattern) || !Array.isArray(grant.operations) || grant.operations.some(op => !operations.includes(op))) throw new Error("invalid grant");
  return Object.freeze({ space: grant.space, pattern: grant.pattern, operations: Object.freeze([...new Set(grant.operations)]) });
}
export function grantIsCovered(grant: Grant, bounds: readonly Grant[]): boolean {
  return grant.operations.every(op => bounds.some(bound => bound.space === grant.space && covers(bound.pattern, grant.pattern) && bound.operations.includes(op)));
}

/** Called only by trusted policy code with the Job record itself; request data and Actor tools never supply the binding, authorized or isActive. */
export function admitEnvironment(input: { id: string; job: Job; requested: readonly Grant[]; authorized: readonly Grant[]; isActive: () => boolean }): Environment {
  const job = input.job;
  if (!input.id || !job?.id || !job.actor?.id || !job.actor.kind || typeof input.isActive !== "function") throw new Error("invalid admission context");
  const requested = input.requested.map(copyGrant), authorized = input.authorized.map(copyGrant);
  const grants: Grant[] = [];
  for (const need of requested) for (const allowed of authorized) {
    if (need.space !== allowed.space) continue;
    const pattern = covers(need.pattern, allowed.pattern) ? allowed.pattern : covers(allowed.pattern, need.pattern) ? need.pattern : null;
    const permitted = need.operations.filter(op => allowed.operations.includes(op));
    if (pattern && permitted.length) grants.push(copyGrant({ space: need.space, pattern, operations: permitted }));
  }
  const environment = Object.freeze({ id: input.id, jobId: job.id, actor: Object.freeze({ kind: job.actor.kind, id: job.actor.id }), grants: Object.freeze(grants) });
  admissions.set(environment, { active: input.isActive, revoked: false });
  return environment;
}

export function revokeEnvironment(environment: Environment): void {
  const state = admissions.get(environment);
  if (!state) throw new Error("unknown Environment");
  state.revoked = true;
}
export function assertEnvironmentActive(environment: Environment): void {
  const state = admissions.get(environment);
  if (!state || state.revoked || state.active() !== true) throw new Error("Environment inactive or denied");
}
/** `name` is one canonical name, or `*` for an operation over the whole space (which needs a `*` grant). */
export function authorize(environment: Environment, operation: Operation, space: string, name: string): EffectContext {
  assertEnvironmentActive(environment);
  if (name !== "*" && !safeName(name)) throw new Error("bad name");
  if (!environment.grants.some(grant => grant.space === space && grant.operations.includes(operation) && (name === "*" ? grant.pattern === "*" : covers(grant.pattern, name)))) throw new Error("denied");
  return Object.freeze({ environmentId: environment.id, jobId: environment.jobId, actorId: environment.actor.id, actorKind: environment.actor.kind });
}
