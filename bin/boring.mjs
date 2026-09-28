#!/usr/bin/env node
// `boring`: the one command an agent uses to verify its change. Structure and evidence (check, verify, model), a
// remote control for an isolated running hub (env, send, wait-settle, page controls, log, trace), and a CI smoke
// run built from the same controls. `boring --help` is the canonical command surface.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { checkArchitecture } from "../platform/check.mjs";
import { root, runModel } from "../tools/formal.mjs";
import { loadRegistries, verify } from "../tools/verify.mjs";

const HELP = `boring <command> [args] [--json]

Structure and evidence
  check                              architecture and evidence-registry structure
  verify [all|owner]                 run the evidence registered for each invariant
  model <name>                       one TLA+ model: execution | job-lifecycle | resource-commit
  features                           the feature map index (what to drive, how a person reaches it)
  nouns                              the platform's nouns

Environment (one isolated hub per checkout: derived ports, own data, own headless browser)
  doctor                             toolchain, credentials, and whether the running instance is fresh and ours
  env up [--seed s] [--model scripted|codex|<spec>] [--think-ms n] [--no-browser] [--chat-bundle dir] [--restart] [--keep-data]
  env info | env seeds | env down [--clean]
  run [--model m] [--port p] [--app dir]      a hub in the foreground (for people, not agents)

Act and inspect (on the environment)
  send "<text>" [--wait]             a chat message on the Flue wire; --wait = send then wait-settle
  wait-settle [--timeout s]          until every chat turn settled, no request runs and the app db stopped moving
  chat                               the conversation as the person sees it
  tool <name> ['<json>']             call an app tool as the person
  select <id>                        open a record in the app (what the assistant sees as open)
  state                              running requests, db revision, open record, approval, model
  log [--since n] [--job id]         the effect log: Job transitions and every write with who made it
  trace <job>                        a request's Jobs and each agent's Flue conversation (prompt, tool calls, reply)

The live page (app pane selectors take the prefix app:)
  screenshot [file] | snapshot [selector] | click <selector> | type <selector> <text>
  press <keys> [--in selector] | eval <js> (read state after the user path, never to act) | reload

CI smoke (canned, deterministic; not a substitute for driving the feature you changed)
  smoke [driver...] [--url u] [--browser] [--model m]     alias: e2e`;

function flags(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) { out._.push(argv[i]); continue; }
    const key = argv[i].slice(2);
    if (key.startsWith("no-")) { out[key.slice(3)] = false; continue; }
    const next = argv[i + 1];
    out[key] = next === undefined || next.startsWith("--") ? true : (i++, next);
  }
  return out;
}
const [command = "help", ...rest] = process.argv.slice(2);
const opts = flags(rest);
const print = (value, human) => { if (opts.json || human === undefined) console.log(typeof value === "string" ? value : JSON.stringify(value, null, 2)); else console.log(human(value)); };

