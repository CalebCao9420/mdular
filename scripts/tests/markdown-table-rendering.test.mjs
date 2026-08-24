import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const projectRoot = resolve(import.meta.dirname, '..', '..');

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

function tokenizeHyperMd(lines) {
  const context = createContext({
    console,
    document: {
      body: {},
      createElement: () => ({
        setAttribute(name) {
          this[name] = () => {};
        },
      }),
      documentElement: {},
    },
    HyperMD: {},
    navigator: { maxTouchPoints: 0, platform: '', userAgent: '', vendor: '' },
  });
  context.window = context;
  context.self = context;

  for (const relativePath of ['web/lib/codemirror.js', 'web/lib/markdown.js', 'web/lib/hypermd.js']) {
    runInContext(readProjectFile(relativePath), context, { filename: relativePath });
  }

  const codeMirror = context.CodeMirror;
  const mode = codeMirror.getMode({ indentUnit: 2 }, { name: 'hypermd', table: true });
  const state = codeMirror.startState(mode);

  return lines.map((line, lineIndex) => {
    const stream = new codeMirror.StringStream(line, 4, {
      line: lineIndex,
      lookAhead(offset) {
        return lines[lineIndex + offset];
      },
    });
    const styles = [];
    while (!stream.eol()) {
      const tokenStart = stream.pos;
      const style = mode.token(stream, state) || '';
      assert.ok(stream.pos > tokenStart, `tokenizer did not advance on ${JSON.stringify(line)}`);
      styles.push({ style, text: stream.current() });
      stream.start = stream.pos;
    }
    return styles;
  });
}

test('HyperMD recognizes a valid final delimiter cell without requiring trailing whitespace', () => {
  for (const delimiter of [
    '|-----|-----|',
    '| ------ |------|',
    '| ------|------|',
    '|------ |------|',
    '|------ | ------|',
    '|-----| -----|',
    '|-----|------ |',
    '| ------ |------ |',
    '| :----- |-----:|',
  ]) {
    const [headerTokens, delimiterTokens, bodyTokens] = tokenizeHyperMd([
      '| Hotkey | Action |',
      delimiter,
      '| `[` | Insert a link to a file |',
    ]);
    for (const tokens of [headerTokens, delimiterTokens, bodyTokens]) {
      assert.equal(
        tokens.filter(({ style }) => style.split(/\s+/u).includes('hmd-table-sep')).length,
        3,
        delimiter,
      );
    }
    assert.match(delimiterTokens.map(({ style }) => style).join(' '), /line-HyperMD-table-row-1/u, delimiter);
    assert.match(bodyTokens.map(({ style }) => style).join(' '), /line-HyperMD-table-row-2/u, delimiter);
  }
});

test('HyperMD keeps an escaped pipe inside a table cell', () => {
  const [headerTokens] = tokenizeHyperMd([
    '| left \\| right | note |',
    '|---|---|',
  ]);
  assert.equal(
    headerTokens.filter(({ style }) => style.split(/\s+/u).includes('hmd-table-sep')).length,
    3,
  );
});

test('GFM table delimiter rows stay compact under the brutal theme', () => {
  const hypermdCss = readProjectFile('web/lib/hypermd.css');
  const lightTheme = readProjectFile('web/lib/theme-brutal.css');
  const darkTheme = readProjectFile('web/lib/theme-brutal-dark.css');

  for (const theme of [lightTheme, darkTheme]) {
    assert.match(theme, /\.cm-s-hypermd-light \.CodeMirror-line\s*\{[\s\S]*?line-height:\s*1\.9\s*!important/u);
    assert.match(theme, /pre\.HyperMD-hr\s*\{[\s\S]*?color:[^;}]+!important/u);
  }

  assert.match(
    hypermdCss,
    /pre\.HyperMD-table-row\.HyperMD-table-row-1\s*\{[\s\S]*?line-height:\s*8px\s*;/u,
  );
  assert.match(
    hypermdCss,
    /pre\.hmd-inactive-line\.HyperMD-table-row-1,\s*[\s\S]*?\.read-only-view pre\.HyperMD-table-row-1\s*\{[\s\S]*?line-height:\s*8px\s*!important/u,
  );
  assert.match(
    hypermdCss,
    /pre\.hmd-inactive-line\.HyperMD-table-row-1[\s\S]*?\.hmd-table-column-content[\s\S]*?color:\s*transparent\s*!important/u,
  );
});

test('read-only view never reveals a table delimiter through a stale cursor line', () => {
  const hypermdCss = readProjectFile('web/lib/hypermd.css');
  const readingSource = readProjectFile('src/reading/ui.ts');

  assert.match(readingSource, /classList\.toggle\('read-only-view', enabled\)/u);
  assert.match(
    hypermdCss,
    /\.cm-s-hypermd-light\.read-only-view pre\.HyperMD-table-row-1[\s\S]*?color:\s*transparent\s*!important/u,
  );
  assert.match(
    hypermdCss,
    /\.cm-s-hypermd-light\.read-only-view pre\.HyperMD-table-row-1 > span[\s\S]*?repeat-x 0px center/u,
  );
  assert.match(
    hypermdCss,
    /pre\.HyperMD-table-row span\.cm-hmd-table-sep\s*\{[\s\S]*?color:\s*transparent\s*!important/u,
  );
});
