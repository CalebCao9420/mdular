import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.mts', '.ts', '.tsx']);
const V2_SOURCE_ROOTS = ['apps', 'packages', 'plugins/official'];
const NODE_BUILTIN_SPECIFIERS = new Set(
  builtinModules.map((specifier) => specifier.replace(/^node:/u, '')),
);

const ALLOWED_PACKAGE_DEPENDENCIES = new Map([
  ['platform', new Set(['platform'])],
  ['core', new Set(['core', 'platform'])],
  ['editor', new Set(['editor', 'core'])],
  ['ui', new Set(['ui', 'core', 'editor', 'plugin-sdk'])],
  ['plugin-manifest', new Set(['plugin-manifest'])],
  ['plugin-sdk', new Set(['plugin-sdk', 'plugin-manifest'])],
  [
    'plugin-runtime',
    new Set(['plugin-runtime', 'core', 'platform', 'plugin-sdk', 'plugin-manifest']),
  ],
  ['plugin-testkit', new Set(['plugin-testkit', 'plugin-sdk', 'plugin-manifest'])],
]);

function toWorkspacePath(value) {
  return value.split(sep).join('/');
}

function getRelativeParts(projectRoot, filePath) {
  const relativePath = relative(projectRoot, resolve(filePath));
  if (
    '' === relativePath ||
    '..' === relativePath ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    return null;
  }
  return relativePath.split(/[\\/]/u);
}

function classifyPath(projectRoot, filePath) {
  const parts = getRelativeParts(projectRoot, filePath);
  if (null === parts) { return { kind: 'outside', name: 'outside repository' }; }

  if ('src' === parts[0] || 'web' === parts[0]) {
    return { kind: 'legacy', name: parts[0] };
  }
  if ('packages' === parts[0] && 2 <= parts.length) {
    return { kind: 'package', name: parts[1] };
  }
  if ('apps' === parts[0] && 2 <= parts.length) {
    return { kind: 'app', name: parts[1] };
  }
  if ('plugins' === parts[0] && 'official' === parts[1] && 3 <= parts.length) {
    return { kind: 'official-plugin', name: parts[2] };
  }
  return { kind: 'workspace', name: parts[0] };
}

function collectSourceFiles(directoryPath, results) {
  if (!existsSync(directoryPath)) { return; }

  const entries = readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  for (const entry of entries) {
    if (entry.isSymbolicLink()) { continue; }
    const entryPath = resolve(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if ('dist' !== entry.name && 'node_modules' !== entry.name && 'target' !== entry.name) {
        collectSourceFiles(entryPath, results);
      }
      continue;
    }
    const extensionIndex = entry.name.lastIndexOf('.');
    const extension = 0 <= extensionIndex ? entry.name.slice(extensionIndex) : '';
    if (SOURCE_EXTENSIONS.has(extension)) { results.push(entryPath); }
  }
}

function registerPackageNames(projectRoot, relativeRoot, kind, packageNames) {
  const directoryPath = resolve(projectRoot, relativeRoot);
  if (!existsSync(directoryPath)) { return; }

  const entries = readdirSync(directoryPath, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) { continue; }
    const packageJsonPath = resolve(directoryPath, entry.name, 'package.json');
    if (!existsSync(packageJsonPath)) { continue; }
    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
    if ('string' === typeof manifest.name && '' !== manifest.name.trim()) {
      packageNames.set(manifest.name, {
        kind,
        name: entry.name,
        packageName: manifest.name,
        exports: manifest.exports,
      });
    }
  }
}

function collectPackageNames(projectRoot) {
  const packageNames = new Map();
  registerPackageNames(projectRoot, 'packages', 'package', packageNames);
  registerPackageNames(projectRoot, 'apps', 'app', packageNames);
  registerPackageNames(projectRoot, 'plugins/official', 'official-plugin', packageNames);
  return packageNames;
}

function hasExportTarget(value) {
  if ('string' === typeof value) { return true; }
  if (Array.isArray(value)) { return value.some(hasExportTarget); }
  if (value && 'object' === typeof value) {
    return Object.values(value).some(hasExportTarget);
  }
  return false;
}

function exportKeyMatches(pattern, exportKey) {
  const wildcardIndex = pattern.indexOf('*');
  if (-1 === wildcardIndex) { return pattern === exportKey; }
  const prefix = pattern.slice(0, wildcardIndex);
  const suffix = pattern.slice(wildcardIndex + 1);
  return (
    exportKey.startsWith(prefix) &&
    exportKey.endsWith(suffix) &&
    prefix.length + suffix.length <= exportKey.length
  );
}

