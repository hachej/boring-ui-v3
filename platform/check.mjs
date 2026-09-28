import { readFile, readdir, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export function importSpecifiers(source, filename) {
  const imports = [];
  const syntax = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  function add(node, typeOnly = false) {
    imports.push({ specifier: node && ts.isStringLiteralLike(node) ? node.text : null, typeOnly });
  }
  function visit(node) {
    if (ts.isImportDeclaration(node)) {
      const clause = node.importClause;
      const names = clause?.namedBindings;
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
    } else if (ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
       (ts.isIdentifier(node.expression) && node.expression.text === "require"))) {
      add(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }
  visit(syntax);
  return imports;
}

async function exists(file) {
  try { return (await stat(file)).isFile(); }
  catch (error) { if (error.code === "ENOENT") return false; throw error; }
}

async function resolveImport(file, specifier) {
  const candidate = path.resolve(path.dirname(file), specifier);
  const alternatives = [candidate];
  if (/\.m?js$/.test(candidate)) alternatives.push(candidate.replace(/\.m?js$/, candidate.endsWith(".mjs") ? ".mts" : ".ts"));
  for (const extension of [".ts", ".tsx", ".js", ".mjs", "/index.ts", "/index.js"]) alternatives.push(candidate + extension);
  for (const alternative of alternatives) if (await exists(alternative)) return realpath(alternative);
  return null;
}

async function sourceFiles(root, errors) {
  const result = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(dir, { withFileTypes: true }); }
    catch (error) { if (error.code === "ENOENT") return; throw error; }
    for (const entry of entries) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) errors.push(`source symlink is not allowed: ${file}`);
      else if (entry.isDirectory()) await walk(file);
      else if (/\.[cm]?[jt]sx?$/.test(entry.name)) result.push(file);
    }
  }
  await walk(root);
  return result;
}

