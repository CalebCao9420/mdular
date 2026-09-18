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

function loadKanbanModel() {
  const source = [
    'src/plugins/kanban/default-seeds.ts',
    'src/plugins/kanban/ticket-statuses.ts',
    'src/plugins/kanban/board-columns.ts',
    'src/plugins/kanban/frontmatter.ts',
    'src/plugins/kanban/board.ts',
  ].map(readProjectFile).join('\n');
  const appended = `
    Object.assign(globalThis, {
      __validateStatuses: validateTicketStatusConfig,
      __syncStatuses: syncTicketStatusGlobals,
      __validateColumns: validateBoardColumnConfig,
      __syncColumns: syncBoardColumnGlobals,
      __groupByColumn: groupCardsByColumn,
      __groupByStatus: groupCardsByStatus,
      __matchesFilter: matchesKanbanFilter,
      __parseTags: parseCardTags,
      __resolveColumn: resolveCardColumnId,
      __isCardDraggable: isCardDraggable,
      __setField: setFrontmatterField,
      __removeField: removeFrontmatterField,
      __buildTask: buildTaskFrontmatter,
    });
  `;
  const context = vm.createContext({
    appStorageKey: (key) => `fixture:${key}`,
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    todayIsoDate: () => '2026-09-18',
  });
  context.globalThis = context;
  const compiled = transformSync(`${source}\n${appended}`, {
    loader: 'ts',
    target: 'es2020',
  }).code;
  vm.runInContext(compiled, context, { filename: 'legacy-kanban.ts' });
  return context;
}

test('V1 Kanban validates status and column configs, aliases labels and resolves column precedence', () => {
  const model = loadKanbanModel();
  const statuses = model.__validateStatuses({
    version: 99,
    defaultStatus: 'missing',
    statuses: [
      { id: 'todo', label: '待办', unknown: 'discarded' },
      { id: 'doing', label: '进行中' },
      { id: 'todo', label: 'duplicate' },
      { id: '', label: 'invalid' },
    ],
  });
  assert.deepEqual(structuredClone(statuses), {
    version: 1,
    defaultStatus: 'todo',
    statuses: [
      { id: 'todo', label: '待办' },
      { id: 'doing', label: '进行中' },
    ],
  });
  model.__syncStatuses(statuses);
  assert.equal(model.normalizeTicketStatus('进行中'), 'doing');
  assert.equal(model.normalizeTicketStatus('custom'), 'custom');

  const columns = model.__validateColumns({
    version: 8,
    columns: [
      { id: 'manual', label: 'Inbox', statusId: null, locked: false },
      { id: 'doing-column', label: 'Doing', statusId: 'doing', locked: true },
      { id: 'duplicate-link', label: 'Duplicate', statusId: 'doing', locked: false },
    ],
  });
  assert.deepEqual(structuredClone(columns), {
    version: 1,
    columns: [
      { id: 'manual', label: 'Inbox', statusId: null, locked: false },
      { id: 'doing-column', label: 'Doing', statusId: 'doing', locked: true },
    ],
  });
  model.__syncColumns(columns);
  assert.equal(model.__resolveColumn('doing', 'manual'), 'doing-column');
  assert.equal(model.__resolveColumn('todo', 'manual'), 'manual');
});

