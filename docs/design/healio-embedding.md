# Embedding Boring in healio

A stress test of the library against a real application, without changing it. healio (`/home/ubuntu/projects/healio`) is a staff-scheduling product for healthcare teams: a pnpm/Turbo monorepo, `apps/core` a React Router 8 app in framework mode (SSR) served by a custom Express `server.ts` on Node 24, a pg-boss worker (`worker/index.ts`), Postgres through Drizzle with row-level security, a Python solver over Connect. Its domain word is *planning*: a planning entry is one user, one day, one shift or absence. It already has an LLM planner (`app/.server/domain/planner-agent/`, Vercel AI SDK `ToolLoopAgent` with tools `get_current_planning`, `set_shift`, `clear_entries`, `set_absence`, `ask_user`) exposed only to the employee app over tRPC.

## Where the runtime runs

**In the app process, not the worker, not a sidecar.** `createRuntime` needs `node:sqlite` and a filesystem; healio's server is Node 24 in a Docker container on a VPS (Kamal), so both are there. The worker is a job process without HTTP beyond metrics; a sidecar would need its own auth. Mounting in `server.ts` beside the tRPC mount is one line:

```ts
// apps/core/server.ts, beside app.use("/api/employee", ...)
const runtime = await createRuntime({ host, app: await loadApp("./boring"), tools, store: env.BORING_STORE, model: { kind: "openrouter", apiKey: env.PLANNER_AGENT_API_KEY } });
const wire = mountWire({ host, runtime, basePath: "/agent" });
app.use("/agent", (req, res) => toNodeResponse(wire.fetch(toWebRequest(req)), res));   // the notes and embed-host examples show this adapter
```

The SQLite store lives on the container's volume (`/data/boring.sqlite`); healio keeps one Kamal accessory volume per app already. The runtime's `store` is not healio's Postgres: threads, runs and receipts are the library's records; healio's data stays behind healio's services. Later, a Postgres-backed store is the only thing that would change.

## The Host contract over healio's auth

healio's session is an httpOnly signed cookie `session` holding `{ token, userId }`, validated by `SessionService.validateSessionToken`; the tenant comes from the subdomain (`app/lib/url/tenant.server.ts`); roles are system (`user`, `system_admin`), tenant (`admin`, `viewer`) and team (`employee`, `manager`). The Host maps them without the library learning any of them:

```ts
const host: Host = {
  async resolveActor(request: Request) {
    const session = await sessions.validate(cookieOf(request));            // healio's own
    if (!session) return null;
    const tenant = tenantFromHost(new URL(request.url).host);
    const memberships = await teamMemberships(session.userId, tenant.id); // [{ teamId, role }]
    return { id: session.userId, roles: [session.systemRole, `tenant:${tenant.role}`, ...memberships.map(m => `team:${m.teamId}:${m.role}`)], scope: { tenant: tenant.id } };
  },
  async mayRequest(actor, { agent, grants }) {            // managers may run the planner; everyone may run the assistant
    if (agent === "planner" && !actor.roles.some(r => r.endsWith(":manager"))) return false;
    return grants.every(g => g.mount !== "workspace" || g.mode === "read" || actor.roles.includes("user"));
  },
  async isActive(run) { return !(await revoked(run.id)); },
  async mounts(actor) { return { code, workspace: workspaceOf(actor), shared }; },
  async allowedTools(actor) { return [...FILE_TOOLS, "get_planning", "open_week", "select_entry", "propose_assignment", ...(isManager(actor) ? ["set_entry"] : [])]; },
  async mayAnswer(actor, decision) { return decision.thread ? ownsThread(actor, decision.thread) : false; },
  async onUsage(usage) { await langfuse.record(usage); },
};
```

`actor.scope.tenant` comes back to the host with every question, which is what `RLSEnforcedDatabase(tenant, user)` needs; the library never reads it.

## Three page commands from the planning UI

The planning screen is `/dashboard/:teamId/planning` (`app/routes/dashboard/planning/planning.tsx`): the window is `?reference=YYYY-MM-DD&range=week|month` from the URL, the grid is `PlanningGrid` (`app/components/domain/planning/planning-grid.tsx`), selection is a zustand store (`store/planning-selection-store.ts`), and a choice posts to `api/planning/set-entry` through `useFetcher` (`planning-dropdown/use-set-planning-entry.ts`). In `planning.tsx`:

```tsx
const { page } = useAgentUi({ client, thread, target: { kind: "planning-window", id: `${teamId}:${reference}:${range}`, version: String(lastSseRevision) }, commands: [
  { name: "open_week", description: "Show the week containing a date.", input: { type: "object", properties: { date: { type: "string" } }, required: ["date"] },
    handler: async ({ date }) => { navigate(makeQuery({ reference: date, range: "week" })); return { outcome: "applied", detail: { reference: date } }; } },
  { name: "select_entry", description: "Select one cell of the grid: a member on a day.", input: { type: "object", properties: { userId: { type: "string" }, date: { type: "string" } }, required: ["userId", "date"] },
    handler: async ({ userId, date }) => { if (!visible(userId, date)) return { outcome: "unavailable", detail: "not in the shown window" }; selection.select({ userId, date }); return { outcome: "applied" }; } },
  { name: "propose_assignment", description: "Open the shift dropdown on the selected cell with a shift preselected; the person confirms.", input: { type: "object", properties: { shiftId: { type: "string" } }, required: ["shiftId"] },
    handler: async ({ shiftId }) => { dropdown.open({ ...selection.current(), preselect: shiftId }); return { outcome: "proposed", detail: { shiftId } }; } },
] });
```