export async function checkArchitecture(root) {
  root = await realpath(root);
  const errors = [];
  const contract = JSON.parse(await readFile(path.join(root, "platform/ARCHITECTURE.json"), "utf8"));
  const relationships = JSON.parse(await readFile(path.join(root, "platform/RELATIONSHIPS.json"), "utf8"));
  const nouns = new Set(contract.nouns);
  const singular = new Set(contract.nouns.map(noun => noun.slice(0, -1)));
  if (nouns.size !== contract.nouns.length) errors.push("duplicate noun");
  if (relationships.nouns.length !== singular.size || relationships.nouns.some(noun => !singular.has(noun))) errors.push("relationship nouns differ from architecture nouns");
  for (const [name, relationship] of Object.entries(relationships.relationships)) {
    if (!singular.has(relationship.from) || !singular.has(relationship.to) || !relationship.meaning || !relationship.cardinality) errors.push(`invalid relationship: ${name}`);
  }
  const rootFiles = new Set(["ARCHITECTURE.json", "INVARIANTS.md", "RELATIONSHIPS.json", "RELATIONSHIPS.md", "SEMANTICS.md", "VERIFY.json", "identity.ts", "check.mjs"]);
  for (const entry of await readdir(path.join(root, "platform"), { withFileTypes: true })) {
    if (entry.name === "formal" && entry.isDirectory()) continue;
    if (entry.isFile() && rootFiles.has(entry.name)) continue;
    if (!entry.isDirectory() || !nouns.has(entry.name)) errors.push(`undeclared platform root entry: ${entry.name}`);
  }
  for (const noun of nouns) {
    if (!await exists(path.join(root, "platform", noun, "INVARIANTS.md"))) errors.push(`${noun}: missing INVARIANTS.md`);
    if (!Array.isArray(contract.allowedDependencies[noun])) errors.push(`${noun}: missing dependency policy`);
    for (const dependency of contract.allowedDependencies[noun] ?? []) if (!nouns.has(dependency) || dependency === noun) errors.push(`${noun}: invalid dependency ${dependency}`);
  }
  const visited = new Set(), visiting = new Set();
  function visit(noun, trail = []) {
    if (visiting.has(noun)) { errors.push(`cyclic noun dependency: ${[...trail, noun].join(" -> ")}`); return; }
    if (visited.has(noun)) return;
    visiting.add(noun);
    for (const dependency of contract.allowedDependencies[noun] ?? []) if (nouns.has(dependency)) visit(dependency, [...trail, noun]);
    visiting.delete(noun);
    visited.add(noun);
  }
  for (const noun of nouns) visit(noun);
  const identityFile = path.join(root, "platform/identity.ts");
  const identitySource = await readFile(identityFile, "utf8");
  const identitySyntax = ts.createSourceFile(identityFile, identitySource, ts.ScriptTarget.Latest, true);
  if (identitySyntax.parseDiagnostics.length || identitySyntax.statements.some(node => !ts.isTypeAliasDeclaration(node) && !ts.isInterfaceDeclaration(node)) || importSpecifiers(identitySource, identityFile).length) errors.push("identity.ts must contain only type declarations and no imports");
  const layers = Object.keys(contract.layers);
  function owner(file) {
    const relative = path.relative(root, file).split(path.sep);
    return { layer: layers.includes(relative[0]) ? relative[0] : null, noun: relative[0] === "platform" && nouns.has(relative[1]) ? relative[1] : null };
  }
  for (const layer of layers) {
    for (const file of await sourceFiles(path.join(root, layer), errors)) {
      if (file === path.join(root, "platform/check.mjs")) continue;
      const from = owner(file);
      for (const { specifier, typeOnly } of importSpecifiers(await readFile(file, "utf8"), file)) {
        const label = path.relative(root, file);
        if (specifier === null) { if (!Object.hasOwn(contract.computedImports ?? {}, label)) errors.push(`${label}: computed module loading is not declared`); continue; }
        if (!specifier.startsWith(".")) {
          if (!(contract.externalDependencies[layer] ?? []).includes(specifier)) errors.push(`${label}: undeclared external dependency ${specifier}`);
          continue;
        }
        const target = await resolveImport(file, specifier);
        if (!target) { errors.push(`${label}: unresolved import ${specifier}`); continue; }
        const to = owner(target);
        const sourceOwner = from.noun ? `platform/${from.noun}` : from.layer;
        const targetOwner = to.noun ? `platform/${to.noun}` : to.layer;
        if (!typeOnly && (contract.typeOnlyDependencies[sourceOwner] ?? []).includes(targetOwner)) errors.push(`${label}: Environment access must use issued operations, not a value import: ${specifier}`);
        const sameFolder = to.layer === from.layer && path.relative(root, file).split(path.sep)[1] === path.relative(root, target).split(path.sep)[1];
        if (!to.layer || (!contract.layers[layer].mayDependOn.includes(to.layer) && !sameFolder)) errors.push(`${label}: forbidden layer import ${specifier}`);
        else if (from.layer === "platform" && to.layer === "platform" && from.noun && to.noun && from.noun !== to.noun && !(contract.allowedDependencies[from.noun] ?? []).includes(to.noun)) errors.push(`${label}: forbidden noun import ${from.noun} -> ${to.noun}`);
        else if (target === identityFile) { if (!typeOnly) errors.push(`${label}: identity.ts may only be imported as types`); }
        else if (to.layer === "platform" && !to.noun) errors.push(`${label}: platform tooling is not a runtime dependency`);
      }
    }
  }
  let reusableJobs = [];
  try { reusableJobs = await readdir(path.join(root, "jobs"), { withFileTypes: true }); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  for (const job of reusableJobs.filter(entry => entry.isDirectory())) {
    const spec = path.join(root, "jobs", job.name, "SPEC.md");
    if (!await exists(spec)) { errors.push(`reusable job ${job.name}: missing SPEC.md`); continue; }
    const text = await readFile(spec, "utf8");
    for (const section of ["Inputs", "Output", "Actor", "Environment needs", "Invariants", "Verification"]) {
      if (!text.includes(`## ${section}`)) errors.push(`reusable job ${job.name}: missing ${section} contract`);
    }
  }
  return errors;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const errors = await checkArchitecture(root);
  if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
  else console.log("platform architecture checks passed (imports, identities and contract structure; not semantic/product correctness)");
}
