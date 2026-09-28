// CI smoke drivers (`boring smoke`): canned, deterministic walks of a few features. Agents verifying a change drive
// the feature themselves with the controls in tools/control.mjs, guided by features/; these only guard regressions.
// Each walks one feature through a running hub the way a person reaches it, and returns the
// steps it observed. They talk HTTP only (the app's tools as the person, the Flue chat wire, the host state), so
// they run against any hub started with `boring run`, locally or remote. `panel` also drives a real browser.
// Each step is a claim with the observation that supports it; a failed step stops the driver.

const json = async response => { const body = await response.json().catch(() => ({})); return { status: response.status, body }; };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const DICTATION = "Cough for a week, dry, worse at night. No fever, no shortness of breath. Non-smoker. Chest clear on auscultation. Oxygen saturation 98 percent. Throat mildly red. Honey and warm drinks at night. Return if fever or breathlessness. No antibiotics needed.";

function recorder() {
  const steps = [];
  const started = Date.now();
  return {
    steps,
    async step(claim, fn) {
      const t0 = Date.now();
      try {
        const observed = await fn();
        steps.push({ claim, ok: true, observed, ms: Date.now() - t0 });
        return observed;
      } catch (error) {
        steps.push({ claim, ok: false, observed: error instanceof Error ? error.message : String(error), ms: Date.now() - t0 });
        throw Object.assign(new Error(`${claim}: ${error instanceof Error ? error.message : error}`), { steps });
      }
    },
    elapsed: () => Date.now() - started
  };
}
function expect(condition, message) { if (!condition) throw new Error(message); }

