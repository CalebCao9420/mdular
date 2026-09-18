import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { createContext, runInContext } from 'node:vm';

const projectRoot = resolve(import.meta.dirname, '..', '..');

function loadCodeMirror() {
  const context = createContext({
    console,
    document: {
      body: {},
      createElement: () => ({
        setAttribute(name) { this[name] = () => {}; },
      }),
      documentElement: {},
    },
    navigator: { maxTouchPoints: 0, platform: '', userAgent: '', vendor: '' },
  });
  context.window = context;
  context.self = context;
  runInContext(
    readFileSync(resolve(projectRoot, 'web/lib/codemirror.js'), 'utf8'),
    context,
    { filename: 'web/lib/codemirror.js' },
  );
  return context.CodeMirror;
}

test('CodeMirror 5 linkedDoc shares content and undo history while keeping view state separate', () => {
  const CodeMirror = loadCodeMirror();
  const primary = new CodeMirror.Doc('alpha\nbeta\n', 'markdown');
  primary.clearHistory();
  const secondary = primary.linkedDoc({ sharedHist: true });

  primary.replaceRange('X', { line: 0, ch: 0 }, null, '+input');
  assert.equal(primary.getValue(), 'Xalpha\nbeta\n');
  assert.equal(secondary.getValue(), 'Xalpha\nbeta\n');
  secondary.undo();
  assert.equal(primary.getValue(), 'alpha\nbeta\n');
  assert.equal(secondary.getValue(), 'alpha\nbeta\n');
  primary.redo();
  assert.equal(primary.getValue(), 'Xalpha\nbeta\n');
  assert.equal(secondary.getValue(), 'Xalpha\nbeta\n');

  primary.setSelection({ line: 0, ch: 1 }, { line: 0, ch: 3 });
  secondary.setSelection({ line: 1, ch: 0 }, { line: 1, ch: 4 });
  assert.notDeepEqual(primary.listSelections(), secondary.listSelections());
  primary.scrollLeft = 5;
  primary.scrollTop = 25;
  secondary.scrollLeft = 35;
  secondary.scrollTop = 75;
  assert.deepEqual([primary.scrollLeft, primary.scrollTop], [5, 25]);
  assert.deepEqual([secondary.scrollLeft, secondary.scrollTop], [35, 75]);
});

test('CodeMirror 5 unlinkDoc stops propagation and splits shared history', () => {
  const CodeMirror = loadCodeMirror();
  const primary = new CodeMirror.Doc('shared\n', 'markdown');
  const secondary = primary.linkedDoc({ sharedHist: true });
  primary.replaceRange('before ', { line: 0, ch: 0 }, null, '+input');
  assert.equal(secondary.getValue(), 'before shared\n');

  primary.unlinkDoc(secondary);
  primary.replaceRange('after ', { line: 0, ch: 0 }, null, '+input');
  assert.equal(primary.getValue(), 'after before shared\n');
  assert.equal(secondary.getValue(), 'before shared\n');
  secondary.undo();
  assert.equal(primary.getValue(), 'after before shared\n');
});
