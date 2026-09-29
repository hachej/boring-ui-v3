import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { directoryProvider, githubProvider, memoryProvider } from "@boring/files";
import { conformance } from "./suite.ts";
import { fakeGithub } from "./fake-github.ts";

const cache = path.resolve(import.meta.dirname, "../../.cache");
mkdirSync(cache, { recursive: true });

conformance("memory", ({ seed, receipts }) => memoryProvider({ seed, receipts }));

conformance("directory", ({ seed, receipts }) => {
  const root = mkdtempSync(path.join(cache, "files-dir-"));
  process.on("exit", () => rmSync(root, { recursive: true, force: true }));
  for (const [p, c] of Object.entries(seed)) { mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); writeFileSync(path.join(root, p), c); }
  return directoryProvider({ root, receipts });
}, { history: false });

conformance("github", ({ seed, receipts }) => {
  const github = fakeGithub(seed, { token: "t0k3n" });
  return githubProvider({ owner: "acme", repo: "app", ref: "main", auth: () => "t0k3n", write: {}, receipts, api: "https://api.test", fetch: github.fetch });
});