function isPublicPackageSpecifier(packageInfo, specifier) {
  const exportKey = specifier === packageInfo.packageName
    ? '.'
    : `.${specifier.slice(packageInfo.packageName.length)}`;
  const packageExports = packageInfo.exports;

  // Packages without an exports map expose only their root entry to other workspace layers.
  if (undefined === packageExports) { return '.' === exportKey; }
  if (!packageExports || 'object' !== typeof packageExports || Array.isArray(packageExports)) {
    return '.' === exportKey && hasExportTarget(packageExports);
  }

  const entries = Object.entries(packageExports);
  const usesSubpathMap = entries.some(([key]) => key.startsWith('.'));
  if (!usesSubpathMap) {
    return '.' === exportKey && hasExportTarget(packageExports);
  }
  return entries.some(
    ([pattern, target]) => exportKeyMatches(pattern, exportKey) && hasExportTarget(target),
  );
}

function isNodeBuiltinSpecifier(specifier) {
  if (specifier.startsWith('node:')) { return true; }
  return NODE_BUILTIN_SPECIFIERS.has(specifier);
}

function classifySpecifier(projectRoot, sourcePath, specifier, packageNames) {
  if (
    specifier.startsWith('.') ||
    specifier.startsWith('/') ||
    /^[A-Za-z]:[\\/]/u.test(specifier)
  ) {
    const targetPath = isAbsolute(specifier)
      ? resolve(specifier)
      : resolve(dirname(sourcePath), specifier);
    return { ...classifyPath(projectRoot, targetPath), importKind: 'path' };
  }

  const workspacePrefixes = ['apps/', 'packages/', 'plugins/official/', 'src/', 'web/'];
  if (workspacePrefixes.some((prefix) => specifier.startsWith(prefix))) {
    return {
      ...classifyPath(projectRoot, resolve(projectRoot, specifier)),
      importKind: 'path',
    };
  }

  const names = Array.from(packageNames.keys()).sort((left, right) => right.length - left.length);
  for (const name of names) {
    if (specifier === name || specifier.startsWith(`${name}/`)) {
      const packageInfo = packageNames.get(name);
      return {
        ...packageInfo,
        importKind: 'package',
        isPublicEntry: isPublicPackageSpecifier(packageInfo, specifier),
      };
    }
  }
  return { kind: 'external', name: specifier, importKind: 'external' };
}

