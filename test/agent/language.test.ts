import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { PHRASES, phrasesFor } from "@boring/agent";
import { boot, tempDir, type Script } from "./helpers.ts";

test("AGENT-14: in French, the model reads French history labels and repair prompts, and the record holds a French error with a stable failure kind", async t => {
  const seen: string[] = [];
  const script: Script = request => {
    seen.push(request.messages.map(m => m.content).join("\n"));
    if (request.outputTool) return { text: "Je préfère ne pas." };
    return { text: "Du lait." };
  };
  const { call, settled, runtime } = await boot({ script, language: "fr" });
  t.after(() => runtime.stop());
  const run = await settled((await call("POST", "/agents/summarise/runs", { inputs: { note: "n" } })).body.id);
  assert.equal(run.status, "failed");
  assert.equal(run.failure, "invalid_output");
  assert.match(run.error, /^l'agent n'a pas produit de document valide : Appelle l'outil summary_save/);
  assert.ok(seen.some(m => m.includes("Appelle l'outil summary_save avec le document complet.")), "the repair prompt is French");
  assert.ok(seen.every(m => !/Call the tool|Refused:/.test(m)), "no English framework text reached the model");

  const first = (await call("POST", "/conversations/questions/messages", { text: "Qu'avons-nous ?", inputs: { notes: ["Lait"] } })).body;
  await settled(first.run.id);
  seen.length = 0;
  const second = (await call("POST", "/conversations/questions/messages", { text: "Et ensuite ?", thread: first.thread, inputs: { notes: ["Lait"] } })).body;
  await settled(second.run.id);
  assert.match(seen[0], /# Échanges précédents\n\n\*\*Personne\*\*: Qu'avons-nous \?\n\n\*\*Assistant\*\*: Du lait\./);
});

test("AGENT-14: one phrase can be overridden; the rest of the language stays", async t => {
  const seen: string[] = [];
  const { call, settled, runtime } = await boot({ language: "fr", phrases: { person: "Médecin" }, script: request => { seen.push(request.messages.map(m => m.content).join("\n")); return { text: "Oui." }; } });
  t.after(() => runtime.stop());
  const first = (await call("POST", "/conversations/questions/messages", { text: "Un ?", inputs: { notes: [] } })).body;
  await settled(first.run.id);
  await settled((await call("POST", "/conversations/questions/messages", { text: "Deux ?", thread: first.thread, inputs: { notes: [] } })).body.run.id);
  assert.match(seen.at(-1)!, /# Échanges précédents\n\n\*\*Médecin\*\*: Un \?\n\n\*\*Assistant\*\*: Oui\./);
  assert.equal(phrasesFor("fr", { person: "Médecin" }).agent, PHRASES.fr.agent);
  assert.throws(() => phrasesFor("de" as never), /unknown language/);
});

test("AGENT-14: every failure carries its kind — error, interrupted — and English stays the default", async t => {
  const { call, settled, runtime } = await boot({ script: () => { throw new Error("provider down"); } });
  const run = await settled((await call("POST", "/agents/answer/runs", { message: "?", inputs: { notes: [] } })).body.id);
  assert.equal(run.status, "failed");
  assert.equal(run.failure, "error");
  assert.match(run.error, /^run failed: /);
  await runtime.stop();

  const store = path.join(tempDir(), "agent.sqlite");
  const first = await boot({ store, language: "fr" });
  const thread = first.runtime.store.createThread("ana");
  const orphan = first.runtime.store.createRun({ thread: thread.id, agent: "summarise", actor: "ana", input: {}, model: "fake/summarise" });
  first.runtime.store.startRun(orphan.id);
  await first.runtime.stop();
  const second = await boot({ store, language: "fr" });
  t.after(() => second.runtime.stop());
  const failed = (await second.call("GET", `/runs/${orphan.id}`)).body;
  assert.equal(failed.failure, "interrupted");
  assert.match(failed.error, /^interrompu : /);
});
