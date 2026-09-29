// `boring smoke`: the CI regression guard. One deterministic journey through a throwaway instance of the example app
// with the fake model, built from the same controls an agent drives by hand (control.mjs): the manifest, a
// conversation turn on the wire and its replay, an idempotent run with a receipt and a usage row, a job of
// predeclared children, ownership on the wire, the chat page in a real browser (send, reply, reload), and a
// restart with the data kept. Every step is a claim with what was observed; the evidence lands under
// .cache/evidence/<time>/. It guards regressions; it does not replace driving the feature you changed.
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { root } from "./formal.mjs";
import * as c from "./control.mjs";

const expect = (condition, message) => { if (!condition) throw new Error(message); };

export function evidenceDir() {
  const dir = path.join(root, ".cache/evidence", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(dir, { recursive: true });
  return dir;
}

export async function smoke(opts = {}) {
  const dir = opts.evidence ?? evidenceDir();
  const stateDir = path.join(root, ".cache/smoke");
  const steps = [];
  const step = async (claim, fn) => {
    const t0 = Date.now();
    try { const observed = await fn(); steps.push({ claim, ok: true, observed, ms: Date.now() - t0 }); return observed; }
    catch (error) { steps.push({ claim, ok: false, observed: error.message, ms: Date.now() - t0 }); throw error; }
  };
  let env = null;
  const t0 = Date.now();
  let ok = true, error = null;
  try {
    env = await c.envUp({ stateDir, ports: c.derivedPorts(7), model: "fake", restart: true, browser: opts.browser !== false, log: m => console.log(m) });
    const say = "What do I need to buy?";

    await step("the manifest lists the app's agents, jobs and conversations with their invocation routes", async () => {
      const m = await c.manifest(env);
      expect(m.protocol === 1 && m.name === "notes", `manifest ${JSON.stringify(m).slice(0, 100)}`);
      expect(m.agents.map(a => a.name).join() === "answer,summarise" && m.jobs[0]?.name === "digest" && m.conversations[0]?.name === "questions", "definitions missing");
      expect(m.agents[1].inputs.type === "object" && m.jobs[0].children.join() === "summarise", "schemas missing");
      return { agents: m.agents.map(a => a.name), jobs: m.jobs.map(j => j.name), conversations: m.conversations.map(x => x.name) };
    });

    const turn = await step("a message on the conversation is admitted (202) and creates a thread and a pending run", async () => {
      const r = await c.send(env, say);
      expect(r.run.status === "pending" && r.thread, JSON.stringify(r));
      return { thread: r.thread, run: r.run.id };
    });
    const settled = await step("the turn settles: the run completed with the scripted answer, recorded as the agent's message", async () => {
      const s = await c.waitSettle(env, { timeout: 60 });
      const view = (await c.wire(env, "GET", `/runs/${turn.run}`)).body;
      expect(view.status === "completed", `run is ${view.status}: ${view.error}`);
      expect(s.reply === `Scripted answer to: ${say}`, `reply was ${JSON.stringify(s.reply)}`);
      return { status: view.status, reply: s.reply, attempts: view.attempts };
    });
    const replayed = await step("the thread replays in order (recorded, said, running, answered, completed) and a second replay is identical", async () => {
      const a = await c.replay(env, { thread: turn.thread }), b = await c.replay(env, { thread: turn.thread });
      expect(JSON.stringify(a) === JSON.stringify(b), "two replays differ");
      const kinds = a.map(e => e.kind === "run" ? `run:${e.run.status}` : `${e.kind}:${e.message?.role}`);
      expect(kinds.join() === "run:pending,message:person,run:running,message:agent,run:completed", kinds.join());
      const tail = await c.replay(env, { thread: turn.thread }, a[1].cursor);
      expect(tail.map(e => e.cursor).join() === a.slice(2).map(e => e.cursor).join(), "cursor replay differs");
      return { events: kinds, cursors: a.map(e => e.cursor) };
    });
    await step("another actor cannot see this thread or run (404), the wire takes identity from the host only", async () => {
      const t = await c.wire(env, "GET", `/threads/${turn.thread}`, undefined, { actor: "someone-else" });
      const r = await c.wire(env, "GET", `/runs/${turn.run}`, undefined, { actor: "someone-else" });
      expect(t.status === 404 && r.status === 404, `${t.status} ${r.status}`);
      return { thread: t.status, run: r.status };
    });

    const first = await step("a summarise run with an idempotency key completes with a validated structured output", async () => {
      const r = await c.startRun(env, "summarise", { note: "Buy milk tomorrow." }, { key: "smoke-1" });
      await c.waitSettle(env, { timeout: 60 });
      const view = (await c.wire(env, "GET", `/runs/${r.id}`)).body;
      expect(view.status === "completed" && view.output?.title === "A scripted title" && view.output.tags?.[0] === "fake", JSON.stringify(view));
      return { id: r.id, output: view.output, model: view.model };
    });
    await step("the same key with the same body returns the same run; the same key with another body is refused (409)", async () => {
      const same = await c.wire(env, "POST", "/agents/summarise/runs", { inputs: { note: "Buy milk tomorrow." }, idempotencyKey: "smoke-1" });
      const other = await c.wire(env, "POST", "/agents/summarise/runs", { inputs: { note: "Something else." }, idempotencyKey: "smoke-1" });
      expect(same.status === 202 && same.body.id === first.id, `same body: ${same.status} ${same.body.id}`);
      expect(other.status === 409, `other body: ${other.status}`);
      return { same: same.body.id, other: other.status };
    });
    await step("the helper tool call left a receipt attributed to the actor, thread, run and tool, and the model call a usage row", async () => {
      const t = await c.trace(env, first.id);
      const receipt = t.receipts.find(r => r.tool === "lookup");
      expect(receipt?.ok && receipt.actor === "dev" && receipt.thread === t.run.thread, `receipts ${JSON.stringify(t.receipts)}`);
      expect(t.usage.length >= 1 && t.usage.every(u => u.actor === "dev" && u.agent === "summarise"), `usage ${JSON.stringify(t.usage)}`);
      return { receipts: t.receipts.map(r => `${r.tool}:${r.ok ? "ok" : "refused"}`), usage: t.usage.map(u => `${u.model} ${u.input}/${u.output}`) };
    });
    await step("cancelling a run that already ended is refused (409): a run takes one terminal transition", async () => {
      const r = await c.cancel(env, first.id);
      expect(r.status === 409, `${r.status} ${JSON.stringify(r.body)}`);
      return r.body.error;
    });

    await step("a digest job starts one predeclared child per note and completes only from completed children, in order", async () => {
      const j = await c.startJob(env, "digest", { notes: ["Buy milk tomorrow.", "Call the dentist on Monday."] });
      expect(j.children.length === 2 && j.children.every(ch => ch.agent === "summarise" && ch.job === j.id), JSON.stringify(j).slice(0, 200));
      await c.waitSettle(env, { timeout: 60 });
      const done = (await c.wire(env, "GET", `/jobs/${j.id}`)).body;
      expect(done.status === "completed" && done.children.every(ch => ch.status === "completed") && done.output.summaries.length === 2, JSON.stringify(done).slice(0, 300));
      const empty = await c.wire(env, "POST", "/jobs/digest/start", { inputs: { notes: [] } });
      expect(empty.status === 400, `empty plan: ${empty.status}`);
      return { job: done.id, children: done.children.map(ch => ch.status), summaries: done.output.summaries.length, emptyPlan: empty.status };
    });

    if (opts.browser !== false) {
      expect(env.browser?.cdp, env.browser?.error ?? "no browser");
      const asked = "And who should I call?";
      await step("in the browser, a person types in the chat page and the agent's reply renders from the wire", async () => {
        await c.withPage(env, async page => { await page.goto(`${env.url}/`, { waitUntil: "load" }); });
        await c.type(env, "input[aria-label=message]", asked);
        await c.click(env, "button[type=submit]");
        await c.waitFor(env, "[data-boring-chat] li[data-role=agent]", 30000);
        await c.waitSettle(env, { timeout: 60 });
        const shown = await c.evaluate(env, "[...document.querySelectorAll('[data-boring-chat] li[data-role]')].map(li => li.dataset.role + ': ' + li.textContent)");
        expect(shown.join("|") === `person: ${asked}|agent: Scripted answer to: ${asked}`, shown.join("|"));
        await c.screenshot(env, path.join(dir, "page.png"));
        return shown;
      });
      await step("after a reload the page shows the same transcript, rebuilt from the thread's events", async () => {
        const before = await c.evaluate(env, "[...document.querySelectorAll('[data-boring-chat] li[data-role]')].map(li => li.dataset.role + ': ' + li.textContent)");
        await c.reload(env);
        await c.waitFor(env, "[data-boring-chat] li[data-role=agent]", 30000);
        const after = await c.evaluate(env, "[...document.querySelectorAll('[data-boring-chat] li[data-role]')].map(li => li.dataset.role + ': ' + li.textContent)");
        expect(before.length === 2 && before.join("|") === after.join("|"), `before ${before.join("|")} after ${after.join("|")}`);
        await c.screenshot(env, path.join(dir, "page-after-reload.png"));
        return { before, after, url: await c.evaluate(env, "location.hash") };
      });
    }

    await step("after a restart with the data kept, the runs and the thread replay unchanged from the records", async () => {
      const runsBefore = c.runs(env, { all: true }).map(r => `${r.id}:${r.status}`);
      const eventsBefore = await c.replay(env, { thread: turn.thread });
      await c.envDown({ stateDir });
      env = await c.envUp({ stateDir, ports: c.derivedPorts(7), model: "fake", "keep-data": true, browser: false });
      const runsAfter = c.runs(env, { all: true }).map(r => `${r.id}:${r.status}`);
      const eventsAfter = await c.replay(env, { thread: turn.thread });
      expect(runsBefore.join() === runsAfter.join(), `runs changed: ${runsBefore.length} → ${runsAfter.length}`);
      expect(JSON.stringify(eventsBefore) === JSON.stringify(eventsAfter), "thread replay changed across the restart");
      return { runs: runsAfter.length, events: eventsAfter.length, replayed: replayed.cursors.length };
    });
    void settled;
  } catch (failure) { ok = false; error = failure.message; }
  finally { if (env) await c.envDown({ stateDir, clean: true }).catch(() => {}); }
  const result = { ok, error, ms: Date.now() - t0, steps, evidence: dir };
  writeFileSync(path.join(dir, "smoke.json"), JSON.stringify(result, null, 2));
  return result;
}

export function printSmoke(result) {
  for (const s of result.steps) console.log(`  ${s.ok ? "ok " : "FAIL"} ${s.claim}${s.ok ? "" : `\n       ${s.observed}`}`);
  if (!result.ok && !result.steps.some(s => !s.ok)) console.log(`  FAIL ${result.error}`);
  console.log(`${result.ok ? "PASS" : "FAIL"} smoke ${(result.ms / 1000).toFixed(1)} s; evidence: ${path.relative(root, result.evidence)}/`);
}
