/**
 * The files contract over HTTP: `fileRoutes` is a web-standard fetch handler an application mounts beside its
 * own routes, and `httpFiles` is a FileProvider that speaks to it from a browser (or anything with fetch).
 * The same provider contract with the same meaning on both sides (BORING-3): revisions, conditions and
 * refusals cross the wire unchanged, and a refusal is the provider's FileError, never a degraded success.
 *
 * Authority stays with the host (BORING-1): the handler asks `resolve(request)` for the actor's mount table
 * and the Effect every receipt records; nothing in a request body or query names the actor or widens a mount.
 *
 *   GET  <base>/stat?path=/<mount>/<path>              → FileRef | null
 *   GET  <base>/read?path=…[&revision=…]               → { ref, content }
 *   GET  <base>/list?path=…                            → Entry[]
 *   PUT  <base>/write  { path, content, condition }    → Receipt
 *   POST <base>/remove { path, expectedRevision }      → Receipt
 *   GET  <base>/mounts                                 → { mounts: string[] }
 * A refusal answers { error: FileError, message } with 400/401/403/404/409/502.
 */
import { formatAddress, parseAddress } from "./address.ts";
import { FileProviderError, type FileError } from "./errors.ts";
import type { Effect, Entry, FileAddress, FileProvider, FileRef, Receipt, WriteCondition } from "./contract.ts";
import { mountRouter, type MountTable } from "./mounts.ts";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export type FileRoutesOptions = Readonly<{
  /** Where the routes are mounted, e.g. "/files". */
  basePath?: string;
  /** The session's mount table and the Effect its receipts carry; null answers 401. The host decides both. */
  resolve: (request: Request) => Promise<{ mounts: MountTable; effect: Effect } | null>;
}>;

const STATUS: Record<FileError["code"], number> = { conflict: 409, exists: 409, missing: 404, "bad-address": 400, readonly: 403, unavailable: 404, unverified: 502 };

const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

export function fileRoutes({ basePath = "/files", resolve }: FileRoutesOptions): { fetch(request: Request): Promise<Response> } {
  const base = basePath.replace(/\/$/, "");
  return {
    async fetch(request) {
      const url = new URL(request.url);
      if (!url.pathname.startsWith(`${base}/`)) return reply({ error: { code: "bad-address" }, message: "not a file route" }, 404);
      const route = url.pathname.slice(base.length + 1);
      const session = await resolve(request);
      if (!session) return reply({ error: { code: "readonly" }, message: "not authenticated" }, 401);
      const names = Object.keys(session.mounts);
      const files = mountRouter(session.mounts);
      try {
        if (request.method === "GET" && route === "mounts") return reply({ mounts: names });
        const body = request.method === "GET" ? {} : ((await request.json().catch(() => ({}))) as Record<string, unknown>);
        const at = (text: unknown) => parseAddress(String(text ?? ""), names);
        if (request.method === "GET" && route === "stat") return reply(await files.stat(at(url.searchParams.get("path"))));
        if (request.method === "GET" && route === "read") { const revision = url.searchParams.get("revision"); return reply(await files.read(at(url.searchParams.get("path")), revision ? { revision } : undefined)); }
        if (request.method === "GET" && route === "list") return reply(await files.list(at(url.searchParams.get("path"))));
        if (request.method === "PUT" && route === "write") {
          const condition = body.condition as Record<string, unknown> | undefined;
          // The three intentions stay distinct on the wire too (FILES-2, FILES-3): a condition is one or the other, never omitted.
          const parsed: WriteCondition | null = condition?.create === true && condition.expectedRevision === undefined ? { create: true }
            : typeof condition?.expectedRevision === "string" && condition.create === undefined ? { expectedRevision: condition.expectedRevision } : null;
          if (!parsed || typeof body.content !== "string") return reply({ error: { code: "bad-address" }, message: "write needs content and a condition: { create: true } or { expectedRevision }" }, 400);
          return reply(await files.write(at(body.path), body.content, parsed, session.effect));
        }
        if (request.method === "POST" && route === "remove") {
          if (typeof body.expectedRevision !== "string") return reply({ error: { code: "bad-address" }, message: "remove needs expectedRevision" }, 400);
          return reply(await files.remove(at(body.path), body.expectedRevision, session.effect));
        }
        return reply({ error: { code: "bad-address" }, message: `no route ${request.method} ${route}` }, 404);
      } catch (error) {
        if (error instanceof FileProviderError) return reply({ error: error.error, message: error.message }, STATUS[error.code]);
        return reply({ error: { code: "unverified" }, message: (error as Error).message }, 502);
      }
    },
  };
}

export type HttpFilesOptions = Readonly<{
  /** Where the application mounted `fileRoutes`, e.g. "/files". */
  endpoint: string;
  /** The application's fetch (its cookies, its headers). */
  fetch?: Fetch;
}>;

/**
 * A FileProvider over `fileRoutes`. The `effect` argument of write and remove is not sent: the server's host
 * attributes the receipt from the session (BORING-1). A network failure or an unreadable answer is `unverified`,
 * never a success (FILES-8).
 */
export function httpFiles({ endpoint, fetch: doFetch = (input, init) => fetch(input, init) }: HttpFilesOptions): FileProvider & { mounts(): Promise<readonly string[]> } {
  const base = endpoint.replace(/\/$/, "");
  async function call<T>(route: string, init?: RequestInit): Promise<T> {
    let response: Response;
    try { response = await doFetch(`${base}/${route}`, init); }
    catch (error) { throw new FileProviderError({ code: "unverified" }, `the file routes did not answer: ${(error as Error).message}`); }
    const text = await response.text();
    let body: unknown;
    try { body = text ? JSON.parse(text) : null; } catch { throw new FileProviderError({ code: "unverified" }, `the file routes answered ${response.status} without JSON`); }
    if (!response.ok) {
      const error = (body as { error?: FileError; message?: string } | null)?.error;
      if (error && typeof error.code === "string" && error.code in STATUS) throw new FileProviderError(error, (body as { message?: string }).message?.replace(/^[a-z-]+: /, ""));
      throw new FileProviderError({ code: "unverified" }, `the file routes answered ${response.status}`);
    }
    return body as T;
  }
  const q = (address: FileAddress, extra: Record<string, string> = {}) => new URLSearchParams({ path: formatAddress(address), ...extra }).toString();
  const send = (method: string, body: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return {
    mounts: async () => (await call<{ mounts: string[] }>("mounts")).mounts,
    stat: address => call<FileRef | null>(`stat?${q(address)}`),
    read: (address, options) => call<{ ref: FileRef; content: string }>(`read?${q(address, options?.revision ? { revision: options.revision } : {})}`),
    list: address => call<readonly Entry[]>(`list?${q(address)}`),
    write: (address, content, condition) => call<Receipt>("write", send("PUT", { path: formatAddress(address), content, condition })),
    remove: (address, expectedRevision) => call<Receipt>("remove", send("POST", { path: formatAddress(address), expectedRevision })),
  };
}