The first two are local (`applied`). The third is a proposal: the person confirms in the dropdown, and the confirmation goes through `api/planning/set-entry` exactly as a click would (UI-BOUNDARY-3); the agent's request ends `proposed`, never `committed`. The target is the planning window plus the last SSE revision seen (`api/sse/:teamId/planning` pushes `planning.updated`): an `open_week` answered after the person navigated is `stale`.

## Two backend tools with admitted operations

```ts
const tools: ToolDefinition[] = [
  { name: "get_planning", description: "The planning entries of a team in a window.", input: { type: "object", properties: { teamId: { type: "string" }, from: { type: "string" }, to: { type: "string" } }, required: ["teamId", "from", "to"] },
    handler: async ({ teamId, from, to }, { effect }) => planning.list(dbFor(effect.actor, teamId), { from, to }) },
  { name: "set_entry", description: "Set a member's shift on a day, at the entry's updatedAt you observed.", mutates: true,
    input: { type: "object", properties: { teamId: { type: "string" }, userId: { type: "string" }, date: { type: "string" }, shiftId: { type: "string" }, observedUpdatedAt: { type: "string" } }, required: ["teamId", "userId", "date", "shiftId"] },
    handler: async (input, { effect }) => planning.setShiftPlanningEntries(dbFor(effect.actor, input.teamId), input, { by: effect.actor, run: effect.run }) },
];
```

`dbFor(actorId, teamId)` builds `RLSEnforcedDatabase(tenant, user)` from healio's own lookups, so RLS and the `*_versions` triggers (`changedBy`) apply to the agent as to a person. `effect.run` goes into the version row's metadata: healio's history becomes the receipt's counterpart. The library's receipt row for `set_entry` records the call; the revision is healio's (`updatedAt`).

## Mounts

- `/code`: `readonly(githubProvider({ owner: "healio", repo: "healio", ref: env.GIT_SHA, auth: () => secrets.githubToken() }))`. Pinned to the deployed commit, so reads are exact and writes are refused twice (the ref is a sha; the wrapper). The token comes from healio's 1Password-resolved env at request time and is stored nowhere. A `directoryProvider` over the image's own source would do the same offline.
- `/workspace`: `directoryProvider({ root: /data/workspaces/${tenant}/${userId} })` per actor, receipts into a table healio owns (a `ReceiptLog` that inserts a row in the same transaction is the hook). Uploads, exported months, the person's notes.
- `/shared`: `readonly(memoryProvider({ seed: snapshotDirectory("boring/shared") }))`: labour rules in prose, the shift vocabulary; compiled into the image.
- `mnt/solutions` (later): the solver's proposals (`planning-solutions.ts`) as files, read-only, so the assistant can explain a proposed change without a bespoke tool.

`agents/assistant/agent.md` declares `files: { code: read, shared: read, workspace: [read, write] }` and `ui: [open_week, select_entry, propose_assignment]`; the planner agent declares `files: { shared: read }` and no `ui:`.

## What in the library made this hard

1. **A page mounts before any message exists.** healio's planning route is open long before the person talks; `useAgentUi` needs a thread to register on, and the wire only created threads as a side effect of a message. The first request from the agent could never reach the page. *Fixed*: `POST /threads` and `client.createThread()`; the shell creates its thread on mount and reports it through `onThread`.
2. **The Host could not tell the agent apart.** `mayRequest` received tools and grants but not which agent; healio wants managers only on the planner. *Fixed*: `agent` in the request.
3. **The tenant had nowhere to travel.** healio's authorization needs the tenant with every question; `Actor` had only `id`, `name`, `roles`. *Fixed*: `Actor.scope`, opaque to the library, handed back with every Host call.
4. **No versions on planning entries.** healio's writes are last-write-wins upserts with `updatedAt` and SSE fan-out. A page command's target therefore binds the window and the last SSE revision rather than a row version, and `set_entry` takes `observedUpdatedAt`. The library asks for a `version` string and does not care what it is; the honest note is that healio has no optimistic lock to bind to today, so `conflict` from the backend is by convention, not by constraint.
5. **CSP with nonces and SRI** (`app/middleware.ts`). The shell injects no stylesheet and no script, so nothing needs a nonce; inline `style` attributes do need `style-src 'unsafe-inline'` or a hashed policy. Headless mode with a host stylesheet avoids even that. *Noted in the shell's README.*
6. **Secrets as callbacks.** healio resolves `op://` references at start and rotates them; a provider that captured a token string at mount would hold a stale one. *Kept*: `githubProvider({ auth })` asks per request.
7. **Two enforcement layers on `/code`.** A grant of `read` and a `readonly()` provider are both needed: the grant stops the run's tool at the address, the wrapper stops any other path (a helper tool holding the provider). Both exist; the doc above uses both.
8. **The SSE proxy**: the wire's NDJSON streams share the `sfw` proxy caveat healio already documents (`NO_PROXY=healio.test`). Nothing to change in the library; worth a line in healio's env template.

## Changes made to the library because of healio

- `POST /threads` on the wire, `createThread()` on the client, and `BoringChat` creating its thread on mount (so a page's commands are registered before the first message).
- `agent` added to `Host.mayRequest`'s request.
- `Actor.scope`, an opaque record the host gets back with every question.
- `UiTarget.version` documented as any string the page can compare (a row version, an SSE revision, an ETag), and the bridge's `stale` answer specified against it.
- The shell's README states the CSP consequence of inline styles and recommends `headless` under a strict policy.
- `githubProvider` keeps `auth` as a callback asked per request; the doc records the reason.
