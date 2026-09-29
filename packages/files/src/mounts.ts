/**
 * The mount table: names to providers, built by the host per actor. The router is the one place an
 * address is checked before a provider sees it: the mount must exist in the table and the path must be
 * canonical (FILES-5). A handler holds a router, never the table (AGENT-2).
 */
import { canonicalPath, isMountName } from "./address.ts";
import { FileProviderError, type FileAddress, type FileProvider } from "./index.ts";

export type MountTable = Readonly<Record<string, FileProvider>>;

export function mountRouter(mounts: MountTable): FileProvider {
  const confine = (address: FileAddress): [FileProvider, FileAddress] => {
    if (!isMountName(address.mount) || !Object.hasOwn(mounts, address.mount)) throw new FileProviderError({ code: "bad-address" }, `mount "${address.mount}" is not available`);
    return [mounts[address.mount], { mount: address.mount, path: canonicalPath(address.path) }];
  };
  return {
    async stat(address) { const [p, a] = confine(address); return p.stat(a); },
    async read(address, options) { const [p, a] = confine(address); return p.read(a, options); },
    async list(address) { const [p, a] = confine(address); return p.list(a); },
    async write(address, content, condition, effect) { const [p, a] = confine(address); return p.write(a, content, condition, effect); },
    async remove(address, expected, effect) { const [p, a] = confine(address); return p.remove(a, expected, effect); },
  };
}
