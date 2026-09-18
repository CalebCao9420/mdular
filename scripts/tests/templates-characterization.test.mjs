import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { transformSync } from 'esbuild';

const projectRoot = resolve(import.meta.dirname, '..', '..');

function createStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

function runLegacySource(relativePath, globals, appendedSource = '') {
  const context = vm.createContext({ ...globals });
  context.globalThis = context;
  const source = `${readFileSync(resolve(projectRoot, relativePath), 'utf8')}\n${appendedSource}`;
  const compiled = transformSync(source, { loader: 'ts', target: 'es2020' }).code;
  vm.runInContext(compiled, context, { filename: relativePath });
  return context;
}

test('V1 document templates characterize plain/frontmatter output and saved choice', () => {
  const NativeDate = Date;
  class FixedDate extends NativeDate {
    constructor(...args) {
      super(...(0 === args.length ? ['2026-09-18T05:30:00.000Z'] : args));
    }
  }
  const localStorage = createStorage();
  const templates = runLegacySource('src/templates/index.ts', {
    Date: FixedDate,
    appStorageKey: (key) => `mdular:${key}`,
    localStorage,
  });

  assert.equal(templates.buildPlainTemplateBody(), '');
  assert.equal(
    templates.buildFrontmatterTemplateBody('  My title\nextra  '),
    '---\nstatus: draft\ntitle: My title extra\ntags:\ndate: 2026-09-18\n---\n\n',
  );
  assert.equal(templates.getSavedTemplateChoice(), null);
  templates.saveTemplateChoice('frontmatter');
  assert.equal(templates.getSavedTemplateChoice(), 'frontmatter');
  templates.clearSavedTemplateChoice();
  assert.equal(templates.getSavedTemplateChoice(), null);
});

test('V1 project scaffold characterizes hard-coded docs-only and standard packages', () => {
  const scaffold = runLegacySource(
    'src/templates/project-structure.ts',
    {
      todayIsoDate: () => '2026-09-18',
      getKanbanBoardSeedJson: () => '{"board":true}',
      getKanbanTicketStatusesSeedJson: () => '{"statuses":true}',
    },
    'Object.assign(globalThis, { __getScaffoldItems: getScaffoldItems });',
  );
  const docsOnly = structuredClone(scaffold.__getScaffoldItems('docs-only'));
  assert.deepEqual(docsOnly.map(({ kind, path }) => ({ kind, path })), [
    { kind: 'dir', path: '/docs' },
    { kind: 'dir', path: '/docs/design' },
    { kind: 'file', path: '/docs/README.md' },
    { kind: 'file', path: '/docs/design/README.md' },
  ]);

  const standard = structuredClone(scaffold.__getScaffoldItems('standard'));
  assert.equal(standard.length, 10);
  assert.deepEqual(standard.slice(4).map(({ kind, path }) => ({ kind, path })), [
    { kind: 'dir', path: '/issues' },
    { kind: 'file', path: '/issues/ticket-statuses.json' },
    { kind: 'file', path: '/issues/ticket-board.json' },
    { kind: 'file', path: '/issues/README.md' },
    { kind: 'dir', path: '/changelog' },
    { kind: 'file', path: '/changelog/CHANGELOG.md' },
  ]);
  assert.equal(standard[5].content, '{"statuses":true}');
  assert.equal(standard[6].content, '{"board":true}');
  assert.match(standard[7].content, /date: 2026-09-18/u);
});

test('V1 project scaffold leaves earlier creations after a later operation fails', async () => {
  const created = [];
  const notFound = () => { throw new DOMException('missing', 'NotFoundError'); };
  const scaffold = runLegacySource(
    'src/templates/project-structure.ts',
    {
      DOMException,
      files: {},
      todayIsoDate: () => '2026-09-18',
      getKanbanBoardSeedJson: () => '{}',
      getKanbanTicketStatusesSeedJson: () => '{}',
      getRootDirHandle: async () => ({ getDirectoryHandle: async () => notFound() }),
      createDir: async (path) => {
        created.push(path);
        if (2 === created.length) { throw new Error('fixture failure'); }
      },
    },
    'Object.assign(globalThis, { __applyProjectScaffold: applyProjectScaffold });',
  );

  await assert.rejects(scaffold.__applyProjectScaffold('docs-only'), /fixture failure/u);
  assert.deepEqual(created, ['/docs', '/docs/design']);
});
