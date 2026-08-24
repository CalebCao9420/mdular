import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const projectRoot = resolve(import.meta.dirname, '..', '..');

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

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
    /\.cm-s-hypermd-light\.read-only-view pre\.HyperMD-table-row span\.cm-hmd-table-sep[\s\S]*?color:\s*transparent\s*!important/u,
  );
});
