import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { transformSync } from 'esbuild';

const projectRoot = resolve(import.meta.dirname, '..', '..');

function fakeElement() {
  return {
    value: '',
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {},
    querySelector() { return null; },
    querySelectorAll() { return []; },
    focus() {},
  };
}

function createLegacyChatHarness(initialText) {
  let diskText = initialText;
  const elements = new Map();
  const document = {
    getElementById(id) {
      if (!elements.has(id)) { elements.set(id, fakeElement()); }
      return elements.get(id);
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    addEventListener() {},
  };
  const fileHandle = {
    getFile: async () => ({ text: async () => diskText }),
    createWritable: async () => ({
      write: async (text) => { diskText = text; },
      close: async () => {},
    }),
  };
  const context = vm.createContext({
    CHAT_PATH: '/Chat.md',
    CONFIG_PATH: '/.mdular/config.json',
    LATER_PATH: '/Later.md',
    WATCH_PATH: '/Watch.md',
    READ_PATH: '/Read.md',
    SHOP_PATH: '/Shop.md',
    document,
    window: {},
    files: {},
    isChat: false,
    currentEditor: null,
    getFileHandle: async () => fileHandle,
    write: async (_path, text) => { diskText = text; },
    setTimeout: () => 1,
  });
  context.globalThis = context;
  const source = readFileSync(resolve(projectRoot, 'src/chat/index.ts'), 'utf8') + [
    '',
    'Object.assign(globalThis, {',
    '  __parseMessagesFromChat: parseMessagesFromChat,',
    '  __saveMessagesToChat: saveMessagesToChat,',
    '  __toggleChatMessage: toggleChatMessage,',
    '  __moveFromChat: moveFromChat,',
    '});',
  ].join('\n');
  const compiled = transformSync(source, { loader: 'ts', target: 'es2020' }).code;
  vm.runInContext(compiled, context, { filename: 'src/chat/index.ts' });
  return { context, get text() { return diskText; } };
}

test('V1 Chat parses dated checklist blocks, completion and multiline text', async () => {
  const harness = createLegacyChatHarness([
    'ignored preamble',
    '#### 18 September, Friday',
    '- [ ] `09:05` first line',
    'continued',
    '- [X] done without time',
    '#### 19 September, Saturday',
    '- [ ] duplicate',
    '- [ ] duplicate',
    '',
  ].join('\r\n'));
  const parsed = await harness.context.__parseMessagesFromChat();
  assert.deepEqual(structuredClone(parsed.messages), [
    {
      index: 0,
      done: false,
      text: 'first line\ncontinued',
      timestamp: '09:05',
      date: '18 September, Friday',
    },
    {
      index: 1,
      done: true,
      text: 'done without time',
      timestamp: '',
      date: '18 September, Friday',
    },
    {
      index: 2,
      done: false,
      text: 'duplicate',
      timestamp: '',
      date: '19 September, Saturday',
    },
    {
      index: 3,
      done: false,
      text: 'duplicate',
      timestamp: '',
      date: '19 September, Saturday',
    },
  ]);
  assert.equal(parsed.text.includes('\r'), false);
});

test('V1 Chat serializes by date, toggles an exact line and moves one duplicate', async () => {
  const harness = createLegacyChatHarness([
    '#### 18 September, Friday',
    '- [ ] `09:05` first',
    '- [ ] duplicate',
    '- [ ] duplicate',
    '',
  ].join('\n'));
  await harness.context.__toggleChatMessage('09:05', 'first', true);
  assert.match(harness.text, /^- \[x\] `09:05` first$/mu);

  const archived = [];
  await harness.context.__moveFromChat('duplicate', async (text) => { archived.push(text); });
  assert.deepEqual(archived, ['duplicate']);
  assert.equal((harness.text.match(/duplicate/gu) ?? []).length, 1);

  await harness.context.__saveMessagesToChat([
    { done: false, text: 'a', timestamp: '10:00', date: 'Day A' },
    { done: true, text: 'b', timestamp: '', date: 'Day B' },
  ]);
  assert.equal(
    harness.text,
    '#### Day A\n- [ ] `10:00` a\n\n#### Day B\n- [x] b\n',
  );
});

test('V1 Chat owns two shortcuts and an enabled one-hour blur-to-open timer', () => {
  const appSource = readFileSync(resolve(projectRoot, 'src/app/index.ts'), 'utf8');
  assert.match(appSource, /const OPEN_CHAT_AFTER_IDLE = 60 \* 60 \* 1000/u);
  assert.match(appSource, /openChatIdleTimer = setTimeout\(\(\) => \{\s*openChat\(\);/u);
  assert.match(appSource, /event\.shiftKey && isMetaKey\(event\) && event\.key === 'Enter'/u);
  assert.match(appSource, /isMetaKey\(event\) && event\.key === 'Enter'/u);
});
