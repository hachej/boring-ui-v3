/** Dependency-neutral references: identity and provenance, never authority. */
export type ActorRef = Readonly<{ kind: "human" | "agent" | "service"; id: string }>;
export type ResourceKind = "file" | "database" | "audio" | "agent-definition" | "job-definition" | "approval" | "outcome";
export type ResourceRef = Readonly<{ kind: ResourceKind; id: string; revision: string }>;
export type JobRef = Readonly<{ id: string }>;
