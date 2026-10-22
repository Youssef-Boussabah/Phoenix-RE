import { readdir, readFile } from 'node:fs/promises';
import { isBuiltin } from 'node:module';
import { resolve, relative, sep, dirname } from 'node:path';
import ts from 'typescript';

export const WORKSPACE_EDGES: Readonly<Record<string, readonly string[]>> = {
  contracts: [],
  toolkit: ['contracts'],
  evidence: ['contracts'],
  core: ['contracts', 'toolkit', 'evidence'],
  cli: ['core', 'contracts'],
  server: ['core', 'contracts'],
};
const RUNTIME_DEPS: Readonly<Record<string, readonly string[]>> = {
  contracts: ['zod'],
  toolkit: [],
  evidence: [],
  core: [],
  cli: [],
  server: ['hono', '@hono/node-server'],
};
export interface PackageManifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}
export function checkManifest(pkg: string, manifest: PackageManifest): string[] {
  if (WORKSPACE_EDGES[pkg] === undefined) return [`Unknown package ${pkg}`];
  const errors: string[] = [];
  if (manifest.name !== `@phoenix/${pkg}`) errors.push(`Unexpected package name ${manifest.name}`);
  for (const [name, version] of Object.entries({
    ...manifest.devDependencies,
    ...manifest.peerDependencies,
    ...manifest.optionalDependencies,
    ...manifest.dependencies,
  })) {
    if (name.startsWith('@phoenix/')) {
      if (!WORKSPACE_EDGES[pkg].includes(name.slice(9))) errors.push(`${pkg} may not depend on ${name}`);
      if (!version.startsWith('workspace:')) errors.push(`${name} must use workspace protocol`);
    } else if (!(RUNTIME_DEPS[pkg]?.includes(name) ?? false))
      errors.push(`${pkg} has unapproved dependency ${name}`);
  }
  return errors;
}
export function checkSource(
  pkg: string,
  filename: string,
  source: string,
  dependencies: Readonly<Record<string, string>> = {},
): string[] {
  const errors: string[] = [];
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const inspect = (specifier: string, typeOnly: boolean): void => {
    if (specifier.startsWith('.')) {
      const target = resolve(dirname(filename), specifier);
      if (
        relative(resolve('packages', pkg, 'src'), target)
          .split(sep)
          .includes('..')
      )
        errors.push(`${filename}: relative import leaves package source`);
      return;
    }
    if (typeOnly && specifier.startsWith('node:')) return;
    if (pkg === 'contracts' && specifier !== 'zod')
      errors.push(`${filename}: contracts runtime import ${specifier} is forbidden`);
    const builtin = isBuiltin(specifier);
    if (!specifier.startsWith('node:') && !builtin) {
      const name = specifier.startsWith('@')
        ? specifier.split('/').slice(0, 2).join('/')
        : (specifier.split('/')[0] ?? '');
      if (dependencies[name] === undefined) errors.push(`${filename}: undeclared import ${specifier}`);
      if (
        specifier.startsWith('@phoenix/') &&
        (!WORKSPACE_EDGES[pkg]?.includes(name.slice(9)) || specifier !== name)
      )
        errors.push(`${filename}: forbidden workspace import ${specifier}`);
    }
    if (
      !typeOnly &&
      /^(?:node:)?child_process$/.test(specifier) &&
      filename.replaceAll('\\', '/') !== 'packages/toolkit/src/platform/process.ts'
    )
      errors.push(`${filename}: process boundary`);
    if (
      !typeOnly &&
      /^(?:node:)?sqlite$/.test(specifier) &&
      !filename.replaceAll('\\', '/').startsWith('packages/evidence/src/db/')
    )
      errors.push(`${filename}: database boundary`);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      if (node.moduleSpecifier !== undefined && ts.isStringLiteral(node.moduleSpecifier)) {
        const typeOnly = ts.isImportDeclaration(node)
          ? node.importClause?.phaseModifier === ts.SyntaxKind.TypeKeyword
          : node.isTypeOnly;
        inspect(node.moduleSpecifier.text, typeOnly);
      }
    } else if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      const first = node.arguments[0];
      if (first !== undefined && ts.isStringLiteral(first)) inspect(first.text, false);
      else errors.push(`${filename}: computed module loading cannot be checked`);
    }
    if (ts.isCallExpression(node)) {
      const expression = node.expression;
      const builtinLookup =
        ts.isPropertyAccessExpression(expression) &&
        expression.name.text === 'getBuiltinModule' &&
        (expression.expression.getText(file) === 'process' ||
          expression.expression.getText(file) === 'globalThis.process');
      if (builtinLookup) {
        const first = node.arguments[0];
        if (first !== undefined && ts.isStringLiteral(first)) inspect(first.text, false);
        else errors.push(`${filename}: computed built-in loading cannot be checked`);
      }
      if (
        pkg === 'contracts' &&
        ((ts.isIdentifier(expression) && expression.text === 'fetch') ||
          (ts.isPropertyAccessExpression(expression) && expression.getText(file) === 'globalThis.fetch'))
      )
        errors.push(`${filename}: network access is forbidden in contracts`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return errors;
}
async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((e) =>
      e.isDirectory()
        ? sources(resolve(dir, e.name))
        : Promise.resolve(/\.(?:ts|mts|cts)$/.test(e.name) ? [resolve(dir, e.name)] : []),
    ),
  );
  return nested.flat();
}
export async function checkBoundaries(root = process.cwd()): Promise<string[]> {
  const errors: string[] = [];
  for (const entry of await readdir(resolve(root, 'packages'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const manifest = JSON.parse(
      await readFile(resolve(root, 'packages', entry.name, 'package.json'), 'utf8'),
    ) as PackageManifest;
    errors.push(...checkManifest(entry.name, manifest));
    for (const file of await sources(resolve(root, 'packages', entry.name, 'src')))
      errors.push(
        ...checkSource(entry.name, relative(root, file), await readFile(file, 'utf8'), manifest.dependencies),
      );
  }
  return errors;
}
if (import.meta.main) {
  const errors = await checkBoundaries();
  if (errors.length) {
    console.error(errors.join('\n'));
    process.exitCode = 1;
  } else console.log('Package manifest and source import boundaries passed.');
}
