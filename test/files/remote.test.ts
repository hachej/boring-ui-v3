import test from "node:test";
import assert from "node:assert/strict";
import { githubProvider, isFileError, memoryReceipts } from "@boring/files";
import { fakeGithub } from "./fake-github.ts";

const at = (p: string) => ({ mount: "mnt/repo", path: p });
const effect = { actor: "ana", run: "r1", tool: "write_file" };

test("FILES-8: the far side decides conflicts; a write GitHub refuses is a conflict here, and a success without a commit is unverified", async () => {
  const github = fakeGithub({ "a.md": "one" });
  const receipts = memoryReceipts();
  const provider = githubProvider({ owner: "o", repo: "r", write: {}, receipts, api: "https://api.test", fetch: github.fetch });
  const rev = (await provider.stat(at("a.md")))!.revision;
  // Someone else commits on GitHub between the read and the write.
  await github.fetch("https://api.test/repos/o/r/contents/a.md", { method: "PUT", body: JSON.stringify({ message: "m", content: Buffer.from("two").toString("base64"), sha: rev.split(".")[0] }) });
  const conflict = await provider.write(at("a.md"), "three", { expectedRevision: rev }, effect).then(() => null, e => e);
  assert.ok(isFileError(conflict, "conflict"));
  assert.equal((conflict.error as { current: string | null }).current, (await provider.stat(at("a.md")))!.revision);
  assert.equal(receipts.entries.length, 0);
  // A network failure after the request: the provider reports unverified, never success.
  const flaky = githubProvider({ owner: "o", repo: "r", write: {}, receipts, api: "https://api.test", fetch: async (input, init) => init?.method === "PUT" ? new Response("", { status: 200 }) : github.fetch(input, init) });
  const current = (await flaky.stat(at("a.md")))!.revision;
  await assert.rejects(flaky.write(at("a.md"), "four", { expectedRevision: current }, effect), e => isFileError(e, "unverified"));
  const down = githubProvider({ owner: "o", repo: "r", api: "https://api.test", fetch: async () => { throw new Error("ECONNRESET"); } });
  await assert.rejects(down.read(at("a.md")), e => isFileError(e, "unverified"));
  assert.equal(receipts.entries.length, 0);
});

test("FILES-8 / AGENT-7: the token is asked per request and stored nowhere; a pinned ref or no write option is read-only", async () => {
  const github = fakeGithub({ "a.md": "one" }, { token: "secret-token" });
  let asked = 0;
  const provider = githubProvider({ owner: "o", repo: "r", auth: () => { asked++; return "secret-token"; }, api: "https://api.test", fetch: github.fetch });
  assert.equal((await provider.read(at("a.md"))).content, "one");
  assert.ok(asked >= 1);
  assert.ok(!JSON.stringify(provider).includes("secret-token"));
  assert.ok(!Object.values(provider).some(v => typeof v === "string" && v.includes("secret")));
  await assert.rejects(provider.write(at("a.md"), "x", { create: true }, effect), e => isFileError(e, "readonly"));
  const pinned = githubProvider({ owner: "o", repo: "r", ref: github.head(), auth: () => "secret-token", write: {}, api: "https://api.test", fetch: github.fetch });
  assert.equal((await pinned.read(at("a.md"))).content, "one");
  await assert.rejects(pinned.write(at("a.md"), "x", { create: true }, effect), e => isFileError(e, "readonly"));
  const wrong = githubProvider({ owner: "o", repo: "r", auth: () => "wrong", api: "https://api.test", fetch: github.fetch });
  const failure = await wrong.read(at("a.md")).then(() => null, e => e);
  assert.ok(isFileError(failure, "unverified"));
  assert.ok(!String(failure.message).includes("wrong"), "the error names no credential");
});

test("github: reads resolve at the ref's commit and a pinned revision reads the blob exactly", async () => {
  const github = fakeGithub({ "src/a.ts": "v1", "src/lib/b.ts": "b" });
  const provider = githubProvider({ owner: "o", repo: "r", write: {}, api: "https://api.test", fetch: github.fetch });
  const first = await provider.read(at("src/a.ts"));
  assert.deepEqual((await provider.list(at("src"))).map(e => [e.path, e.kind]), [["src/a.ts", "file"], ["src/lib", "dir"]]);
  const receipt = await provider.write(at("src/a.ts"), "v2", { expectedRevision: first.ref.revision }, effect);
  assert.equal(receipt.after!.split(".")[1], github.head(), "the revision names the commit that carried it");
  assert.equal((await provider.read(at("src/a.ts"), { revision: first.ref.revision })).content, "v1");
  assert.equal((await provider.read(at("src/a.ts"))).content, "v2");
  assert.ok(github.calls.every(c => c.url.includes("ref=") ? /ref=[0-9a-f]{40}/.test(c.url) : true), "content reads are pinned to a commit, never to a moving branch name");
});
