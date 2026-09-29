# Wire

The HTTP mount an application exposes (`/agent` in the example): the rules every endpoint obeys before any feature. Identity from the host on every request, ownership, admission, validation, idempotency, one error shape. Contract: [packages/agent/CONTRACT.md](../../../../packages/agent/CONTRACT.md). Laws: BORING-1, AGENT-8, AGENT-11, CHAT-4.

## Sub-features

- identity: `Host.resolveActor(request)` names the actor; nothing in a body does. The example's dev host reads `x-dev-actor` (its own auth) and the server fills `dev` when absent.
- ownership: an actor sees only their own threads, runs and jobs; anything else, and any unknown id, is 404.
- admission: `Host.mayRequest` answering no is 403 (the example host always admits).
- validation: a non-object body, a missing `text`, inputs `buildMessage` refuses, an empty or undeclared job plan: 400.
- idempotency: `idempotencyKey` recorded once per actor and key: same body returns the recorded run, job or message; another body is 409.
- errors: always `{ error, status }`.
- events: NDJSON with a monotonic `cursor`; `?cursor=` replays strictly after; a run's stream ends at its terminal event; a thread's stays live unless `live=0`.

## How to get to it (user POV)

A client codes against the contract; the chat page is one such client. A person meets the wire only through a page.

## Driving it with boring

```bash
node bin/boring.mjs tool summarise '{"note":"Buy milk tomorrow."}' --key j1 --wait     # 202, a run
node bin/boring.mjs tool summarise '{"note":"Buy milk tomorrow."}' --key j1            # the same id
node bin/boring.mjs tool summarise '{"note":"Other."}' --key j1                        # 409: "idempotency key \"j1\" was used with a different request"
node bin/boring.mjs job digest '{"notes":[]}'                                          # 400: at least one note
U=$(node bin/boring.mjs env info --json | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).url))')
curl -s -o /dev/null -w "%{http_code}\n" -H "x-dev-actor: other" $U/agent/runs/<id>      # 404: another actor
curl -s -H "x-dev-actor: other" $U/agent/threads/<thread>                                # 404
curl -s -X POST -H "content-type: application/json" -d 'not json' $U/agent/agents/summarise/runs   # 400: the body must be a JSON object
curl -s "$U/agent/threads/<thread>/events?cursor=2&live=0"                               # replay strictly after cursor 2
```

- Unauthenticated (401) is not reachable through the example server, which always fills a dev actor; `test/agent/wire.test.ts` covers it with a host that answers null.
- Admission refused (403) is not reachable with the example host; `test/agent/host.test.ts` covers it.

## Gotchas

- `--key` binds actor, target and body: the same key on another agent or another `thread` is another body, so 409, not a reuse.
- A run's `/events` stream stays open while the run is live; `boring run <id>` reads the thread replay instead, so it works on a running run too.
- The example server answers the built page at `/` and the wire at `/agent/`; a 404 text "build the page first" means `env up` did not build (`doctor` shows the page row).
