#!/usr/bin/env node
// `boring`: the one command an agent uses to verify a change. Structure and evidence (check, lint, typecheck, test,
// model, verify), a remote control for an isolated running copy of the example app (env, doctor, send, wait-settle,
// runs, run, trace, tool, job, log, page controls), and a CI smoke built from the same controls.
// `boring --help` is the canonical command surface; every command prints JSON with --json.
// node:sqlite is experimental in Node 22; its warning is noise on every command.
const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...args) => { if (/SQLite/.test(String(warning))) return; emitWarning.call(process, warning, ...args); };
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { checkArchitecture } from "../tools/check.mjs";
import { root, runModel, toolchain } from "../tools/formal.mjs";
import { loadRegistries, verify } from "../tools/verify.mjs";

const require = createRequire(import.meta.url);
const HELP = `boring <command> [args] [--json]

Structure and evidence
  check                              package direction, laws and registries present
  lint                               oxlint (correctness and the import direction) then check
  typecheck                          the three public contracts and the example together (tsc)
  test [files...]                    the node tests (test/agent, test/chat, test/architecture by default)
  model <name>                       one bounded TLA+ model: ${Object.keys(toolchain.models).join(" | ")}
  verify [all|boring|files|agent|chat]   every registered evidence; deferrals listed, never counted as passing
  laws                               every law id with its owner and evidence (docs/LAWS.md)
  features                           the feature map index (what to drive, how a person reaches it)

Environment (one isolated copy of examples/notes per checkout: derived ports, own data dir, own headless browser)
  doctor                             toolchain, and whether the running instance is ours, answering and not STALE
  env up [--seed name] [--model fake|openrouter|openrouter/<provider>/<model>] [--keep-data] [--restart] [--no-browser]
  env info | env seeds | env down [--clean]

Act and inspect (on the environment; the wire is the app's /agent mount, identity is the app's dev auth)
  manifest                           GET /.well-known/boring.json
  send "<text>" [--wait] [--new]     a message in the conversation; the thread continues until --new
  wait-settle [--timeout s]          until no run or job is open and the records stopped moving
  chat                               the current thread as the person sees it (replayed from the wire)
  tool <agent> '<json>' [--key k] [--wait]     request one agent's run with these inputs (POST /agents/:agent/runs)
  job <name> '<json>' [--key k] [--wait]       start a job (POST /jobs/:job/start)
  cancel <run>                       POST /runs/:id/cancel
  runs [--all]                       the recorded runs, newest first
  run <id>                           a run as the wire shows it, with its events
  trace <run>                        a run's story: input, events, receipts, usage
  state                              runs by status, open runs, threads, last cursor, model
  log [--since cursor] [--run id]    everything recorded: run transitions, messages, receipts, usage

The live page (the built chat page in the environment's browser)
  screenshot [file] | snapshot [selector] | click <selector> | type <selector> <text>
  press <keys> [--in selector] | wait-for <selector> | eval <js> (read state, never to act) | reload | goto <path>

CI smoke (deterministic, fake model, throwaway instance; not a substitute for driving the feature you changed)
  smoke [--no-browser] [--evidence dir]`;

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
const sh = (bin, args, extra = {}) => { const r = spawnSync(bin, args, { cwd: root, stdio: "inherit", ...extra }); return r.status ?? 1; };
const node = (args) => sh(process.execPath, args);
const parseJson = text => { if (!text) return {}; try { return JSON.parse(text); } catch { throw new Error(`not JSON: ${text}`); } };

