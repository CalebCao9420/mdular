import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { transformSync } from 'esbuild';

const projectRoot = resolve(import.meta.dirname, '..', '..');

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

function runLegacyEditor(appendedSource = '') {
  const context = vm.createContext({ console });
  context.globalThis = context;
  context.window = context;
  const source = `${readProjectFile('src/editor/index.ts')}\n${appendedSource}`;
  const compiled = transformSync(source, { loader: 'ts', target: 'es2020' }).code;
  vm.runInContext(compiled, context, { filename: 'src/editor/index.ts' });
  return context;
}

test('V1 Extended Markdown inserts one fixed GFM table and moves into its body', () => {
  const editor = runLegacyEditor(
    'Object.assign(globalThis, { __insertGfmTable: insertGfmTable });',
  );
  const calls = [];
  const cm = {
    getCursor: () => ({ line: 4, ch: 3 }),
    replaceRange: (text, cursor) => calls.push(['replace', text, cursor]),
    setCursor: (cursor) => calls.push(['cursor', cursor]),
    focus: () => calls.push(['focus']),
  };
  editor.__insertGfmTable(cm);
  assert.deepEqual(structuredClone(calls), [
    [
      'replace',
      '| Column | Column |\n| ------ | ------ |\n|        |        |\n',
      { line: 4, ch: 3 },
    ],
    ['cursor', { line: 6, ch: 2 }],
    ['focus'],
  ]);
});
test('V1 editor enables math, Mermaid, emoji/wiki completion, code modes and table alignment globally', () => {
  const source = readProjectFile('src/editor/index.ts');
  const runtime = readProjectFile('src/runtime/runtime-bootstrap.ts');
  assert.match(source, /mode:\s*\{[\s\S]*?name:\s*'hypermd',[\s\S]*?math:\s*true/u);
  assert.match(source, /hint:\s*CompleteEmoji\.createHintFunc\(\)/u);
  assert.match(source, /hmdFoldMath:\s*\{[\s\S]*?renderer:\s*KatexRenderer/u);
  assert.match(source, /hmdFoldCode:\s*\{\s*mermaid:\s*true\s*\}/u);
  assert.match(source, /hmdTableAlign:\s*true/u);
  assert.match(source, /'Cmd-Shift-T':\s*insertGfmTable/u);
  assert.match(runtime, /'lib\/codemirror-(?:go|python|javascript|php|shell)\.js'/u);

  const completion = readProjectFile('web/lib/autocomplete-link.js');
  assert.match(completion, /isWiki[\s\S]*?key \+ '\]\]'/u);
  assert.match(source, /path \+= '\.md'/u);
});

test('V1 Mermaid is lazy and falls back to source, but its raw SVG insertion is not a V2 security contract', () => {
  const source = readProjectFile('web/lib/hypermd-mermaid.js');
  assert.match(source, /s\.src = 'lib\/mermaid\.min\.js'/u);
  assert.match(source, /mermaidLoad/u);
  assert.match(source, /securityLevel:\s*'loose'/u);
  assert.match(source, /el\.innerHTML = svgCode/u);
  assert.match(source, /el\.textContent = code/u);
});
