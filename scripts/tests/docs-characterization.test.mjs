import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { transformSync } from 'esbuild';

const projectRoot = resolve(import.meta.dirname, '..', '..');

function runLegacy(relativePath, globals = {}, appendedSource = '') {
  const context = vm.createContext({ ...globals });
  context.globalThis = context;
  const source = `${readFileSync(resolve(projectRoot, relativePath), 'utf8')}\n${appendedSource}`;
  const compiled = transformSync(source, { loader: 'ts', target: 'es2020' }).code;
  vm.runInContext(compiled, context, { filename: relativePath });
  return context;
}

test('V1 Docs frontmatter reading scans twenty lines and leaves source text intact', () => {
  const reading = runLegacy('src/reading/parse.ts');
  const source = [
    'preface',
    '---',
    'title: "Moon: notes"',
    "status: 'ready'",
    'nested:',
    '  child: ignored',
    '---',
    '# Body',
  ].join('\n');
  const parsed = reading.parseFrontmatter(source);
  assert.deepEqual(structuredClone(parsed.meta), {
    title: 'Moon: notes',
    status: 'ready',
    nested: '',
  });
  assert.equal(parsed.body, source);

  const tooLate = `${'line\n'.repeat(20)}---\nstatus: ignored\n---\n`;
  assert.equal(reading.parseFrontmatter(tooLate).meta, null);
  assert.equal(reading.parseFrontmatter('---\nstatus: open').meta, null);
});

test('V1 Docs headings ignore fenced code and preserve source line navigation', () => {
  const reading = runLegacy('src/reading/parse.ts');
  const headings = reading.parseHeadings([
    '# Title',
    '```md',
    '## Not an outline entry',
    '```',
    '### Section ###',
    '#### Linked [#](#section)',
    '###### Tail',
  ].join('\n'));
  assert.deepEqual(structuredClone(headings), [
    { level: 1, text: 'Title', line: 0 },
    { level: 3, text: 'Section', line: 4 },
    { level: 4, text: 'Linked', line: 5 },
    { level: 6, text: 'Tail', line: 6 },
  ]);
});

test('V1 Chat To Docs archive derives a bounded title and stable frontmatter shape', () => {
  const docs = runLegacy(
    'src/plugins/docs/chat-archive.ts',
    {
      files: { 'docs/': {} },
      todayIsoDate: () => '2026-09-18',
      sanitizeFilename: (value) => value.replaceAll('/', '-'),
      extractHeaderAndBody: () => ['Title', 'Body'],
      exists: async () => false,
      joinPath: (...parts) => parts.join('/').replaceAll('//', '/'),
      write: async () => {},
      confirm: () => false,
      scaffoldProjectDocs: async () => {},
      loadLocalFiles: async () => ({}),
      getRootDirHandle: async () => ({}),
    },
    'Object.assign(globalThis, { __buildDocFrontmatter: buildDocFrontmatter, __titleMax: DOCS_ARCHIVE_TITLE_MAX });',
  );
  assert.equal(docs.__titleMax, 100);
  assert.equal(
    docs.__buildDocFrontmatter('Title', '  Body\n'),
    '---\ntitle: Title\ndate: 2026-09-18\ntags:\n---\n\nBody\n',
  );
});
