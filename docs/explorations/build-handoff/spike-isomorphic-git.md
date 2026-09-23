# Spike: git as the version store, inside a Durable Object

Branch `spike/isomorphic-git`, worktree `.worktrees/spike-git`, base `d07b729`,
run on 2026-09-22 under `wrangler dev --local` (workerd), Node 22, isomorphic-git 1.42.2.
Code in `spike/isomorphic-git/`. Remote used: the private repository
`hachej/boring-app-spike-git`, created for this spike and left in place as evidence.

## Question

Can the hub keep each app's version history as a real git repository inside the
app's own SQLite-backed Durable Object, push it to GitHub and fetch commits made
there, so that a build handoff is a push and a fetch rather than a second
history system? (Design: the Supervised Build Handoff page, version 4.)

## What was built

- `sql-fs.js`: an `fs.promises` implementation over `ctx.storage.sql`, one row per
  file or directory, exactly the ten calls isomorphic-git needs. About 150 lines.
  No LightningFS, no superblock: the DO's SQLite is the filesystem.
- `index.js`: one DO class `GitRepo` with routes `import` (one commit and one tag
  per version), `log`, `diff`, `push`, `fetch`, `reset`.
- `wrangler.jsonc`: `nodejs_compat` on (isomorphic-git needs `Buffer`), a
  SQLite-backed DO class, `limits.cpu_ms` 30000.
- Fixture: the sixteen real versions of `apps/fitness` from this repository's
  history (169 files, 1,960 KB of text in total), plus thirty synthetic
  « chat small fix » versions on top (two files changed each).

## Results

Times are measured from the client with curl; inside a DO, timers only advance
on I/O, so the DO's own clock is not usable for CPU. Storage is the `fs` table.

| Operation | Result | Time | Storage after |
|---|---|---|---|
| Import 16 real versions (commit + tag each) | 16 commits, 16 tags | 2.1 s total, 47 to 100 ms per version | 240 rows, 415 KB (raw text was 1,960 KB: 4.7× smaller through blob dedup) |
| `log` on main | 16 commits | 18 ms | — |
| `diff v3..v4` (tree walk) | 1 changed path | 13 ms | — |
| Push main + 16 tags to GitHub | ok, 17 pushes | 25.4 s total, about 1.5 s per push (network round trips; one push per ref is isomorphic-git's model) | — |
| Commit on GitHub from outside (contents API), then `fetch` + fast-forward main + read a file from the fetched tree | 1 new commit landed, README content read from the new tree | 1.0 s | 245 rows, 407 KB |
| Import 30 synthetic versions on top | 30 commits | 5.5 s total, 78 / 145 / 389 ms min / avg / max per version | 543 rows, 736 KB |
| `log` at 47 commits | 47 commits | 20 ms | — |
| Push main alone with 30 new commits | ok | 1.9 s | — |
| Restart workerd, `log` | 47 commits, same storage | — | 543 rows, 736 KB |

Bundle: the worker with isomorphic-git is 635 KB raw, 127 KB gzipped.

## What this settles

- **It works in our runtime.** Init, commit, tag, log, diff, push and fetch all
  run inside a SQLite-backed DO under workerd with `nodejs_compat`, the flag the
  agent-flue worker already carries (and celld honours). The app-runner worker
  would need the flag added.
- **CPU is not a concern at our sizes.** A publish (commit + tag) costs well
  under 200 ms of DO time on a nine-file app with a 44 KB HTML page. Log and
  diff are tens of milliseconds at 47 commits. Nothing came near the 30 s limit.
- **Storage shrinks.** Git's content addressing stores each unchanged file once;
  the versions table today stores the full tree per version.
- **Push cost is one round trip per ref.** A publish that pushes main and one tag
  is about 3 s of wall time, all network, and belongs in `waitUntil` after the
  version row is written, never on the publish path itself (the page's
  « a publish never fails because git failed » rule).
- **Fetch of an outside commit is one second**, and reading the tree of the fetched
  commit is a plain `readBlob`: that is the « publish from outside » path.
- **The repository survives restarts** because it lives in the DO's SQLite.

## Caveats found

- isomorphic-git's `fetch` needs a remote entry in the repository config
  (`addRemote` once); without it, `NoRefspecError`.
- Pushing tags is one push per tag. For a first export of a long history, push
  main first, then tags in the background; or skip tags and keep the version
  number in the commit message only.
- `performance.now()` and `Date.now()` inside the DO do not measure CPU; time
  from the outside.
- Not measured: a working tree with binary assets (apps today publish text
  only), a history in the thousands of commits, and packfile size on a fetch of
  many commits at once. None of those is on the near path.

## Recommendation

Go. Replace piece P3 of the handoff page with « git is the version store »:
blobs, trees, commits and tags in the app's DO through isomorphic-git over the
SQL filesystem; `refs/hub/current` and `refs/hub/previous` as the pointer the
hub already keeps; publish, activate, rollback, versions and files keep their
routes; the remote is the option, created by the hub and pushed after each
publish; a build handoff is a branch push and a merge fetch.

## Re-running

```
cd spike/isomorphic-git && npm install
python3 make-fixtures.py               # writes fixture-versions.json and fixture-extra.json from git history
~/.bun/bin/wrangler dev --port 8799 --local
curl -X POST localhost:8799/import -H 'content-type: application/json' --data-binary @fixture-versions.json
curl localhost:8799/log
curl -X POST localhost:8799/push  -H 'content-type: application/json' -d '{"url":"https://github.com/<owner>/<repo>.git","token":"<token>"}'
curl -X POST localhost:8799/fetch -H 'content-type: application/json' -d '{"url":"https://github.com/<owner>/<repo>.git","token":"<token>"}'
```