async function tool(url, name, input) { return json(await fetch(`${url}/app/api/tools/${name}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) })); }
async function state(url, after = 0) { return (await json(await fetch(`${url}/api/state?after=${after}`))).body; }
async function newRecord(url, title) {
  const created = await tool(url, "create_note", { title });
  expect(created.status === 200 && created.body.id, `create_note answered ${created.status} ${JSON.stringify(created.body)}`);
  const read = await tool(url, "read_note", { id: created.body.id });
  const saved = await tool(url, "save_dictation", { id: created.body.id, text: DICTATION, expected_revision: read.body.dictation_revision });
  expect(saved.status === 200, `save_dictation answered ${saved.status} ${JSON.stringify(saved.body)}`);
  await fetch(`${url}/api/select`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: created.body.id }) });
  return created.body.id;
}

/** app-tools: the app's declared tools, called as the person, under the platform's schema and revision rules. */
async function appTools({ url }) {
  const r = recorder();
  const id = await r.step("a person creates a record and dictates into it through the app's tools", async () => ({ id: await newRecord(url, `drive app-tools ${Date.now()}`) }));
  const note = await r.step("the record reads back with its database and dictation revisions", async () => {
    const read = await tool(url, "read_note", { id: id.id });
    expect(read.status === 200 && read.body.dictation.startsWith("Cough"), `read_note answered ${read.status}`);
    return { revision: read.body.revision, dictation_revision: read.body.dictation_revision };
  });
  await r.step("an input outside the declared schema is refused before the app handler runs", async () => {
    const bad = await tool(url, "save_section", { id: id.id, section: "Z", heading: "x", lines: [] });
    expect(bad.status === 400 && /not one of/.test(bad.body.error), `expected a schema refusal, got ${bad.status} ${JSON.stringify(bad.body)}`);
    return bad.body.error;
  });
  await r.step("a rename against the revision the person saw lands", async () => {
    const ok = await tool(url, "set_title", { id: id.id, title: "renamed", expected_revision: note.revision });
    expect(ok.status === 200, `set_title answered ${ok.status} ${JSON.stringify(ok.body)}`);
    return ok.body;
  });
  await r.step("a second rename against the same, now stale, revision is refused and nothing is lost", async () => {
    const stale = await tool(url, "set_title", { id: id.id, title: "lost update", expected_revision: note.revision });
    expect(stale.status === 400 && /stale/.test(stale.body.error), `expected a stale refusal, got ${stale.status} ${JSON.stringify(stale.body)}`);
    const read = await tool(url, "read_note", { id: id.id });
    expect(read.body.title === "renamed", `title is ${read.body.title}`);
    return stale.body.error;
  });
  return r;
}

/** chat-request: a person asks in the chat; the assistant requests work; the app's agents write; the chat reports. */
async function chatRequest({ url, timeoutMs = 240_000 }) {
  const r = recorder();
  const before = await state(url);
  const person = before.person;
  const id = await r.step("a person opens a record with dictation in the app", async () => ({ id: await newRecord(url, `drive chat-request ${Date.now()}`), model: before.model }));
  await r.step("another person's conversation is refused on the chat wire", async () => {
    const other = await fetch(`${url}/agents/assistant/not-${person}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "user", body: "hi" }) });
    expect(other.status === 403, `expected 403, got ${other.status}`);
    return other.status;
  });
  const admission = await r.step("a chat message is admitted on the Flue wire", async () => {
    const sent = await json(await fetch(`${url}/agents/assistant/${person}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "user", body: "Draft the open note from its dictation." }) }));
    expect(sent.status === 202 && sent.body.submissionId, `expected 202 with a submission id, got ${sent.status}`);
    return { submissionId: sent.body.submissionId };
  });
  const reply = await r.step("the turn settles and the assistant's reply lands in the conversation", async () => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const snap = (await json(await fetch(`${url}/agents/assistant/${person}`))).body;
      const settled = snap.settlements?.find(s => s.submissionId === admission.submissionId);
      if (settled) {
        expect(settled.outcome === "completed", `turn ${settled.outcome}`);
        const parts = snap.messages.filter(m => m.submissionId === admission.submissionId && m.role === "assistant").flatMap(m => m.parts);
        const work = parts.find(p => p.type === "dynamic-tool" && p.toolName === "request_work");
        expect(work?.state === "output-available", `request_work was ${work ? work.state : "not called"}`);
        expect(work.output?.status === "completed", `request_work returned ${JSON.stringify(work.output)}`);
        return { job: work.output.job, text: parts.filter(p => p.type === "text").map(p => p.text).join(" ").slice(0, 200) };
      }
      expect(Date.now() < deadline, `no settlement after ${timeoutMs} ms`);
      await sleep(500);
    }
  });
  await r.step("the record now has every section, written by the app's agents", async () => {
    const read = await tool(url, "read_note", { id: id.id });
    const sections = Object.keys(read.body.sections).sort();
    expect(sections.join() === "A,B,C", `sections ${sections.join()}`);
    return { revision: read.body.revision, sections: Object.fromEntries(Object.entries(read.body.sections).map(([k, v]) => [k, v.lines.length])) };
  });
  await r.step("each write is attributed in the effect log to its own agent Job, and the request completed", async () => {
    const after = await state(url, 0);
    const writes = after.events.filter(e => e.type === "resource" && e.ref.kind === "database" && e.context?.jobId?.startsWith(`${reply.job}/`));
    const writers = [...new Set(writes.map(e => e.context.actorId))].sort();
    expect(writers.length === 3, `writes by ${writers.join()}`);
    const request = after.events.filter(e => e.type === "job" && e.job.id === reply.job).at(-1);
    expect(request?.job.status === "completed", `request is ${request?.job.status}`);
    return { writers, writes: writes.length };
  });
  return r;
}

/** panel: the same request through the chat panel bundle in a real browser, as a person types it. */
async function panel({ url, chrome, screenshot, timeoutMs = 240_000 }) {
  const r = recorder();
  const s = await state(url);
  await r.step("the chat panel bundle is served by this hub", async () => { expect(s.chatBundle, "the hub runs without --chat-bundle; the page falls back to the minimal client"); return true; });
  const { chromium } = await import(process.env.PLAYWRIGHT_CORE ?? "playwright-core");
  const browser = await chromium.launch({ executablePath: chrome, args: ["--no-sandbox"] });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", e => errors.push(e.message));
    // A conversation read before its first message is Flue's documented 404 stream_not_found; the hub's wire treats it as empty.
    const beforeFirstMessage = res => res.status() === 404 && res.request().method() === "GET" && /\/agents\/(colleague|assistant)\/[^/?]+(\?|$)/.test(new URL(res.url()).pathname + new URL(res.url()).search);
    page.on("response", res => { if (res.status() >= 400 && !res.url().endsWith("/favicon.ico") && !beforeFirstMessage(res)) errors.push(`${res.status()} ${res.url()}`); });
    await page.goto(url, { waitUntil: "load" });
    const app = page.frameLocator("#app");
    await r.step("a person creates a record and saves its dictation in the app pane", async () => {
      await app.locator("#newTitle").fill(`drive panel ${Date.now()}`); await app.locator("#new button").click(); await page.waitForTimeout(1200);
      await app.locator("#dictation").fill(DICTATION); await app.locator("#saveDictation").click(); await page.waitForTimeout(1200);
      return (await app.locator("#msg").innerText()).trim();
    });
    await r.step("they ask in the chat panel bundle and the agents fill every section", async () => {
      const composer = page.locator("#chat textarea, #chat [contenteditable=true]").first();
      await composer.click(); await composer.fill("Draft the open note from its dictation."); await composer.press("Enter");
      const deadline = Date.now() + timeoutMs;
      while ((await app.locator(".card.filled").count()) < 3) { expect(Date.now() < deadline, "sections not filled in time"); await page.waitForTimeout(1000); }
      return { filled: 3 };
    });
    await r.step("the page raised no errors and no failed requests", async () => { expect(!errors.length, errors.join("; ")); return 0; });
    if (screenshot) await page.screenshot({ path: screenshot });
  } finally { await browser.close(); }
  return r;
}

export const drivers = {
  "app-tools": { feature: "app-pane", run: appTools, needs: [] },
  "chat-request": { feature: "requests", run: chatRequest, needs: [] },
  panel: { feature: "chat", run: panel, needs: ["browser"] }
};
