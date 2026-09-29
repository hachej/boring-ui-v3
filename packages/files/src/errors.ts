/** A provider that cannot honour a condition or a receipt says so with this error, never with a success (FILES-8). */
export type FileError =
  | { code: "conflict"; current: string | null }
  | { code: "exists" }
  | { code: "missing" }
  | { code: "bad-address" }
  | { code: "readonly" }
  | { code: "unavailable"; requested: string; current: string | null }
  | { code: "unverified" };

export class FileProviderError extends Error {
  readonly error: FileError;
  constructor(error: FileError, detail?: string) {
    super(detail ? `${error.code}: ${detail}` : error.code);
    this.error = error;
  }
  get code(): FileError["code"] { return this.error.code; }
}

export const isFileError = (value: unknown, code?: FileError["code"]): value is FileProviderError =>
  value instanceof FileProviderError && (code === undefined || value.code === code);
