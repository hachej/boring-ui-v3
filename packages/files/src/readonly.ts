/** A provider that refuses every mutation (FILES-8): a declared limit enforced at the effect path, not described in metadata. */
import { FileProviderError } from "./errors.ts";
import type { FileProvider } from "./contract.ts";

export function readonly(provider: FileProvider): FileProvider {
  return {
    stat: address => provider.stat(address),
    read: (address, options) => provider.read(address, options),
    list: address => provider.list(address),
    write: async address => { throw new FileProviderError({ code: "readonly" }, `${address.mount} is read-only`); },
    remove: async address => { throw new FileProviderError({ code: "readonly" }, `${address.mount} is read-only`); },
  };
}
