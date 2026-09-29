/**
 * A GitHub repository at a ref as a mount, over the REST API. Reads resolve at the ref; the revision of a
 * file is `<blob sha>.<commit sha>`: the blob is what GitHub itself compares on a write (the far side
 * enforces FILES-2 and FILES-4 checks, FILES-8), the commit keeps a recreate distinct from what it
 * replaced. A pinned ref (a 40-hex commit) is read-only; writes need a branch and `write` enabled.
 * The token is asked of the host for each request and never kept in a field (AGENT-7).
 */
import { FileProviderError } from "./errors.ts";
import type { Effect, Entry, FileAddress, FileProvider, FileRef, ReadOptions, Receipt, WriteCondition } from "./index.ts";
import type { ReceiptLog } from "./receipts.ts";

export type GithubProviderOptions = Readonly<{
  owner: string;
  repo: string;
  /** A branch, a tag or a commit sha. Default "main". */
  ref?: string;
  /** Asked for every request; the provider stores nothing. Omit for a public repository. */
  auth?: () => string | Promise<string> | undefined;
  /** Enables commits on the branch `ref`. Without it, every mutation is `readonly`. */
  write?: Readonly<{ message?: (effect: Effect, address: FileAddress) => string; committer?: Readonly<{ name: string; email: string }> }>;
  receipts?: ReceiptLog;
  /** The API base (tests point it at a fake). Default https://api.github.com. */
  api?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}>;

const SHA = /^[0-9a-f]{40}$/;
const encode = (text: string) => Buffer.from(text, "utf8").toString("base64");
const decode = (base64: string) => Buffer.from(base64.replace(/\n/g, ""), "base64").toString("utf8");