function collectModuleSpecifiers(sourceFile) {
  const results = [];
  function add(node, value) {
    const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    results.push({ line: position.line + 1, value });
  }
  function visit(node) {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteralLike(node.moduleSpecifier)
    ) {
      add(node.moduleSpecifier, node.moduleSpecifier.text);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      node.moduleReference.expression &&
      ts.isStringLiteralLike(node.moduleReference.expression)
    ) {
      add(node.moduleReference.expression, node.moduleReference.expression.text);
    } else if (
      ts.isCallExpression(node) &&
      1 <= node.arguments.length &&
      ts.isStringLiteralLike(node.arguments[0]) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && 'require' === node.expression.text))
    ) {
      add(node.arguments[0], node.arguments[0].text);
    } else if (
      ts.isImportTypeNode(node) &&
      ts.isLiteralTypeNode(node.argument) &&
      ts.isStringLiteralLike(node.argument.literal)
    ) {
      add(node.argument.literal, node.argument.literal.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return results;
}

function collectRawTauriGlobals(sourceFile) {
  const results = [];
  function visit(node) {
    if (ts.isIdentifier(node) && '__TAURI__' === node.text) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      results.push(position.line + 1);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return Array.from(new Set(results));
}

const FORBIDDEN_OFFICIAL_PLUGIN_GLOBALS = new Set([
  'document',
  'localStorage',
  'sessionStorage',
  'window',
]);

function collectForbiddenOfficialPluginGlobals(sourceFile) {
  const results = [];
  function visit(node) {
    if (ts.isIdentifier(node) && FORBIDDEN_OFFICIAL_PLUGIN_GLOBALS.has(node.text)) {
      const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
      results.push({ line: position.line + 1, name: node.text });
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return results;
}

function validatePublicPackageImport(sourceLayer, targetLayer, specifier) {
  if ('package' !== targetLayer.kind) { return null; }
  if ('package' === targetLayer.importKind && !targetLayer.isPublicEntry) {
    return `imports non-exported package subpath ${specifier}`;
  }

  const staysInsideSourcePackage =
    'package' === sourceLayer.kind && sourceLayer.name === targetLayer.name;
  if ('path' === targetLayer.importKind && !staysInsideSourcePackage) {
    return `cross-package path import to package ${targetLayer.name} is forbidden; use its public package export`;
  }
  return null;
}

function validateDependency(sourceLayer, targetLayer) {
  if ('legacy' === targetLayer.kind) {
    return `imports legacy ${targetLayer.name}/`;
  }
  if ('outside' === targetLayer.kind) {
    return 'imports a path outside the repository';
  }
  if ('workspace' === targetLayer.kind) {
    return `imports unclassified workspace area ${targetLayer.name}/`;
  }

  if ('package' === sourceLayer.kind) {
    const allowed = ALLOWED_PACKAGE_DEPENDENCIES.get(sourceLayer.name);
    if (!allowed) { return `uses unregistered V2 package ${sourceLayer.name}`; }
    if ('package' === targetLayer.kind && allowed.has(targetLayer.name)) { return null; }
    if ('external' === targetLayer.kind) { return null; }
    return `package ${sourceLayer.name} may not depend on ${targetLayer.kind} ${targetLayer.name}`;
  }

  if ('app' === sourceLayer.kind) {
    if ('package' === targetLayer.kind || 'external' === targetLayer.kind) { return null; }
    if ('app' === targetLayer.kind && sourceLayer.name === targetLayer.name) { return null; }
    return `app ${sourceLayer.name} may not depend on ${targetLayer.kind} ${targetLayer.name}`;
  }

  if ('official-plugin' === sourceLayer.kind) {
    if ('official-plugin' === targetLayer.kind && sourceLayer.name === targetLayer.name) {
      return null;
    }
    if ('package' === targetLayer.kind && 'plugin-sdk' === targetLayer.name) { return null; }
    return `official plugin ${sourceLayer.name} may only use its own code and plugin-sdk`;
  }

  return `source is outside a registered V2 layer (${sourceLayer.kind})`;
}

export function checkRepository(rootPath = process.cwd()) {
  const projectRoot = resolve(rootPath);
  const packageNames = collectPackageNames(projectRoot);
  const sourcePaths = [];
  for (const relativeRoot of V2_SOURCE_ROOTS) {
    collectSourceFiles(resolve(projectRoot, relativeRoot), sourcePaths);
  }
  sourcePaths.sort((left, right) => left.localeCompare(right));

  const errors = [];
  for (const sourcePath of sourcePaths) {
    const relativeSourcePath = toWorkspacePath(relative(projectRoot, sourcePath));
    const sourceLayer = classifyPath(projectRoot, sourcePath);
    const sourceText = readFileSync(sourcePath, 'utf8');
    const scriptKind = sourcePath.endsWith('.tsx') || sourcePath.endsWith('.jsx')
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS;
    const sourceFile = ts.createSourceFile(
      relativeSourcePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      scriptKind
    );

    for (const line of collectRawTauriGlobals(sourceFile)) {
      errors.push(`${relativeSourcePath}:${line}: raw __TAURI__ global is forbidden`);
    }
    if ('official-plugin' === sourceLayer.kind) {
      for (const global of collectForbiddenOfficialPluginGlobals(sourceFile)) {
        errors.push(
          `${relativeSourcePath}:${global.line}: official plugin may not access host global ${global.name}`,
        );
      }
    }

    for (const dependency of collectModuleSpecifiers(sourceFile)) {
      if (isNodeBuiltinSpecifier(dependency.value)) {
        errors.push(
          `${relativeSourcePath}:${dependency.line}: Node.js builtin ${dependency.value} is forbidden in V2 source`,
        );
        continue;
      }
      if (
        dependency.value.startsWith('@tauri-apps/') &&
        !('app' === sourceLayer.kind && 'desktop' === sourceLayer.name)
      ) {
        errors.push(
          `${relativeSourcePath}:${dependency.line}: ${dependency.value} is only allowed in apps/desktop`
        );
        continue;
      }
      const targetLayer = classifySpecifier(
        projectRoot,
        sourcePath,
        dependency.value,
        packageNames
      );
      const publicImportViolation = validatePublicPackageImport(
        sourceLayer,
        targetLayer,
        dependency.value,
      );
      if (null !== publicImportViolation) {
        errors.push(
          `${relativeSourcePath}:${dependency.line}: ${publicImportViolation} (${dependency.value})`,
        );
        continue;
      }
      const violation = validateDependency(sourceLayer, targetLayer);
      if (null !== violation) {
        errors.push(`${relativeSourcePath}:${dependency.line}: ${violation} (${dependency.value})`);
      }
    }
  }

  return { errors, sourceCount: sourcePaths.length };
}

function runCli() {
  const rootIndex = process.argv.indexOf('--root');
  const rootPath = 0 <= rootIndex ? process.argv[rootIndex + 1] : process.cwd();
  if (!rootPath) {
    console.error('Missing value for --root');
    process.exitCode = 2;
    return;
  }

  const result = checkRepository(rootPath);
  if (0 < result.errors.length) {
    console.error(`V2 architecture boundary check failed (${result.errors.length}):`);
    for (const error of result.errors) { console.error(`- ${error}`); }
    process.exitCode = 1;
    return;
  }
  console.log(`V2 architecture boundary check passed (${result.sourceCount} source files).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  runCli();
}
