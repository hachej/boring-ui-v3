import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const toolchain = JSON.parse(readFileSync(path.join(root, "tools/formal-toolchain.json"), "utf8"));
export function jarPath() {
  const jar = process.env.TLA2TOOLS_JAR ?? path.join(root, ".cache/tla2tools.jar");
  if (!existsSync(jar)) throw new Error("required TLC is missing; run npm run setup:formal");
  const digest = createHash("sha256").update(readFileSync(jar)).digest("hex");
  if (digest !== toolchain.sha256) throw new Error("TLC checksum differs from the pinned toolchain");
  return jar;
}
export function runModel(name, { directory = root, spec, config } = {}) {
  const model = toolchain.models[name];
  if (!model) throw new Error(`unknown model ${name}`);
  const args = ["-Xmx512m", "-XX:+UseParallelGC", "-jar", jarPath(), spec ?? path.join(root, model.spec), "-config", config ?? path.join(root, model.config), "-workers", "1"];
  const result = spawnSync(process.env.JAVA_BIN ?? "java", args, { cwd: directory, encoding: "utf8", timeout: 60000 });
  return { status: result.status, output: (result.stdout ?? "") + (result.stderr ?? "") + (result.error?.message ?? "") };
}
