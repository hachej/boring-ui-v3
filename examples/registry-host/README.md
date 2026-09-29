# registry-host

An application assembled from the [Boring UI registry](../../registry/README.md). Everything under `src/components/` was installed with `npx shadcn add` (`node bin/boring.mjs registry install` does it from a local build, and CI does it again and diffs); `src/index.css` is the app's own theme ("moss"), `src/App.tsx` its layout. The server mounts the agent's wire under `/agent`, the file routes under `/files` (`/code` is this folder's `code/`, read-only; `/workspace` is the person's, in memory, seeded from `seed/`), and a scripted assistant ([script.mjs](script.mjs)) that drives the viewers' tools.

```bash
node bin/boring.mjs env up --example registry-host     # build, run, headless browser; see .agent/skills/verify-boring/features/registry.md
npx vite build examples/registry-host && node examples/registry-host/server.mjs   # or by hand, on :8790
node --test test/registry/round-trip.test.ts           # agent write, page read and tree at one revision (FILES-6)
node --test test/registry/browser.test.ts              # the journey in Chromium; screenshots in .cache/evidence/registry/
```

Ask the assistant: "open /workspace/notes/plan.md", "name a risk in my plan" (a proposal you accept), "apply a risk" (a direct edit at the revision read), "go to Notes", "write a note" (the tree shows it), "zoom the image", "read the code", "list my notes".

What to read: [host.mjs](host.mjs) (mounts, allowed tools, file routes attributed by the session), [agents/assistant/agent.md](agents/assistant/agent.md) (the viewers' tools under `ui:`), [src/App.tsx](src/App.tsx) (one `agent` binding handed to every item).
