/**
 * `boring check`: the executable half of BORING-6. Reads ARCHITECTURE.json and verifies that every
 * package has its laws, registry and contract, that imports follow the declared direction (including
 * type-only edges and computed loading), and that no external dependency is undeclared.
 */
import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

/** Reads of the process environment in a source file: `process.env`, `process["env"]`, `import.meta.env` (one entry per occurrence). */
export function environmentReads(source, filename) {
  const reads = [];
  const syntax = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    const access = ts.isPropertyAccessExpression(node) ? node.name.text : ts.isElementAccessExpression(node) && ts.isStringLiteralLike(node.argumentExpression) ? node.argumentExpression.text : null;
    if (access === "env") {
      const target = node.expression;
      if (ts.isIdentifier(target) && target.text === "process") reads.push("process.env");
      else if (ts.isMetaProperty(target) && target.keywordToken === ts.SyntaxKind.ImportKeyword && target.name.text === "meta") reads.push("import.meta.env");
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return reads;
}

/** `{ port, name }` for a file in an adapter folder, `{ port, table: true }` for a port's table, else null. */
export function adapterOf(relative) {
  const m = /^packages\/[^/]+\/src\/adapters\/([^/]+)\/(.+)$/.exec(relative.split(path.sep).join("/"));
  if (!m) return null;
  const [port, rest] = [m[1], m[2]];
  if (!rest.includes("/")) return { port, table: true };
  return { port, name: rest.split("/")[0] };
}

export function importSpecifiers(source, filename) {
  const imports = [];
  const syntax = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const add = (node, typeOnly = false) => imports.push({ specifier: node && ts.isStringLiteralLike(node) ? node.text : null, typeOnly });
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause, names = clause?.namedBindings;
      const typeOnly = !!clause?.isTypeOnly || (!clause?.name && names && ts.isNamedImports(names) && names.elements.length > 0 && names.elements.every(item => item.isTypeOnly));
      add(node.moduleSpecifier, !!typeOnly);
    } else if (ts.isExportDeclaration(node)) {
      const names = node.exportClause;
      const typeOnly = node.isTypeOnly || (names && ts.isNamedExports(names) && names.elements.length > 0 && names.elements.every(item => item.isTypeOnly));
      if (node.moduleSpecifier) add(node.moduleSpecifier, !!typeOnly);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      add(node.moduleReference.expression, !!node.isTypeOnly);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      add(node.argument.literal, true);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return imports;
}

async function exists(file) {
  try { return (await stat(file)).isFile(); } catch (error) { if (error.code === "ENOENT") return false; throw error; }
}
async function resolveImport(file, specifier) {
  const candidate = path.resolve(path.dirname(file), specifier);
  const alternatives = [candidate];
  if (/\.m?js$/.test(candidate)) alternatives.push(candidate.replace(/\.m?js$/, candidate.endsWith(".mjs") ? ".mts" : ".ts"));
  for (const extension of [".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.js"]) alternatives.push(candidate + extension);
  for (const alternative of alternatives) if (await exists(alternative)) return realpath(alternative);
  return null;
}
async function sourceFiles(dir, errors) {
  const result = [];
  async function walk(current) {
    let entries;
    try { entries = await readdir(current, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const file = path.join(current, entry.name);
      if (entry.name === "node_modules") continue;
      if (entry.isSymbolicLink()) errors.push(`source symlink is not allowed: ${file}`);
      else if (entry.isDirectory()) await walk(file);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) result.push(file);
    }
  }
  await walk(dir);
  return result;
}

export async function checkArchitecture(root) {
  root = await realpath(root);
  const errors = [];
  const policy = JSON.parse(await readFile(path.join(root, "ARCHITECTURE.json"), "utf8"));
  const packages = Object.keys(policy.packages);
  const packagesDir = path.join(root, "packages");

  for (const entry of await readdir(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !packages.includes(entry.name)) errors.push(`undeclared package: packages/${entry.name}`);
  }
  for (const name of packages) {
    const dir = path.join(packagesDir, name);
    for (const required of ["package.json", "INVARIANTS.md", "VERIFY.json", "src/index.ts"]) {
      if (!await exists(path.join(dir, required))) errors.push(`${name}: missing ${required}`);
    }
    if (await exists(path.join(dir, "package.json"))) {
      const manifest = JSON.parse(await readFile(path.join(dir, "package.json"), "utf8"));
      if (manifest.name !== `@boring/${name}`) errors.push(`${name}: package.json name must be @boring/${name}`);
      const declared = new Set([...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {}), ...Object.keys(manifest.peerDependencies ?? {})]);
      for (const dep of [...policy.packages[name].dependsOn, ...policy.packages[name].typeOnlyDependsOn]) {
        if (!declared.has(`@boring/${dep}`)) errors.push(`${name}: package.json must declare @boring/${dep}`);
      }
      for (const dep of declared) if (dep.startsWith("@boring/") && ![...policy.packages[name].dependsOn, ...policy.packages[name].typeOnlyDependsOn].includes(dep.slice(8))) errors.push(`${name}: package.json declares ${dep} which the policy does not allow`);
    }
    for (const dep of [...policy.packages[name].dependsOn, ...policy.packages[name].typeOnlyDependsOn]) {
      if (!packages.includes(dep) || dep === name) errors.push(`${name}: invalid dependency ${dep}`);
    }
  }
  const visited = new Set(), visiting = new Set();
  function visit(name, trail = []) {
    if (visiting.has(name)) { errors.push(`cyclic package dependency: ${[...trail, name].join(" -> ")}`); return; }
    if (visited.has(name)) return;
    visiting.add(name);
    const edges = [...(policy.packages[name]?.dependsOn ?? []), ...(policy.packages[name]?.typeOnlyDependsOn ?? [])];
    for (const dep of edges) if (packages.includes(dep)) visit(dep, [...trail, name]);
    visiting.delete(name); visited.add(name);
  }
  for (const name of packages) visit(name);

  const ownerOf = file => {
    const relative = path.relative(root, file).split(path.sep);
    if (relative[0] === "packages" && packages.includes(relative[1])) return { kind: "package", name: relative[1] };
    if ((policy.consumers ?? []).includes(relative[0])) return { kind: "consumer", name: relative[0] };
    return null;
  };
  const roots = [...packages.map(name => path.join(packagesDir, name, "src")), ...(policy.consumers ?? []).map(name => path.join(root, name))];
  for (const dir of roots) {
    for (const file of await sourceFiles(dir, errors)) {
      const from = ownerOf(file);
      const label = path.relative(root, file);
      const source = await readFile(file, "utf8");
      const adapters = policy.adapters ?? null;
      const here = from.kind === "package" ? adapterOf(label) : null;
      if (adapters && from.kind === "package" && !here?.name) {
        for (const read of environmentReads(source, file)) errors.push(`${label}: reads ${read} outside an adapter folder (BORING-7: the host passes configuration in)`);
      }
      for (const { specifier, typeOnly } of importSpecifiers(source, file)) {
        if (specifier === null) { if (!Object.hasOwn(policy.computedImports ?? {}, label)) errors.push(`${label}: computed module loading is not declared`); continue; }
        if (adapters && from.kind === "package") {
          if (!here?.name && (adapters.vendorModules ?? []).some(prefix => specifier.startsWith(prefix))) errors.push(`${label}: imports the vendor SDK module ${specifier} outside an adapter folder (BORING-7)`);
          if (!here?.name && (adapters.fsModules ?? []).includes(specifier) && !Object.hasOwn(adapters.fsAllowed ?? {}, label)) errors.push(`${label}: imports ${specifier} outside an adapter folder (BORING-7; a reasoned exception goes in ARCHITECTURE.json adapters.fsAllowed)`);
          if (specifier.startsWith(".")) {
            const resolved = await resolveImport(file, specifier);
            const to = resolved ? adapterOf(path.relative(root, resolved)) : null;
            if (here?.name && to?.name && (to.port !== here.port || to.name !== here.name)) errors.push(`${label}: an adapter imports another adapter: ${specifier} (BORING-7)`);
            else if (here?.name && resolved && !to && !typeOnly) errors.push(`${label}: an adapter imports core code as types only: ${specifier} (BORING-7)`);
            else if (!here && to?.name) errors.push(`${label}: core code imports an adapter directly: ${specifier} (BORING-7: only the port's table adapters/${to.port}/index.ts does)`);
            else if (here?.table && to?.name && to.port !== here.port) errors.push(`${label}: a port's table lists only its own adapters: ${specifier} (BORING-7)`);
          }
        }
        let target = null;
        if (specifier.startsWith("@boring/")) {
          const [name, ...rest] = specifier.slice(8).split("/");
          target = { kind: "package", name, sub: rest.join("/") };
        } else if (specifier.startsWith(".")) {
          const resolved = await resolveImport(file, specifier);
          if (!resolved) { errors.push(`${label}: unresolved import ${specifier}`); continue; }
          target = ownerOf(resolved);
          if (!target) { if (from.kind === "package") errors.push(`${label}: import leaves the packages: ${specifier}`); continue; }
        } else {
          if (from.kind === "package" && !(policy.externalDependencies[from.name] ?? []).includes(specifier)) errors.push(`${label}: undeclared external dependency ${specifier}`);
          continue;
        }
        if (from.kind === "consumer") continue;
        if (target.kind !== "package") { errors.push(`${label}: a package cannot import a consumer: ${specifier}`); continue; }
        if (target.name === from.name) continue;
        const rules = policy.packages[from.name];
        if (rules.dependsOn.includes(target.name)) continue;
        if (rules.typeOnlyDependsOn.includes(target.name)) {
          if (!typeOnly) errors.push(`${label}: ${from.name} may import only types from ${target.name}: ${specifier}`);
          continue;
        }
        errors.push(`${label}: forbidden package import ${from.name} -> ${target.name}`);
      }
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = await checkArchitecture(root);
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
  else console.log("package architecture checks passed (direction, type-only edges, externals, laws and registries present)");
}