const controlled = ["doctor", "env", "manifest", "send", "wait-settle", "chat", "tool", "job", "cancel", "runs", "run", "trace", "state", "log", "screenshot", "snapshot", "click", "type", "press", "wait-for", "eval", "reload", "goto"];
try {
  const c = controlled.includes(command) ? await import("../tools/control.mjs") : null;
  const env = () => c.requireEnv();
  const maybeWait = async result => { if (!opts.wait) return result; return { ...result, settled: await c.waitSettle(env(), opts) }; };
  switch (command) {
    case "check": {
      loadRegistries();
      const errors = await checkArchitecture(root);
      if (errors.length) throw new Error(errors.join("\n"));
      console.log("Package architecture and evidence registry checks passed");
      break;
    }
    case "lint": {
      const status = sh(process.execPath, [path.join(path.dirname(require.resolve("oxlint/package.json")), "bin/oxlint"), "-c", ".oxlintrc.json", "."]);
      if (status !== 0) { process.exitCode = status; break; }
      loadRegistries();
      const errors = await checkArchitecture(root);
      if (errors.length) throw new Error(errors.join("\n"));
      console.log("lint: oxlint clean, import direction and registries checked");
      break;
    }
    case "typecheck": process.exitCode = node([require.resolve("typescript/bin/tsc"), "-p", "tsconfig.json"]); break;
    case "test": process.exitCode = node(["--disable-warning=ExperimentalWarning", "--test", ...(opts._.length ? opts._ : ["test/agent/*.test.ts", "test/chat/*.test.ts", "test/architecture/*.test.mjs"])]); break;
    case "verify": if (!verify(opts._[0] ?? "all")) process.exitCode = 1; break;
    case "model": { const result = runModel(opts._[0]); process.stdout.write(result.output); if (result.status !== 0) process.exitCode = 1; break; }
    case "laws": process.stdout.write(readFileSync(path.join(root, "docs/LAWS.md"), "utf8")); break;
    case "features": process.stdout.write(readFileSync(path.join(root, ".agent/skills/verify-boring/features/README.md"), "utf8")); break;
    case "doctor": {
      const rows = await c.doctor(opts);
      print(rows, r => r.map(row => `${row.ok ? "ok " : "-- "} ${row.name.padEnd(16)} ${row.detail}${row.ok ? "" : `\n     unlocks: ${row.unlocks}`}`).join("\n"));
      break;
    }
    case "env": {
      const sub = opts._[0] ?? "info";
      if (sub === "up") print(await c.envUp({ ...opts, log: m => { if (!opts.json) console.log(m); } }), e => `app ${e.url} (pid ${e.pid}, model ${e.model}${e.seed ? `, seed ${e.seed}` : ""})\nwire ${e.url}/agent as actor ${e.actor}\nbrowser ${e.browser?.cdp ?? e.browser?.error ?? "none"}\n${e.seeded?.length ? `seeded ${e.seeded.map(s => `${Object.keys(s.step)[0]} ${s.id.slice(0, 8)}`).join(", ")}\n` : ""}state ${path.relative(root, e.stateDir)}/env.json (log: ${path.relative(root, e.logFile)})`);
      else if (sub === "down") print(await c.envDown(opts), r => r.stopped ? `stopped ${r.url}` : "nothing running");
      else if (sub === "seeds") print(c.seeds(), s => Object.entries(s).map(([name, steps]) => `${name.padEnd(14)} ${steps.map(x => Object.keys(x)[0] === "say" ? `say ${JSON.stringify(x.say)}` : `${Object.keys(x)[0]} ${x.run ?? x.job}`).join("; ") || "nothing"}`).join("\n"));
      else print(await c.envInfo());
      break;
    }
    case "manifest": print(await c.manifest(env())); break;
    case "send": {
      const r = await c.send(env(), opts._.join(" "), { new: !!opts.new, key: opts.key });
      print(await maybeWait({ thread: r.thread, run: r.run.id, status: r.run.status }), x => `thread ${x.thread}\nrun ${x.run} ${x.status}${x.settled ? `\nsettled; reply: ${x.settled.reply}` : ""}`);
      break;
    }
    case "wait-settle": print(await c.waitSettle(env(), opts), s => `settled at cursor ${s.cursor}; runs ${JSON.stringify(s.runs)}; jobs ${JSON.stringify(s.jobs)}${s.latest ? `\nlatest run ${s.latest.id.slice(0, 8)} ${s.latest.agent} ${s.latest.status}${s.latest.error ? `: ${s.latest.error}` : ""}` : ""}${s.reply ? `\nreply: ${s.reply}` : ""}`); break;
    case "chat": print(await c.chat(env()), x => x.thread ? `thread ${x.thread}\n${c.renderEvents(x.events)}` : "no thread yet: boring send \"...\""); break;
    case "tool": { const r = await c.startRun(env(), opts._[0], parseJson(opts._[1]), { key: opts.key, thread: opts.thread }); print(await maybeWait(r)); break; }
    case "job": { const r = await c.startJob(env(), opts._[0], parseJson(opts._[1]), { key: opts.key, thread: opts.thread }); print(await maybeWait(r)); break; }
    case "cancel": { const r = await c.cancel(env(), opts._[0]); print(r.body); if (r.status !== 200) process.exitCode = 1; break; }
    case "runs": print(c.runs(env(), opts), rows => rows.map(r => `${r.id} ${r.agent.padEnd(10)} ${r.status.padEnd(9)} ${r.job ? `job ${r.job.slice(0, 8)} ` : ""}${r.created_at}${r.error ? `  ${r.error}` : ""}`).join("\n") || "no runs"); break;
    case "run": print(await c.run(env(), opts._[0]), x => `${JSON.stringify(x.run, null, 2)}\n${c.renderEvents(x.events)}`); break;
    case "trace": print(await c.trace(env(), opts._[0]), c.renderTrace); break;
    case "state": print(c.state(env())); break;
    case "log": print(c.log(env(), opts), lines => lines.join("\n") || "nothing recorded"); break;
    case "screenshot": print(await c.screenshot(env(), opts._[0])); break;
    case "snapshot": print(await c.snapshot(env(), opts._[0])); break;
    case "click": print(await c.click(env(), opts._[0])); break;
    case "type": print(await c.type(env(), opts._[0], opts._.slice(1).join(" "))); break;
    case "press": print(await c.press(env(), opts._[0], opts.in)); break;
    case "wait-for": print(await c.waitFor(env(), opts._[0], opts.timeout ? Number(opts.timeout) * 1000 : undefined)); break;
    case "eval": print(await c.evaluate(env(), opts._.join(" "))); break;
    case "reload": print(await c.reload(env())); break;
    case "goto": print(await c.goto(env(), opts._[0] ?? "/")); break;
    case "smoke": {
      const { smoke, printSmoke } = await import("../tools/smoke.mjs");
      const result = await smoke({ browser: opts.browser !== false, evidence: opts.evidence });
      if (opts.json) console.log(JSON.stringify(result, null, 2)); else printSmoke(result);
      if (!result.ok) process.exitCode = 1;
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
if (!existsSync(path.join(root, "package.json"))) process.exitCode = 1;
