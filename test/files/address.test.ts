import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import { attachedMount, canonicalPath, directoryProvider, formatAddress, isFileError, memoryProvider, mountRouter, parseAddress, readonly } from "@boring/files";

test("FILES-5: canonicalisation refuses traversal, encoding and aliases and keeps one spelling", () => {
  assert.equal(canonicalPath("notes/a.md"), "notes/a.md");
  assert.equal(canonicalPath("/notes//a.md/"), "notes/a.md");
  assert.equal(canonicalPath(""), "");
  assert.equal(canonicalPath("é/ü.md"), "é/ü.md".normalize("NFC"));
  for (const bad of ["../x", "a/../x", "a/./x", "..", "%2e%2e/x", "a\\b", "a:b", "a\u0000b", " a", "a "]) {
    assert.throws(() => canonicalPath(bad), e => isFileError(e, "bad-address"), `should refuse ${JSON.stringify(bad)}`);
  }
});

test("FILES-5: /mount/path parsing picks a known mount, the longest one, and refuses unknown mounts", () => {
  const mounts = ["code", "workspace", "mnt/repo"];
  assert.deepEqual(parseAddress("/workspace/notes/a.md", mounts), { mount: "workspace", path: "notes/a.md" });
  assert.deepEqual(parseAddress("/mnt/repo/src/x.ts", mounts), { mount: "mnt/repo", path: "src/x.ts" });
  assert.deepEqual(parseAddress("/code", mounts), { mount: "code", path: "" });
  assert.equal(formatAddress({ mount: "mnt/repo", path: "src/x.ts" }), "/mnt/repo/src/x.ts");
  assert.equal(attachedMount("repo"), "mnt/repo");
  for (const bad of ["workspace/a.md", "/mnt/other/x", "/shared/x", "/workspace/../code/x"]) assert.throws(() => parseAddress(bad, mounts), e => isFileError(e, "bad-address"), bad);
  assert.throws(() => attachedMount("../x"), e => isFileError(e, "bad-address"));
});

test("FILES-5: the router confines an address to its mount before any provider call", async () => {
  let calls = 0;
  const counting = (p: ReturnType<typeof memoryProvider>) => ({ ...p, read: (a: any, o: any) => { calls++; return p.read(a, o); } });
  const router = mountRouter({ workspace: counting(memoryProvider({ seed: { "a.md": "a" } })), code: readonly(memoryProvider({ seed: { "x.ts": "x" } })) });
  assert.equal((await router.read({ mount: "workspace", path: "/a.md" })).content, "a");
  await assert.rejects(router.read({ mount: "workspace", path: "../code/x.ts" }), e => isFileError(e, "bad-address"));
  await assert.rejects(router.read({ mount: "other", path: "a.md" }), e => isFileError(e, "bad-address"));
  await assert.rejects(router.read({ mount: "../workspace", path: "a.md" }), e => isFileError(e, "bad-address"));
  assert.equal(calls, 1, "refused addresses never reach the provider");
  await assert.rejects(router.write({ mount: "code", path: "x.ts" }, "y", { create: true }, { actor: "a" }), e => isFileError(e, "readonly"));
});

test("FILES-5: a directory mount refuses symlinks that would leave it", async () => {
  const base = mkdtempSync(path.join(path.resolve(import.meta.dirname, "../../.cache"), "files-sym-"));
  const root = path.join(base, "root"), outside = path.join(base, "outside");
  mkdirSync(root); mkdirSync(outside);
  writeFileSync(path.join(outside, "secret.txt"), "s");
  symlinkSync(outside, path.join(root, "link"));
  symlinkSync(path.join(outside, "secret.txt"), path.join(root, "file-link"));
  const provider = directoryProvider({ root });
  await assert.rejects(provider.read({ mount: "workspace", path: "link/secret.txt" }), e => isFileError(e, "bad-address"));
  await assert.rejects(provider.read({ mount: "workspace", path: "file-link" }), e => isFileError(e, "bad-address"));
  await assert.rejects(provider.write({ mount: "workspace", path: "link/new.txt" }, "x", { create: true }, { actor: "a" }), e => isFileError(e, "bad-address"));
  assert.deepEqual((await provider.list({ mount: "workspace", path: "" })).map(e => e.path), [], "symlinks are not listed");
});
