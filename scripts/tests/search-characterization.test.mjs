import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { transformSync } from 'esbuild';

const projectRoot = resolve(import.meta.dirname, '..', '..');

function basename(path) {
  return path.split('/').filter(Boolean).at(-1) ?? '';
}

function directory(path) {
  const parts = path.split('/').filter(Boolean);
  parts.pop();
  return 0 === parts.length ? '/' : `/${parts.join('/')}`;
}

function frontmatter(text) {
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  if ('---' !== lines[0]) { return { meta: null }; }
  const meta = {};
  for (const line of lines.slice(1)) {
    if ('---' === line) { break; }
    const match = line.match(/^([a-z_.-]+):\s*(.*)$/iu);
    if (match) { meta[match[1].toLowerCase()] = match[2]; }
  }
  return { meta };
}

function createLegacySearchHarness() {
  const documents = new Map([
    ['/Roadmap.md', '---\nstatus: active\ntags: release urgent\n---\nship it'],
    ['/docs/Design.md', '---\nstatus: draft\nauthor: C\n---\narchitecture body'],
    ['/docs/Notes.md', 'plain body contains moonlight'],
    ['/archive/Roadmap old.md', 'old roadmap'],
    ['/Chat.md', 'private chat'],
  ]);
  const files = {
    'Roadmap.md': { isFile: true },
    'Chat.md': { isFile: true },
    'docs/': {
      'Design.md': { isFile: true },
      'Notes.md': { isFile: true },
    },
    'archive/': { 'Roadmap old.md': { isFile: true } },
  };
  const context = vm.createContext({
    CHAT_PATH: '/Chat.md',
    CONFIG_PATH: '/.mdular/config.json',
    files,
    getMemFile: (path) => ({ content: documents.get(path), lastModified: 0 }),
    joinPath: (...parts) => `/${parts.join('/').split('/').filter(Boolean).join('/')}`,
    parseFrontmatter: frontmatter,
    read: async (path) => documents.get(path),
    similarity: (left, right) => left.toLowerCase() === right.toLowerCase() ? 100 : 0,
    toDirPath: directory,
    toFilename: basename,
    toRootDirName: (path) => path.split('/').filter(Boolean)[0] ?? '',
    trimPostfix: (value, postfix) => value.endsWith(postfix)
      ? value.slice(0, -postfix.length)
      : value,
    walkFilesExcludingSystemDirs: (listener) => {
      for (const path of documents.keys()) { listener(path); }
    },
  });
  context.globalThis = context;
  const source = readFileSync(resolve(projectRoot, 'src/search/index.ts'), 'utf8');
  const compiled = transformSync(source, { loader: 'ts', target: 'es2020' }).code;
  vm.runInContext(compiled, context, { filename: 'src/search/index.ts' });
  return context;
}

test('V1 search query syntax characterizes browse, scope, tag and field tokens', () => {
  const search = createLegacySearchHarness();
  assert.deepEqual(
    structuredClone(search.parseSearchQuery('docs/')),
    { text: '', folderPath: null, filters: {}, browseFolder: 'docs/' },
  );
  assert.deepEqual(
    structuredClone(search.parseSearchQuery('roadmap in:docs status:active #urgent')),
    {
      text: 'roadmap',
      folderPath: '/docs',
      filters: { status: 'active', tags: 'urgent' },
      browseFolder: null,
    },
  );
  assert.deepEqual(
    structuredClone(search.parseSearchQuery('docs Design')),
    { text: 'design', folderPath: '/docs', filters: {}, browseFolder: null },
  );
});

test('V1 search scopes filenames and frontmatter while excluding Chat', async () => {
  const search = createLegacySearchHarness();
  assert.deepEqual(
    structuredClone(await search.performFileSearch('Roadmap')),
    [
      { path: '/Roadmap.md', score: 100 },
      { path: '/archive/Roadmap old.md', score: 13 },
    ],
  );
  assert.deepEqual(
    structuredClone(await search.performFileSearch('status:draft in:docs')),
    [{ path: '/docs/Design.md', score: 60 }],
  );
  assert.deepEqual(
    structuredClone(await search.performFileSearch('#urgent')),
    [{ path: '/Roadmap.md', score: 60 }],
  );
  assert.deepEqual(
    structuredClone(await search.performFileSearch('Chat')),
    [],
  );
});

test('V1 search does not search body text and folder browse returns direct files only', async () => {
  const search = createLegacySearchHarness();
  assert.deepEqual(structuredClone(await search.performFileSearch('moonlight')), []);
  assert.deepEqual(
    structuredClone(await search.performFileSearch('docs/')),
    [
      { path: '/docs/Design.md', score: 100 },
      { path: '/docs/Notes.md', score: 100 },
    ],
  );
});
