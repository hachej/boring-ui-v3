import type { ResourceRef } from "../identity.js";
import { assertExpectedRevision, assertWriteCondition } from "../resources/resource.js";
import { fileSpace, type FileAddress, type FilesystemProvider, type RemoveInput, type WriteInput } from "../resources/filesystem/filesystem.js";
import { authorize, type Environment, type Grant, type Operation } from "./admission.js";

export { fileSpace };
export const fileGrant = (mount: string, pattern: string, operations: readonly Operation[]): Grant => ({ space: fileSpace(mount), pattern, operations });

/** The Actor receives these closures, never the provider or mutable policy. */
export function createFilesystem(provider: FilesystemProvider, environment: Environment) {
  const admit = (operation: Operation, address: FileAddress) => authorize(environment, operation, fileSpace(address.mount), address.path);
  return Object.freeze({
    environment,
    assertAllowed(operation: Operation, address: FileAddress) { admit(operation, { mount: address.mount, path: address.path }); },
    async stat(address: FileAddress) {
      const target = { mount: address.mount, path: address.path };
      admit("stat", target);
      return provider.stat(target.mount, target.path);
    },
    async read(address: FileAddress) {
      const target = { mount: address.mount, path: address.path };
      admit("read", target);
      return provider.read(target.mount, target.path);
    },
    async write(input: WriteInput) {
      input = { ...input };
      assertWriteCondition(input);
      if (typeof input.content !== "string") throw new Error("content must be text");
      const context = admit("write", input);
      // No await between admission and the synchronous provider's commit.
      const condition = input.create === true ? { create: true as const } : { expectedRevision: input.expectedRevision };
      return provider.write(input.mount, input.path, input.content, { ...condition, context });
    },
    async remove(input: RemoveInput) {
      input = { ...input };
      assertExpectedRevision(input, "remove");
      const context = admit("remove", input);
      return provider.remove(input.mount, input.path, { expectedRevision: input.expectedRevision, context });
    },
    /** Reads a Job input by reference through admission; null when the ref is not this provider's. */
    async resolve(ref: ResourceRef) {
      const address = provider.address(ref);
      if (!address) return null;
      admit("read", address);
      const result = provider.read(address.mount, address.path);
      return { ref: result.ref, content: result.content as unknown };
    }
  });
}
export type Filesystem = ReturnType<typeof createFilesystem>;
