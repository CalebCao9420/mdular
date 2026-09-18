import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { transformSync } from 'esbuild';

const projectRoot = resolve(import.meta.dirname, '..', '..');

function source(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

function executeTypeScript(relativePath, globals = {}, appended = '') {
  const context = vm.createContext({ ...globals });
  context.globalThis = context;
  const compiled = transformSync(`${source(relativePath)}\n${appended}`, {
    loader: 'ts',
    target: 'es2020',
  }).code;
  vm.runInContext(compiled, context, { filename: relativePath });
  return context;
}

test('V1 VCS detection is disabled for memory workspaces and prefers Git over SVN', async () => {
  const requested = [];
  const vcs = executeTypeScript('src/vcs/repo.ts', {
    isMemFS: false,
    isTauriWorkspaceBound: () => true,
    tauriPathIsDir: async (path) => {
      requested.push(path);
      return ['.git', '.svn'].includes(path);
    },
  });
  assert.equal(await vcs.detectVcsRepo(), 'git');
  assert.deepEqual(requested, ['.git']);

  vcs.isMemFS = true;
  assert.equal(await vcs.detectVcsRepo(), 'none');
});

test('V1 dirty tracking ignores temporary paths and is idempotent until save', () => {
  const renders = [];
  const vcs = executeTypeScript('src/vcs/dirty.ts', {
    document: { getElementById: () => null },
    detectVcsRepo: async () => 'git',
    getVcsKind: () => 'git',
    initVcsMenu() {},
    renderSidebar: (...args) => renders.push(args),
  });
  vcs.markPathDirty('/?? scratch');
  vcs.markPathDirty('/docs/a.md');
  vcs.markPathDirty('/docs/a.md');
  vcs.markPathDirty('/docs/b.md');
  assert.deepEqual(structuredClone(vcs.getDirtyPaths()), ['/docs/a.md', '/docs/b.md']);
  assert.equal(renders.length, 2);
  vcs.markPathClean('/docs/a.md');
  assert.deepEqual(structuredClone(vcs.getDirtyPaths()), ['/docs/b.md']);
});

test('V1 VCS menu escapes paths, caps the visible dirty list and only copies a command', () => {
  const menuSource = source('src/vcs/menu.ts');
  const menu = executeTypeScript('src/vcs/menu.ts', {}, `
    Object.assign(globalThis, { __escapeVcsHtml: escapeVcsHtml, __vcsKindLabel: vcsKindLabel });
  `);
  assert.equal(menu.__escapeVcsHtml('<x a="&">'), '&lt;x a=&quot;&amp;&quot;&gt;');
  assert.equal(menu.__vcsKindLabel('git'), 'Git');
  assert.match(menuSource, /dirty\.slice\(0, 12\)/u);
  assert.match(menuSource, /dirty\.length - 12/u);
  assert.match(menuSource, /cd \/d "\$\{workspacePath\}" && git status/u);
  assert.doesNotMatch(menuSource, /invoke\([^)]*(?:git|svn)/iu);
});

test('V1 external-client helper chooses SourceGit, then TortoiseGit, then Explorer', () => {
  const script = source('scripts/open-vcs.ps1');
  const sourceGit = script.indexOf('SourceGit.exe');
  const tortoise = script.indexOf('TortoiseGitProc.exe');
  const explorer = script.indexOf('Start-Process explorer.exe');
  assert.ok(0 <= sourceGit && sourceGit < tortoise && tortoise < explorer);
  assert.match(script, /Start-Process -FilePath \$tortoiseProc -ArgumentList "\/command:log"/u);
});

test('V1 VCS has no repository status or diff execution implementation', () => {
  const combined = [
    source('src/vcs/repo.ts'),
    source('src/vcs/dirty.ts'),
    source('src/vcs/menu.ts'),
  ].join('\n');
  assert.doesNotMatch(combined, /\bgit\s+diff\b/iu);
  assert.doesNotMatch(combined, /\bsvn\s+(?:status|diff)\b/iu);
  assert.match(combined, /未保存/u);
});