export function githubProvider(options: GithubProviderOptions): FileProvider {
  const { owner, repo } = options;
  const ref = options.ref ?? "main";
  const pinned = SHA.test(ref);
  const api = (options.api ?? "https://api.github.com").replace(/\/$/, "");
  const doFetch = options.fetch ?? ((input, init) => fetch(input, init));
  const base = `${api}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const id = (path: string) => `github:${owner}/${repo}@${ref}:${path}`;
  const split = (revision: string) => { const [blob, commit] = revision.split("."); return { blob, commit }; };

  async function call(method: string, route: string, body?: unknown): Promise<{ status: number; json: any }> {
    const headers: Record<string, string> = { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28" };
    const token = await options.auth?.();
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";
    let response: Response;
    try { response = await doFetch(`${base}${route}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }); }
    catch (error) { throw new FileProviderError({ code: "unverified" }, `GitHub unreachable: ${(error as Error).message}`); }
    const text = await response.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = null; }
    return { status: response.status, json };
  }
  const contentsRoute = (path: string, query = "") => `/contents/${path.split("/").map(encodeURIComponent).join("/")}${query}`;

  /** The commit the ref points at now (the ref itself when pinned). */
  async function head(): Promise<string> {
    if (pinned) return ref;
    const { status, json } = await call("GET", `/commits/${encodeURIComponent(ref)}`);
    if (status !== 200 || typeof json?.sha !== "string") throw new FileProviderError({ code: "unverified" }, `cannot resolve ref ${ref} (${status})`);
    return json.sha;
  }
  async function contents(path: string): Promise<{ commit: string; entry: any } | null> {
    const commit = await head();
    const { status, json } = await call("GET", contentsRoute(path, `?ref=${encodeURIComponent(commit)}`));
    if (status === 404) return null;
    if (status !== 200) throw new FileProviderError({ code: "unverified" }, `GitHub answered ${status} for ${path}`);
    return { commit, entry: json };
  }
  async function blob(sha: string): Promise<string> {
    const { status, json } = await call("GET", `/git/blobs/${sha}`);
    if (status !== 200 || typeof json?.content !== "string") throw new FileProviderError({ code: "unavailable", requested: sha, current: null }, `blob ${sha} is unavailable (${status})`);
    return decode(json.content);
  }
  const receipt = (address: FileAddress, before: string | null, after: string | null, effect: Effect): Receipt => {
    const row: Receipt = { address, id: id(address.path), before, after, effect, at: new Date().toISOString() };
    options.receipts?.record(row);
    return row;
  };
  const writable = (address: FileAddress) => {
    if (!options.write || pinned) throw new FileProviderError({ code: "readonly" }, `${address.mount} (${owner}/${repo}@${ref}) is read-only`);
  };
  const message = (effect: Effect, address: FileAddress, verb: string) => options.write?.message?.(effect, address) ?? `${verb} ${address.path} (boring run ${effect.run ?? "-"}, actor ${effect.actor})`;
  const fileRef = (address: FileAddress, entry: any, commit: string): FileRef => ({ id: id(address.path), revision: `${entry.sha}.${commit}` });

  return {
    async stat(address) {
      const found = await contents(address.path);
      return found && found.entry?.type === "file" ? fileRef(address, found.entry, found.commit) : null;
    },
    async read(address, readOptions: ReadOptions = {}) {
      if (readOptions.revision !== undefined) {
        const { blob: sha } = split(readOptions.revision);
        if (!SHA.test(sha ?? "")) throw new FileProviderError({ code: "unavailable", requested: readOptions.revision, current: null }, "not a GitHub revision");
        return { ref: { id: id(address.path), revision: readOptions.revision }, content: await blob(sha) };
      }
      const found = await contents(address.path);
      if (!found || found.entry?.type !== "file") throw new FileProviderError({ code: "missing" }, address.path);
      const content = found.entry.encoding === "base64" && typeof found.entry.content === "string" && found.entry.content !== "" ? decode(found.entry.content) : await blob(found.entry.sha);
      return { ref: fileRef(address, found.entry, found.commit), content };
    },
    async list(address) {
      const found = await contents(address.path);
      if (!found || !Array.isArray(found.entry)) throw new FileProviderError({ code: "missing" }, address.path || "/");
      const entries: Entry[] = found.entry.filter((e: any) => e.type === "file" || e.type === "dir").map((e: any) => (
        e.type === "dir" ? { path: e.path, kind: "dir" as const } : { path: e.path, kind: "file" as const, ref: { id: id(e.path), revision: `${e.sha}.${found.commit}` } }));
      return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    },
    async write(address, content, condition: WriteCondition, effect) {
      writable(address);
      if (!address.path) throw new FileProviderError({ code: "bad-address" }, "the mount root is not a file");
      const body: Record<string, unknown> = { message: message(effect, address, "create" in condition ? "Create" : "Update"), content: encode(content), branch: ref, ...(options.write?.committer ? { committer: options.write.committer } : {}) };
      if ("expectedRevision" in condition) {
        const { blob: sha } = split(condition.expectedRevision);
        if (!SHA.test(sha ?? "")) throw new FileProviderError({ code: "conflict", current: (await this.stat(address))?.revision ?? null }, `${condition.expectedRevision} is not a GitHub revision`);
        body.sha = sha;
      }
      const { status, json } = await call("PUT", contentsRoute(address.path), body);
      if (status === 409 || (status === 422 && "expectedRevision" in condition && !json?.message?.includes('"sha" wasn\'t supplied'))) {
        const current = await this.stat(address);
        if ("expectedRevision" in condition && !current) throw new FileProviderError({ code: "missing" }, address.path);
        throw new FileProviderError({ code: "conflict", current: current?.revision ?? null }, `${address.path} changed on GitHub`);
      }
      if (status === 422 && "create" in condition) throw new FileProviderError({ code: "exists" }, address.path);
      if (status === 404 && "expectedRevision" in condition) throw new FileProviderError({ code: "missing" }, address.path);
      if ((status !== 200 && status !== 201) || typeof json?.content?.sha !== "string" || typeof json?.commit?.sha !== "string") throw new FileProviderError({ code: "unverified" }, `GitHub answered ${status} without a verified commit`);
      return receipt(address, "expectedRevision" in condition ? condition.expectedRevision : null, `${json.content.sha}.${json.commit.sha}`, effect);
    },
    async remove(address, expectedRevision, effect) {
      writable(address);
      const { blob: sha } = split(expectedRevision);
      if (!SHA.test(sha ?? "")) throw new FileProviderError({ code: "conflict", current: (await this.stat(address))?.revision ?? null }, `${expectedRevision} is not a GitHub revision`);
      const { status, json } = await call("DELETE", contentsRoute(address.path), { message: message(effect, address, "Remove"), sha, branch: ref, ...(options.write?.committer ? { committer: options.write.committer } : {}) });
      if (status === 404) throw new FileProviderError({ code: "missing" }, address.path);
      if (status === 409 || status === 422) { const current = await this.stat(address); throw new FileProviderError({ code: "conflict", current: current?.revision ?? null }, `${address.path} changed on GitHub`); }
      if (status !== 200 || typeof json?.commit?.sha !== "string") throw new FileProviderError({ code: "unverified" }, `GitHub answered ${status} without a verified commit`);
      return receipt(address, expectedRevision, null, effect);
    },
  };
}
