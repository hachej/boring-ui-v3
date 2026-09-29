/**
 * The subset of the GitHub REST API the provider uses, over an in-memory repository: commits/{ref},
 * contents (GET, PUT, DELETE), git/blobs/{sha}. It enforces what GitHub enforces on the far side:
 * a PUT with a stale sha is 409, a create over an existing file is 422, a DELETE with a stale sha is 409.
 */
import { createHash } from "node:crypto";

const sha = (text: string) => createHash("sha1").update(text).digest("hex");

export function fakeGithub(seed: Record<string, string> = {}, options: { token?: string; branch?: string } = {}) {
  const branch = options.branch ?? "main";
  const files = new Map<string, { blob: string; content: string }>();
  const blobs = new Map<string, string>();
  const put = (path: string, content: string) => { const blob = sha(`blob ${content.length}\0${content}`); files.set(path, { blob, content }); blobs.set(blob, content); return blob; };
  for (const [path, content] of Object.entries(seed)) put(path, content);
  let commits = 0;
  let head = sha(`commit ${commits}`);
  const commit = () => { head = sha(`commit ${++commits}`); return head; };
  const calls: { method: string; url: string; auth: string | null }[] = [];
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  const fetch = async (input: string, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(input);
    const method = (init.method ?? "GET").toUpperCase();
    const headers = new Headers(init.headers);
    calls.push({ method, url: url.pathname + url.search, auth: headers.get("authorization") });
    if (options.token && headers.get("authorization") !== `Bearer ${options.token}`) return json(401, { message: "Bad credentials" });
    const m = /^\/repos\/[^/]+\/[^/]+\/(.*)$/.exec(url.pathname);
    if (!m) return json(404, { message: "Not Found" });
    const route = decodeURIComponent(m[1]);
    if (route.startsWith("commits/")) { const ref = route.slice(8); return ref === branch || ref === head ? json(200, { sha: head }) : json(422, { message: "No commit found" }); }
    if (route.startsWith("git/blobs/")) { const content = blobs.get(route.slice(10)); return content === undefined ? json(404, { message: "Not Found" }) : json(200, { sha: route.slice(10), content: Buffer.from(content).toString("base64"), encoding: "base64" }); }
    if (route.startsWith("contents")) {
      const path = route.slice("contents".length).replace(/^\//, "");
      const body = init.body ? JSON.parse(String(init.body)) : {};
      if (method === "GET") {
        const file = files.get(path);
        if (file) return json(200, { type: "file", path, sha: file.blob, content: Buffer.from(file.content).toString("base64"), encoding: "base64", size: file.content.length });
        const prefix = path ? `${path}/` : "";
        const seen = new Map<string, unknown>();
        for (const [p, f] of files) {
          if (!p.startsWith(prefix)) continue;
          const rest = p.slice(prefix.length), slash = rest.indexOf("/");
          if (slash < 0) seen.set(rest, { type: "file", name: rest, path: p, sha: f.blob });
          else if (!seen.has(rest.slice(0, slash))) seen.set(rest.slice(0, slash), { type: "dir", name: rest.slice(0, slash), path: `${prefix}${rest.slice(0, slash)}` });
        }
        if (!seen.size && path) return json(404, { message: "Not Found" });
        return json(200, [...seen.values()]);
      }
      if (method === "PUT") {
        const current = files.get(path);
        if (typeof body.content !== "string" || typeof body.message !== "string") return json(422, { message: "Invalid request" });
        if (body.sha === undefined && current) return json(422, { message: 'Invalid request.\n\n"sha" wasn\'t supplied.' });
        if (body.sha !== undefined && (!current || current.blob !== body.sha)) return json(409, { message: `${path} does not match ${body.sha}` });
        const blob = put(path, Buffer.from(body.content, "base64").toString("utf8"));
        return json(current ? 200 : 201, { content: { path, sha: blob }, commit: { sha: commit() } });
      }
      if (method === "DELETE") {
        const current = files.get(path);
        if (!current) return json(404, { message: "Not Found" });
        if (current.blob !== body.sha) return json(409, { message: `${path} does not match ${body.sha}` });
        files.delete(path);
        return json(200, { content: null, commit: { sha: commit() } });
      }
    }
    return json(404, { message: "Not Found" });
  };
  return { fetch, calls, files, head: () => head, branch };
}
