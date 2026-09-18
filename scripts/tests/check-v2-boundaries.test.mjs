import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';

import { checkRepository } from '../check-v2-boundaries.mjs';

function packageManifest(name, exports = { '.': './src/index.ts' }) {
  return `${JSON.stringify({ name, exports }, null, 2)}\n`;
}

function checkFixture(files) {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'v2-boundaries-'));
  try {
    for (const [relativePath, content] of Object.entries(files)) {
      const filePath = resolve(fixtureRoot, relativePath);
      mkdirSync(dirname(filePath), { recursive: true });
      writeFileSync(filePath, content, 'utf8');
    }
    return checkRepository(fixtureRoot);
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test('allows core to depend on platform contracts', () => {
  const result = checkFixture({
    'packages/core/package.json': packageManifest('@mdular/core'),
    'packages/core/src/index.ts': "export { platformValue } from '@mdular/platform';\n",
    'packages/platform/package.json': packageManifest('@mdular/platform'),
    'packages/platform/src/index.ts': 'export const platformValue = 1;\n',
  });

  assert.equal(result.sourceCount, 2);
  assert.deepEqual(result.errors, []);
});

test('rejects V2 imports from legacy src', () => {
  const result = checkFixture({
    'packages/core/src/index.ts': "import '../../../src/files/index.js';\n",
    'src/files/index.ts': 'export {};\n',
  });

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /imports legacy src\//u);
});

test('allows official plugins to use plugin-sdk but not core', () => {
  const allowed = checkFixture({
    'packages/plugin-sdk/package.json': packageManifest('@mdular/plugin-sdk'),
    'packages/plugin-sdk/src/index.ts': 'export interface PluginContext {}\n',
    'plugins/official/chat/src/index.ts':
      "import type { PluginContext } from '@mdular/plugin-sdk';\n" +
      'export type ChatContext = PluginContext;\n',
  });
  assert.deepEqual(allowed.errors, []);

  const rejected = checkFixture({
    'packages/core/package.json': packageManifest('@mdular/core'),
    'packages/core/src/index.ts': 'export interface DocumentSession {}\n',
    'plugins/official/chat/src/index.ts':
      "import type { DocumentSession } from '@mdular/core';\n" +
      'export type ChatSession = DocumentSession;\n',
  });
  assert.equal(rejected.errors.length, 1);
  assert.match(rejected.errors[0], /may only use its own code and plugin-sdk/u);
});

test('rejects host DOM globals and undeclared external packages in official plugins', () => {
  const result = checkFixture({
    'plugins/official/docs/src/index.ts':
      "import 'yaml';\n" +
      "document.body.textContent = window.location.href;\n" +
      "localStorage.setItem('key', 'value');\n",
  });
  assert.equal(result.errors.length, 4);
  assert.match(result.errors.join('\n'), /host global document/u);
  assert.match(result.errors.join('\n'), /host global window/u);
  assert.match(result.errors.join('\n'), /host global localStorage/u);
  assert.match(result.errors.join('\n'), /may only use its own code and plugin-sdk/u);
});

test('allows only package subpaths declared in exports', () => {
  const allowed = checkFixture({
    'packages/core/package.json': packageManifest('@mdular/core', {
      '.': './src/index.ts',
      './testing': './src/testing.ts',
    }),
    'packages/core/src/testing.ts': 'export const fixtureValue = 1;\n',
    'packages/editor/package.json': packageManifest('@mdular/editor'),
    'packages/editor/src/index.ts':
      "import { fixtureValue } from '@mdular/core/testing';\nvoid fixtureValue;\n",
  });
  assert.deepEqual(allowed.errors, []);

  const rejected = checkFixture({
    'packages/core/package.json': packageManifest('@mdular/core'),
    'packages/core/src/internal.ts': 'export const internalValue = 1;\n',
    'packages/editor/package.json': packageManifest('@mdular/editor'),
    'packages/editor/src/index.ts':
      "import { internalValue } from '@mdular/core/src/internal.js';\nvoid internalValue;\n",
  });
  assert.equal(rejected.errors.length, 1);
  assert.match(rejected.errors[0], /non-exported package subpath/u);
});

test('rejects relative paths that cross package boundaries', () => {
  const packageResult = checkFixture({
    'packages/core/src/index.ts': 'export interface DocumentSession {}\n',
    'packages/editor/src/index.ts':
      "import type { DocumentSession } from '../../core/src/index.js';\n" +
      'export type EditorSession = DocumentSession;\n',
  });
  assert.equal(packageResult.errors.length, 1);
  assert.match(packageResult.errors[0], /cross-package path import/u);

  const pluginResult = checkFixture({
    'packages/plugin-sdk/src/index.ts': 'export interface PluginContext {}\n',
    'plugins/official/chat/src/index.ts':
      "import type { PluginContext } from '../../../../packages/plugin-sdk/src/index.js';\n" +
      'export type ChatContext = PluginContext;\n',
  });
  assert.equal(pluginResult.errors.length, 1);
  assert.match(pluginResult.errors[0], /cross-package path import/u);
});

test('rejects Node.js builtins in every V2 layer', () => {
  const result = checkFixture({
    'packages/core/src/index.ts': "import 'node:fs';\nimport 'path';\n",
  });

  assert.equal(result.errors.length, 2);
  assert.match(result.errors[0], /Node\.js builtin node:fs is forbidden/u);
  assert.match(result.errors[1], /Node\.js builtin path is forbidden/u);
});

test('allows Tauri packages only in the desktop composition root', () => {
  const desktop = checkFixture({
    'apps/desktop/src/index.ts': "import { invoke } from '@tauri-apps/api/core';\nvoid invoke;\n",
  });
  assert.deepEqual(desktop.errors, []);

  const web = checkFixture({
    'apps/web/src/index.ts': "import { invoke } from '@tauri-apps/api/core';\nvoid invoke;\n",
  });
  assert.equal(web.errors.length, 1);
  assert.match(web.errors[0], /only allowed in apps\/desktop/u);
});

test('rejects raw Tauri globals in every V2 layer', () => {
  const result = checkFixture({
    'apps/desktop/src/index.ts': 'void window.__TAURI__;\n',
  });

  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0], /raw __TAURI__ global is forbidden/u);
});