test('V1 Kanban frontmatter mutations preserve body and unknown lines but rewrite one known scalar', () => {
  const model = loadKanbanModel();
  const source = [
    '---',
    'title: Original',
    'custom: keep',
    'boardColumn: manual',
    '---',
    '',
    '# Body',
  ].join('\n');
  const changed = model.__setField(source, 'status', 'doing');
  assert.match(changed, /custom: keep/u);
  assert.match(changed, /status: doing/u);
  assert.match(changed, /# Body$/u);
  assert.doesNotMatch(model.__removeField(changed, 'boardColumn'), /boardColumn:/u);
  assert.equal(
    model.__setField('# Plain', 'status', 'todo'),
    '---\nstatus: todo\n---\n\n# Plain',
  );
  assert.equal(
    model.__buildTask('新工单', 'todo'),
    '---\nstatus: todo\ntitle: 新工单\npriority: medium\nassignee:\ntags:\ndate: 2026-09-18\n---\n\n## 描述\n\n',
  );
});

test('V1 Kanban filters exact assignee and priority, partial tag, and groups configured or orphan cards', () => {
  const model = loadKanbanModel();
  const statuses = model.__validateStatuses({
    defaultStatus: 'todo',
    statuses: [{ id: 'todo', label: '待办' }, { id: 'doing', label: '进行中' }],
  });
  model.__syncStatuses(statuses);
  const columns = model.__validateColumns({
    columns: [
      { id: 'manual', label: 'Inbox', statusId: null, locked: false },
      { id: 'doing-column', label: 'Doing', statusId: 'doing', locked: false },
    ],
  });
  model.__syncColumns(columns);
  const base = {
    path: '/issues/a.md',
    statusId: 'todo',
    statusLabel: '待办',
    title: 'A',
    assignee: 'Moon',
    priority: 'High',
    tags: 'UI, release-candidate',
    date: '2026-09-18',
    configured: true,
    boardColumn: 'manual',
    columnId: 'manual',
    statusAssociated: false,
  };
  assert.equal(model.__matchesFilter(base, {
    assignee: 'moon', priority: 'high', tag: 'release',
  }), true);
  assert.equal(model.__matchesFilter(base, {
    assignee: 'other', priority: '', tag: '',
  }), false);
  assert.deepEqual(Array.from(model.__parseTags('UI, 测试 release')), ['ui', '测试', 'release']);
  assert.deepEqual(
    structuredClone(model.__groupByColumn([
      base,
      { ...base, path: '/issues/b.md', statusId: 'doing', columnId: 'doing-column' },
    ]).sections.map(({ column, cards }) => [column.id, cards.map(({ path }) => path)])),
    [
      ['manual', ['/issues/a.md']],
      ['doing-column', ['/issues/b.md']],
    ],
  );
  const statusSections = model.__groupByStatus([
    base,
    { ...base, path: '/issues/orphan.md', configured: false, statusId: 'custom' },
  ]).sections;
  assert.equal(statusSections.at(-1).status, null);
  assert.equal(statusSections.at(-1).cards[0].path, '/issues/orphan.md');
});

test('V1 Kanban drag lifecycle permits only unlocked manual cards and maps drops through frontmatter', () => {
  const model = loadKanbanModel();
  const card = { statusAssociated: false };
  assert.equal(model.__isCardDraggable(card, { locked: false }), true);
  assert.equal(model.__isCardDraggable({ statusAssociated: true }, { locked: false }), false);
  assert.equal(model.__isCardDraggable(card, { locked: true }), false);

  const boardSource = readProjectFile('src/plugins/kanban/board.ts');
  assert.match(boardSource, /dragstart[\s\S]*?dataTransfer\?\.setData\('text\/plain', card\.path\)/u);
  assert.match(boardSource, /dragend[\s\S]*?dragCardPath = null/u);
  assert.match(boardSource, /targetColumn\.statusId[\s\S]*?changeTaskStatus\(path, targetColumn\.statusId, \{ clearBoardColumn: true \}\)/u);
  assert.match(boardSource, /changeTaskBoardColumn\(path, targetColumn\.id\)/u);
});

test('V1 Kanban exposes board/list, filter presets, status/column editing and Chat To Issues', () => {
  const boardSource = readProjectFile('src/plugins/kanban/board.ts');
  const archiveSource = readProjectFile('src/plugins/kanban/chat-archive.ts');
  assert.match(boardSource, /type TicketLayoutMode = 'board' \| 'list'/u);
  assert.match(boardSource, /KANBAN_FILTER_PRESETS_KEY/u);
  assert.match(boardSource, /writeTicketStatuses\(\{ version: 1, defaultStatus, statuses \}\)/u);
  assert.match(boardSource, /writeBoardColumns\(\{ version: 1, columns \}\)/u);
  assert.match(archiveSource, /id: 'kanban-issues'[\s\S]*?label: 'To Issues'/u);
  assert.match(archiveSource, /buildTaskFrontmatter\(title, defaultStatus\)/u);
});
