# Manifest

`GET /agent/.well-known/boring.json`: what the app's agents, jobs and conversations are, with JSON-schema inputs a client can build a form from, and the routes to invoke them. Public: no actor needed. Never a credential, a prompt or a record. Laws: AGENT-7, BORING-4 (a client discovers, it does not own).

## Sub-features

- agents: name, title, model, output kind (`tool` | `markdown`), `inputs` schema, `outputs` (the output tool's schema, or a description map), declared helper tools, `invoke`.
- jobs: name, `children` (the agents the job may start), `inputs`, `outputs`, `invoke`.
- conversations: name, the agent behind it, `inputs`, `invoke`.
- endpoints: the route table clients code against.

## How to get to it (user POV)

A client (the hub, a form builder) fetches the manifest once and builds its calls from `invoke` and `inputs`. A person never sees it; the page does not read it.

## Driving it with boring

```bash
node bin/boring.mjs manifest                              # the whole document
node bin/boring.mjs manifest --json | node -e '...'       # pick agents[].inputs, jobs[].children
curl -s $(node bin/boring.mjs env info --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).url))')/agent/.well-known/boring.json
```

Observed on the example: `agents` = `answer` (markdown, inputs `text` required + `notes`), `summarise` (tool, `inputs.note` required, `outputs.schema` of `summary_save`, tools `[lookup]`); `jobs[0]` = `digest` with `children: ["summarise"]`; `conversations[0]` = `questions` over `answer`.

- Credential path: grep the manifest for the key you started the app with (`--model openrouter/...`): it must not appear (AGENT-7; `test/agent/credentials.test.ts` covers the records too).
- Definition change: edit an `agent.md` front matter, `env up --restart`, read the manifest again; a bad front matter fails the start with the file and field named in `.cache/env/server.log`.

## Gotchas

- The manifest reflects definitions loaded at start. A change to `agents/` needs `env up --restart` (doctor says STALE).
- `model` is the definition's default; the app may run another (`--model` overrides every agent, and `run.model` says what ran).
