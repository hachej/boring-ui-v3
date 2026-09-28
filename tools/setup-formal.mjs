import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { root, toolchain } from "./formal.mjs";

const target = path.join(root, ".cache/tla2tools.jar");
let bytes;
try { bytes = await readFile(target); }
catch (error) { if (error.code !== "ENOENT") throw error; }
if (!bytes || createHash("sha256").update(bytes).digest("hex") !== toolchain.sha256) {
  const response = await fetch(toolchain.url, { signal: AbortSignal.timeout(60000) });
  if (!response.ok) throw new Error(`TLC download failed: ${response.status}`);
  bytes = Buffer.from(await response.arrayBuffer());
  if (createHash("sha256").update(bytes).digest("hex") !== toolchain.sha256) throw new Error("downloaded TLC checksum mismatch");
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes);
}
console.log("Pinned TLC is available");