const needsHost = ["env", "run", "smoke", "e2e", "drive", "send", "wait-settle", "chat", "tool", "select", "state", "log", "trace", "screenshot", "snapshot", "click", "type", "press", "eval", "reload"];
try {
  if (needsHost.includes(command) && !existsSync(path.join(root, "host/run.ts"))) throw new Error(`${command}: no host runtime in this checkout yet. It arrives with layer 2 (docs/architecture/ROADMAP.md); check, verify, model, nouns, features and doctor work now.`);
  const control = ["doctor", "env", "send", "wait-settle", "chat", "tool", "select", "state", "log", "trace", "screenshot", "snapshot", "click", "type", "press", "eval", "reload"].includes(command) ? await import("../tools/control.mjs") : null;
  const env = () => control.requireEnv();
  switch (command) {
    case "check": {
      loadRegistries();
      const errors = await checkArchitecture(root);
      if (errors.length) throw new Error(errors.join("\n"));
      console.log("Architecture and evidence registry checks passed");
      break;
    }
    case "verify": if (!verify(opts._[0] ?? "all")) process.exitCode = 1; break;
    case "model": { const result = runModel(opts._[0]); process.stdout.write(result.output); if (result.status !== 0) process.exitCode = 1; break; }
    case "nouns": console.log(JSON.parse(readFileSync(path.join(root, "platform/ARCHITECTURE.json"), "utf8")).nouns.join("\n")); break;
    case "features": process.stdout.write(readFileSync(path.join(root, ".agent/skills/verify-boring/features/README.md"), "utf8")); break;
    case "doctor": {
      const { doctor } = await import("../tools/drive.mjs");
      const rows = [...doctor(opts), ...await control.instanceRows()];
      print(rows, r => r.map(row => `${row.ok ? "ok " : "-- "} ${row.name.padEnd(16)} ${row.detail}${row.ok ? "" : `\n     ${row.unlocks}`}`).join("\n"));
      break;
    }
    case "env": {
      const sub = opts._[0] ?? "info";
      if (sub === "up") print(await control.envUp({ ...opts, fresh: opts["keep-data"] ? false : true }), e => `hub ${e.url} (model ${e.model}${e.seed ? `, seed ${e.seed}` : ""})\nbrowser ${e.browser?.cdp ?? e.browser?.error ?? "none"}\n${Object.keys(e.seeded).length ? `seeded ${JSON.stringify(e.seeded)}\n` : ""}state .cache/env/ (logs: .cache/env/host.log)`);
      else if (sub === "down") print(await control.envDown(opts), r => r.stopped ? `stopped ${r.url}` : "nothing running");
      else if (sub === "seeds") print(Object.keys(control.seedsFor((control.readEnv()?.appDir) ?? path.join(root, "test/fixtures/apps/notes"))), s => s.join("\n"));
      else print(await control.envInfo());
      break;
    }
    case "send": {
      const receipt = await control.send(env(), opts._.join(" "));
      if (opts.wait) print(await control.waitSettle(env(), opts)); else print(receipt, r => `admitted ${r.submissionId}`);
      break;
    }
    case "wait-settle": print(await control.waitSettle(env(), opts)); break;
    case "chat": {
      const conv = await control.conversation(env());
      print(conv, c => c.messages.filter(m => m.display !== "hidden").map(m => m.parts.map(p => p.type === "text" ? `${m.role}: ${p.text}` : p.type === "dynamic-tool" ? `  ↳ ${p.toolName}(${JSON.stringify(p.input)}) ${p.state} ${JSON.stringify(p.output ?? p.errorText ?? "")}` : "").filter(Boolean).join("\n")).join("\n"));
      break;
    }
    case "tool": { const res = await control.tool(env(), opts._[0], opts._[1] ? JSON.parse(opts._[1]) : {}); print(res.body); if (res.status !== 200) process.exitCode = 1; break; }
    case "select": print((await control.select(env(), opts._[0])).body); break;
    case "state": { const s = await control.state(env()); delete s.events; print(s); break; }
    case "log": print(await control.effectLog(env(), opts), lines => lines.join("\n")); break;
    case "trace": {
      const t = await control.trace(env(), opts._[0]);
      print(t, x => [`${x.job.id} [${x.job.kind}] ${x.job.status}${x.job.error ? `: ${x.job.error.message}` : ""}`, ...x.children.map(c => `  ${c.id} ${c.actor.id} ${c.status}${c.error ? `: ${c.error.message}` : ""}`),
        ...x.executions.flatMap(e => [`\n--- ${e.job} (${e.instance})`, ...(e.conversation?.messages ?? []).map(m => m.parts.map(p => p.type === "text" ? `${m.role}: ${p.text.slice(0, 600)}` : p.type === "dynamic-tool" ? `  ↳ ${p.toolName}(${JSON.stringify(p.input).slice(0, 300)}) ${p.state} ${JSON.stringify(p.output ?? p.errorText ?? "").slice(0, 300)}` : "").filter(Boolean).join("\n"))])].join("\n"));
      break;
    }
    case "screenshot": print(await control.screenshot(env(), opts._[0])); break;
    case "snapshot": print(await control.snapshot(env(), opts._[0])); break;
    case "click": print(await control.click(env(), opts._[0])); break;
    case "type": print(await control.type(env(), opts._[0], opts._.slice(1).join(" "))); break;
    case "press": print(await control.press(env(), opts._[0], opts.in)); break;
    case "eval": print(await control.evaluate(env(), opts._.join(" "))); break;
    case "reload": print(await control.reload(env())); break;
    case "run": {
      const { runHost } = await import("../tools/drive.mjs");
      const { child } = runHost(process.argv.slice(3), { inherit: true });
      child.on("exit", code => { process.exitCode = code ?? 0; });
      break;
    }
    case "smoke": case "e2e": case "drive": {
      const drive = await import("../tools/drive.mjs");
      const { drivers } = await import("../.agent/skills/verify-boring/drive/drivers.mjs");
      const names = opts._.length && opts._[0] !== "all" ? opts._ : Object.keys(drivers);
      let host = null, url = opts.url;
      if (!url) {
        host = drive.runHost(["--model", opts.model ?? "scripted", ...(opts["chat-bundle"] ?? process.env.BORING_CHAT_BUNDLE ? ["--chat-bundle", opts["chat-bundle"] ?? process.env.BORING_CHAT_BUNDLE] : [])]);
        url = (await host.ready).url;
        console.log(`hub ${url} (throwaway)`);
      }
      try {
        const outcome = await drive.drive(names, { ...opts, url });
        drive.printResults(outcome);
        if (outcome.results.some(r => !r.ok)) process.exitCode = 1;
      } finally { host?.child.kill("SIGTERM"); }
      break;
    }
    default:
      console.log(HELP);
      if (!["help", "--help", "-h"].includes(command)) process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
