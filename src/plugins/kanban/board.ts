/// <reference path="../../types/global.d.ts" />

interface TaskCard {
  path: string;
  statusId: string;
  statusLabel: string;
  title: string;
  assignee: string;
  priority: string;
  tags: string;
  date: string;
  configured: boolean;
  boardColumn: string;
  columnId: string;
  statusAssociated: boolean;
}

const KANBAN_TASK_DIRS = ['/issues'];
const KANBAN_STORAGE_KEY = 'mdToolkitKanbanOpen';
const KANBAN_LAYOUT_KEY = 'mdToolkitTicketLayout';
const KANBAN_FILTER_KEY = 'mdToolkitKanbanFilter';
const KANBAN_FILTER_PRESETS_KEY = 'mdToolkitKanbanFilterPresets';

interface KanbanFilter {
  assignee: string;
  tag: string;
  priority: string;
}

interface KanbanFilterPreset {
  name: string;
  filter: KanbanFilter;
}

type TicketLayoutMode = 'board' | 'list';

let kanbanLoading = false;
let isKanban = false;
let lastKanbanCards: TaskCard[] = [];
let statusEditorDraft: TicketStatusDef[] = [];
let columnEditorDraft: BoardColumnDef[] = [];
let dragCardPath: string | null = null;

function getTicketLayoutMode(): TicketLayoutMode {
  return localStorage.getItem(KANBAN_LAYOUT_KEY) === 'list' ? 'list' : 'board';
}

function setTicketLayoutMode(mode: TicketLayoutMode): void {
  localStorage.setItem(KANBAN_LAYOUT_KEY, mode);
  updateTicketLayoutToggle();
  applyTicketLayoutVisibility();
}

function updateTicketLayoutToggle(): void {
  const btn = document.getElementById('kanban-toggle-layout');
  if (!btn) {
    return;
  }
  const isList = getTicketLayoutMode() === 'list';
  btn.textContent = isList ? '看板视图' : '列表视图';
  btn.setAttribute('aria-pressed', isList ? 'true' : 'false');
}

function applyTicketLayoutVisibility(): void {
  const board = document.getElementById('ticket-board');
  const list = document.getElementById('ticket-list');
  const isList = getTicketLayoutMode() === 'list';
  if (board) {
    board.style.display = isList ? 'none' : 'flex';
  }
  if (list) {
    list.style.display = isList ? 'flex' : 'none';
  }
}

function kanbanDirExists(): boolean {
  return !!files['issues/'];
}

function isKanbanTaskPath(path: string): boolean {
  if (!path.endsWith('.md')) {
    return false;
  }
  if (path.endsWith('/README.md')) {
    return false;
  }
  if (path === TICKET_STATUSES_PATH || path === TICKET_BOARD_PATH) {
    return false;
  }
  const dir = toDirPath(path);
  return KANBAN_TASK_DIRS.some((scope) => dir === scope || dir.startsWith(scope + '/'));
}

async function readTaskFileContent(path: string): Promise<string | null> {
  const mem = getMemFile(path);
  if (mem?.content != null && typeof mem.content === 'string') {
    return mem.content;
  }
  try {
    return await read(path);
  } catch {
    return null;
  }
}

async function loadTaskCards(): Promise<TaskCard[]> {
  await loadTicketStatuses();
  await loadBoardColumns();
  const paths: string[] = [];
  walk(files, (path, isFile) => {
    if (!isFile || !isKanbanTaskPath(path)) {
      return;
    }
    paths.push(path);
  });

  const cards: TaskCard[] = [];
  for (const path of paths) {
    const text = await readTaskFileContent(path);
    if (text == null) {
      continue;
    }
    const { meta } = parseFrontmatter(text);
    const statusId = normalizeTicketStatus(meta?.status);
    const status = getTicketStatus(statusId);
    const boardColumn = (meta?.boardColumn || '').trim();
    const statusAssociated = isStatusAssociated(statusId);
    const columnId = resolveCardColumnId(statusId, boardColumn);
    cards.push({
      path,
      statusId,
      statusLabel: status?.label || statusId,
      title: (meta?.title || trimPostfix(toFilename(path), '.md')).trim(),
      assignee: (meta?.assignee || '').trim(),
      priority: (meta?.priority || '').trim(),
      tags: (meta?.tags || '').trim(),
      date: (meta?.date || '').trim(),
      configured: isConfiguredTicketStatus(statusId),
      boardColumn,
      columnId,
      statusAssociated,
    });
  }

  cards.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  return cards;
}

function resolveCardColumnId(statusId: string, boardColumn: string): string {
  const linked = getBoardColumnForStatus(statusId);
  if (linked) {
    return linked.id;
  }
  if (boardColumn && getBoardColumn(boardColumn)) {
    return boardColumn;
  }
  const columns = getBoardColumns();
  const firstManual = columns.find((c) => !c.statusId);
  if (firstManual) {
    return firstManual.id;
  }
  return columns[0]?.id || 'col-unknown';
}

function hideEditorForKanban(): void {
  const codemirror = document.querySelector('.CodeMirror-wrap') as HTMLElement | null;
  if (codemirror) {
    codemirror.style.display = 'none';
  }
  const editorContainer = document.getElementById('editor-container');
  if (editorContainer) {
    editorContainer.style.display = 'none';
  }
  hideEditor2();
}

function showEditorFromKanban(): void {
  const editorContainer = document.getElementById('editor-container');
  if (editorContainer) {
    editorContainer.style.display = 'flex';
  }
  const codemirror = document.querySelector('.CodeMirror-wrap') as HTMLElement | null;
  if (codemirror) {
    codemirror.style.display = 'block';
  }
}

function groupCardsByColumn(cards: TaskCard[]): {
  sections: Array<{ column: BoardColumnDef; cards: TaskCard[] }>;
} {
  const byId = new Map<string, TaskCard[]>();
  for (const column of getBoardColumns()) {
    byId.set(column.id, []);
  }

  for (const card of cards) {
    const list = byId.get(card.columnId);
    if (list) {
      list.push(card);
    } else if (getBoardColumns().length) {
      const fallback = getBoardColumns()[0].id;
      byId.get(fallback)?.push(card);
    }
  }

  const sections: Array<{ column: BoardColumnDef; cards: TaskCard[] }> = [];
  for (const column of getBoardColumns()) {
    sections.push({ column, cards: byId.get(column.id) || [] });
  }
  return { sections };
}

function groupCardsByStatus(cards: TaskCard[]): {
  sections: Array<{ status: TicketStatusDef | null; cards: TaskCard[] }>;
} {
  const byId = new Map<string, TaskCard[]>();
  for (const status of getTicketStatuses()) {
    byId.set(status.id, []);
  }

  const orphan: TaskCard[] = [];
  for (const card of cards) {
    if (!card.configured) {
      orphan.push(card);
      continue;
    }
    const list = byId.get(card.statusId);
    if (list) {
      list.push(card);
    } else {
      orphan.push(card);
    }
  }

  const sections: Array<{ status: TicketStatusDef | null; cards: TaskCard[] }> = [];
  for (const status of getTicketStatuses()) {
    sections.push({ status, cards: byId.get(status.id) || [] });
  }
  if (orphan.length) {
    sections.push({ status: null, cards: orphan });
  }
  return { sections };
}

function normalizePriorityClass(priority: string): string {
  return priority
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '');
}

function appendCardMeta(parent: HTMLElement, card: TaskCard): void {
  const tags = parseCardTags(card.tags);
  const hasMeta = card.assignee || card.priority || card.date || tags.length;
  if (!hasMeta) {
    return;
  }

  const meta = document.createElement('div');
  meta.className = 'ticket-card-meta';

  if (card.assignee || card.priority || card.date) {
    const row = document.createElement('div');
    row.className = 'ticket-card-meta-row';

    if (card.assignee) {
      const el = document.createElement('span');
      el.className = 'ticket-meta-assignee';
      el.textContent = card.assignee;
      el.title = '负责人';
      row.appendChild(el);
    }

    if (card.priority) {
      const el = document.createElement('span');
      el.className = 'ticket-meta-priority ticket-meta-priority--' + normalizePriorityClass(card.priority);
      el.textContent = card.priority;
      el.title = '优先级';
      row.appendChild(el);
    }

    if (card.date) {
      const el = document.createElement('span');
      el.className = 'ticket-meta-date';
      el.textContent = card.date;
      el.title = '日期';
      row.appendChild(el);
    }

    meta.appendChild(row);
  }

  if (tags.length) {
    const tagsEl = document.createElement('div');
    tagsEl.className = 'ticket-card-meta-tags';
    for (const tag of tags) {
      const chip = document.createElement('span');
      chip.className = 'ticket-meta-tag';
      chip.textContent = tag;
      tagsEl.appendChild(chip);
    }
    meta.appendChild(tagsEl);
  }

  parent.appendChild(meta);
}

function parseCardTags(raw: string): string[] {
  return raw
    .split(/[,，\s]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
}

function getKanbanFilter(): KanbanFilter {
  try {
    const raw = localStorage.getItem(KANBAN_FILTER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as KanbanFilter;
      return {
        assignee: (parsed.assignee || '').trim(),
        tag: (parsed.tag || '').trim(),
        priority: (parsed.priority || '').trim(),
      };
    }
  } catch {
    // ignore
  }
  return { assignee: '', tag: '', priority: '' };
}

function setKanbanFilter(filter: KanbanFilter): void {
  localStorage.setItem(KANBAN_FILTER_KEY, JSON.stringify(filter));
}

function getKanbanFilterPresets(): KanbanFilterPreset[] {
  try {
    const raw = localStorage.getItem(KANBAN_FILTER_PRESETS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as KanbanFilterPreset[];
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item) => item && typeof item.name === 'string' && item.filter)
      .map((item) => ({
        name: item.name.trim(),
        filter: {
          assignee: (item.filter.assignee || '').trim(),
          tag: (item.filter.tag || '').trim(),
          priority: (item.filter.priority || '').trim(),
        },
      }))
      .filter((item) => item.name);
  } catch {
    return [];
  }
}

function saveKanbanFilterPresets(presets: KanbanFilterPreset[]): void {
  localStorage.setItem(KANBAN_FILTER_PRESETS_KEY, JSON.stringify(presets));
}

function saveCurrentKanbanFilterPreset(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) {
    return;
  }
  const filter = readKanbanFilterFromUI();
  const presets = getKanbanFilterPresets().filter((p) => p.name !== trimmed);
  presets.push({ name: trimmed, filter });
  presets.sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));
  saveKanbanFilterPresets(presets);
  syncKanbanFilterPresetUI(trimmed);
}

function deleteSelectedKanbanFilterPreset(): void {
  const select = document.getElementById('kanban-filter-preset') as HTMLSelectElement | null;
  const name = (select?.value || '').trim();
  if (!name) {
    return;
  }
  if (!confirm(`删除筛选预设「${name}」？`)) {
    return;
  }
  const presets = getKanbanFilterPresets().filter((p) => p.name !== name);
  saveKanbanFilterPresets(presets);
  syncKanbanFilterPresetUI('');
}

function applyKanbanFilterPreset(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) {
    return;
  }
  const preset = getKanbanFilterPresets().find((p) => p.name === trimmed);
  if (!preset) {
    return;
  }
  setKanbanFilter(preset.filter);
  renderFilteredKanban();
}

function syncKanbanFilterPresetUI(selectedName = ''): void {
  const select = document.getElementById('kanban-filter-preset') as HTMLSelectElement | null;
  if (!select) {
    return;
  }
  const presets = getKanbanFilterPresets();
  const current = selectedName || select.value;
  select.innerHTML = '<option value="">筛选预设</option>';
  for (const preset of presets) {
    const opt = document.createElement('option');
    opt.value = preset.name;
    opt.textContent = preset.name;
    if (preset.name === current) {
      opt.selected = true;
    }
    select.appendChild(opt);
  }
}

function promptSaveKanbanFilterPreset(): void {
  const name = prompt('为当前筛选命名：', '');
  if (name == null) {
    return;
  }
  saveCurrentKanbanFilterPreset(name);
  showToast('已保存筛选预设');
}

function readKanbanFilterFromUI(): KanbanFilter {
  const assigneeEl = document.getElementById('kanban-filter-assignee') as HTMLSelectElement | null;
  const tagEl = document.getElementById('kanban-filter-tag') as HTMLInputElement | null;
  const priorityEl = document.getElementById('kanban-filter-priority') as HTMLSelectElement | null;
  return {
    assignee: (assigneeEl?.value || '').trim(),
    tag: (tagEl?.value || '').trim(),
    priority: (priorityEl?.value || '').trim(),
  };
}

function matchesKanbanFilter(card: TaskCard, filter: KanbanFilter): boolean {
  if (filter.assignee && card.assignee.toLowerCase() !== filter.assignee.toLowerCase()) {
    return false;
  }
  if (filter.priority && card.priority.toLowerCase() !== filter.priority.toLowerCase()) {
    return false;
  }
  if (filter.tag) {
    const needle = filter.tag.toLowerCase();
    const tags = parseCardTags(card.tags);
    if (!tags.some((t) => t === needle || t.includes(needle))) {
      return false;
    }
  }
  return true;
}

function applyKanbanFilter(cards: TaskCard[], filter: KanbanFilter): TaskCard[] {
  const active = filter.assignee || filter.tag || filter.priority;
  if (!active) {
    return cards;
  }
  return cards.filter((card) => matchesKanbanFilter(card, filter));
}

function collectKanbanFilterValues(cards: TaskCard[]): {
  assignees: string[];
  priorities: string[];
  tags: string[];
} {
  const assigneeSet = new Set<string>();
  const prioritySet = new Set<string>();
  const tagSet = new Set<string>();
  for (const card of cards) {
    if (card.assignee) {
      assigneeSet.add(card.assignee);
    }
    if (card.priority) {
      prioritySet.add(card.priority);
    }
    for (const tag of parseCardTags(card.tags)) {
      tagSet.add(tag);
    }
  }
  const sortZh = (a: string, b: string) => a.localeCompare(b, 'zh-CN');
  return {
    assignees: Array.from(assigneeSet).sort(sortZh),
    priorities: Array.from(prioritySet).sort(sortZh),
    tags: Array.from(tagSet).sort(sortZh),
  };
}

function syncKanbanFilterUI(cards: TaskCard[]): void {
  const filter = getKanbanFilter();
  const { assignees, priorities, tags } = collectKanbanFilterValues(cards);

  const assigneeEl = document.getElementById('kanban-filter-assignee') as HTMLSelectElement | null;
  if (assigneeEl) {
    const current = filter.assignee;
    assigneeEl.innerHTML = '<option value="">全部负责人</option>';
    for (const name of assignees) {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      if (name === current) {
        opt.selected = true;
      }
      assigneeEl.appendChild(opt);
    }
  }

  const priorityEl = document.getElementById('kanban-filter-priority') as HTMLSelectElement | null;
  if (priorityEl) {
    const current = filter.priority;
    priorityEl.innerHTML = '<option value="">全部优先级</option>';
    for (const p of priorities) {
      const opt = document.createElement('option');
      opt.value = p;
      opt.textContent = p;
      if (p === current) {
        opt.selected = true;
      }
      priorityEl.appendChild(opt);
    }
  }

  const tagList = document.getElementById('kanban-tag-suggestions');
  if (tagList) {
    tagList.innerHTML = '';
    for (const tag of tags) {
      const opt = document.createElement('option');
      opt.value = tag;
      tagList.appendChild(opt);
    }
  }

  const tagEl = document.getElementById('kanban-filter-tag') as HTMLInputElement | null;
  if (tagEl && tagEl.value !== filter.tag) {
    tagEl.value = filter.tag;
  }

  syncKanbanFilterPresetUI();
}

function updateKanbanFilterSummary(shown: number, total: number): void {
  const el = document.getElementById('kanban-filter-summary');
  if (!el) {
    return;
  }
  const filter = getKanbanFilter();
  const active = filter.assignee || filter.tag || filter.priority;
  if (!active || shown === total) {
    el.textContent = total ? `${total} 个工单` : '';
  } else {
    el.textContent = `显示 ${shown} / ${total}`;
  }
}

function renderFilteredKanban(): void {
  const filter = getKanbanFilter();
  const filtered = applyKanbanFilter(lastKanbanCards, filter);
  syncKanbanFilterUI(lastKanbanCards);
  applyTicketLayoutVisibility();
  renderTickets(filtered);
  updateKanbanFilterSummary(filtered.length, lastKanbanCards.length);
}

function onKanbanFilterChange(): void {
  const filter = readKanbanFilterFromUI();
  setKanbanFilter(filter);
  renderFilteredKanban();
}

function clearKanbanFilter(): void {
  setKanbanFilter({ assignee: '', tag: '', priority: '' });
  const tagEl = document.getElementById('kanban-filter-tag') as HTMLInputElement | null;
  if (tagEl) {
    tagEl.value = '';
  }
  syncKanbanFilterPresetUI('');
  renderFilteredKanban();
}

function buildStatusSelect(card: TaskCard): HTMLSelectElement {
  const select = document.createElement('select');
  select.className = 'ticket-card-status';
  select.title = '变更状态';
  for (const status of getTicketStatuses()) {
    const opt = document.createElement('option');
    opt.value = status.id;
    opt.textContent = status.label;
    if (status.id === card.statusId || status.label === card.statusLabel) {
      opt.selected = true;
    }
    select.appendChild(opt);
  }
  if (!card.configured) {
    const opt = document.createElement('option');
    opt.value = card.statusId;
    opt.textContent = card.statusLabel + '（未配置）';
    opt.selected = true;
    select.insertBefore(opt, select.firstChild);
  }
  select.addEventListener('change', () => {
    void changeTaskStatus(card.path, select.value);
  });
  return select;
}

function renderTickets(cards: TaskCard[]): void {
  if (getTicketLayoutMode() === 'list') {
    renderTicketList(cards);
  } else {
    renderTicketBoard(cards);
  }
}

function renderTicketBoard(cards: TaskCard[]): void {
  const board = document.getElementById('ticket-board');
  if (!board) {
    return;
  }
  board.innerHTML = '';

  const { sections } = groupCardsByColumn(cards);
  for (const section of sections) {
    board.appendChild(createBoardColumn(section.column, section.cards));
  }
}

function isCardDraggable(card: TaskCard, column: BoardColumnDef): boolean {
  if (column.locked) {
    return false;
  }
  if (card.statusAssociated) {
    return false;
  }
  return true;
}

function createBoardColumn(column: BoardColumnDef, cards: TaskCard[]): HTMLElement {
  const el = document.createElement('section');
  el.className = 'ticket-board-column';
  el.dataset.column = column.id;
  if (column.statusId) {
    el.classList.add('ticket-board-column-linked');
    el.dataset.status = column.statusId;
  }
  if (column.locked) {
    el.classList.add('ticket-board-column-locked');
  }

  const header = document.createElement('div');
  header.className = 'ticket-board-column-header';
  const linkHint = column.statusId
    ? `<span class="ticket-board-column-link" title="关联状态">↔</span>`
    : '';
  header.innerHTML =
    `<span class="ticket-board-column-label">${escapeHtml(column.label)}</span>${linkHint}`;
  el.appendChild(header);

  const body = document.createElement('div');
  body.className = 'ticket-board-column-cards';
  setupColumnDropZone(body, column);

  for (const card of cards) {
    body.appendChild(createBoardCard(card, column));
  }

  el.appendChild(body);
  return el;
}

function setupColumnDropZone(body: HTMLElement, column: BoardColumnDef): void {
  body.addEventListener('dragover', (e) => {
    if (column.locked) {
      return;
    }
    e.preventDefault();
    body.classList.add('ticket-board-column-dragover');
  });
  body.addEventListener('dragleave', () => {
    body.classList.remove('ticket-board-column-dragover');
  });
  body.addEventListener('drop', (e) => {
    e.preventDefault();
    body.classList.remove('ticket-board-column-dragover');
    if (column.locked || !dragCardPath) {
      return;
    }
    void handleBoardDrop(dragCardPath, column);
    dragCardPath = null;
  });
}

function setupCardDrag(cardEl: HTMLElement, card: TaskCard, column: BoardColumnDef): void {
  if (!isCardDraggable(card, column)) {
    cardEl.draggable = false;
    cardEl.classList.add('ticket-board-card-fixed');
    return;
  }
  cardEl.draggable = true;
  cardEl.addEventListener('dragstart', (e) => {
    dragCardPath = card.path;
    cardEl.classList.add('ticket-board-card-dragging');
    e.dataTransfer?.setData('text/plain', card.path);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
    }
  });
  cardEl.addEventListener('dragend', () => {
    cardEl.classList.remove('ticket-board-card-dragging');
    dragCardPath = null;
    document.querySelectorAll('.ticket-board-column-dragover').forEach((n) => {
      n.classList.remove('ticket-board-column-dragover');
    });
  });
}

async function handleBoardDrop(path: string, targetColumn: BoardColumnDef): Promise<void> {
  if (targetColumn.locked) {
    return;
  }
  if (targetColumn.statusId) {
    await changeTaskStatus(path, targetColumn.statusId, { clearBoardColumn: true });
    return;
  }
  await changeTaskBoardColumn(path, targetColumn.id);
}

async function changeTaskBoardColumn(path: string, columnId: string): Promise<void> {
  const column = getBoardColumn(columnId);
  if (!column || column.statusId || column.locked) {
    return;
  }
  try {
    const content = await readTaskFileContent(path);
    if (content == null) {
      throw new Error('无法读取文件');
    }
    let updated = setFrontmatterField(content, 'boardColumn', columnId);
    await write(path, updated);

    const mem = getMemFile(path);
    if (mem) {
      addMemFile(path, { ...mem, content: updated, lastModified: Date.now() });
    }

    if (currentEditor?.path === path) {
      const header = toHeader(toFilename(path));
      currentEditor.setValue(`${header}\n${updated}`);
      currentEditor.markClean();
    }

    await refreshKanban();
    showToast('已移动到新列');
  } catch (err) {
    logError('changeTaskBoardColumn failed', err);
    alert('移动失败: ' + (err && (err as Error).message ? (err as Error).message : err));
    await refreshKanban();
  }
}

function createBoardCard(card: TaskCard, column: BoardColumnDef): HTMLElement {
  const el = document.createElement('article');
  el.className = 'ticket-board-card';
  el.dataset.path = card.path;

  const titleBtn = document.createElement('button');
  titleBtn.type = 'button';
  titleBtn.className = 'ticket-board-card-title';
  titleBtn.textContent = card.title;
  titleBtn.addEventListener('click', () => {
    closeKanban();
    openFile(card.path);
  });
  el.appendChild(titleBtn);

  appendCardMeta(el, card);

  el.appendChild(buildStatusSelect(card));
  setupCardDrag(el, card, column);
  return el;
}

function renderTicketList(cards: TaskCard[]): void {
  const listRoot = document.getElementById('ticket-list');
  if (!listRoot) {
    return;
  }
  listRoot.innerHTML = '';

  const { sections } = groupCardsByStatus(cards);
  for (const section of sections) {
    listRoot.appendChild(createStatusSection(section.status, section.cards));
  }
}

function createStatusSection(status: TicketStatusDef | null, cards: TaskCard[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'ticket-status-section';

  const label = status ? status.label : '未配置状态';
  const header = document.createElement('button');
  header.type = 'button';
  header.className = 'ticket-status-header';
  header.innerHTML = `<span class="ticket-status-label">${escapeHtml(label)}</span><span class="ticket-status-count">${cards.length}</span>`;
  header.addEventListener('click', () => {
    section.classList.toggle('collapsed');
  });
  section.appendChild(header);

  const body = document.createElement('div');
  body.className = 'ticket-status-body';

  if (!cards.length) {
    const empty = document.createElement('div');
    empty.className = 'ticket-status-empty';
    empty.textContent = '暂无工单';
    body.appendChild(empty);
  } else {
    const ul = document.createElement('ul');
    ul.className = 'ticket-rows';
    for (const card of cards) {
      ul.appendChild(createTicketRow(card));
    }
    body.appendChild(ul);
  }

  section.appendChild(body);
  return section;
}

function createTicketRow(card: TaskCard): HTMLLIElement {
  const row = document.createElement('li');
  row.className = 'ticket-row';

  const main = document.createElement('div');
  main.className = 'ticket-row-main';

  const titleBtn = document.createElement('button');
  titleBtn.type = 'button';
  titleBtn.className = 'ticket-row-title-btn';
  titleBtn.textContent = card.title;
  titleBtn.addEventListener('click', () => {
    closeKanban();
    openFile(card.path);
  });
  main.appendChild(titleBtn);

  appendCardMeta(main, card);
  row.appendChild(main);

  const select = buildStatusSelect(card);
  select.classList.add('ticket-row-status');
  row.appendChild(select);

  return row;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function changeTaskStatus(
  path: string,
  statusId: string,
  opts?: { clearBoardColumn?: boolean }
): Promise<void> {
  if (!getTicketStatus(statusId)) {
    return;
  }
  try {
    const content = await readTaskFileContent(path);
    if (content == null) {
      throw new Error('无法读取文件');
    }
    let updated = setFrontmatterField(content, 'status', statusId);
    if (opts?.clearBoardColumn || isStatusAssociated(statusId)) {
      updated = removeFrontmatterField(updated, 'boardColumn');
    }
    await write(path, updated);

    const mem = getMemFile(path);
    if (mem) {
      addMemFile(path, { ...mem, content: updated, lastModified: Date.now() });
    }

    if (currentEditor?.path === path) {
      const header = toHeader(toFilename(path));
      currentEditor.setValue(`${header}\n${updated}`);
      currentEditor.markClean();
    }

    await refreshKanban();
    showToast('状态已更新');
  } catch (err) {
    logError('changeTaskStatus failed', err);
    alert('更新状态失败: ' + (err && (err as Error).message ? (err as Error).message : err));
    await refreshKanban();
  }
}

async function refreshKanban(): Promise<void> {
  if (!isKanban || kanbanLoading) {
    return;
  }
  kanbanLoading = true;
  const board = document.getElementById('ticket-board');
  const listRoot = document.getElementById('ticket-list');
  board?.classList.add('ticket-board-loading');
  listRoot?.classList.add('ticket-list-loading');
  try {
    await loadTicketStatuses(true);
    await loadBoardColumns(true);
    const cards = await loadTaskCards();
    lastKanbanCards = cards;
    renderFilteredKanban();
  } catch (err) {
    logError('refreshKanban failed', err);
  } finally {
    kanbanLoading = false;
    board?.classList.remove('ticket-board-loading');
    listRoot?.classList.remove('ticket-list-loading');
  }
}

async function createKanbanTask(): Promise<void> {
  if (!kanbanDirExists()) {
    alert('请先创建 issues/ 目录（工具栏「项目文档结构」→ 标准结构）');
    return;
  }

  await ensureTicketStatusesFile();
  await ensureBoardColumnsFile();
  const defaultStatus = getDefaultTicketStatusId();
  const dirPath = '/issues';
  let filename = '新工单.md';
  let num = 1;
  while (getMemFile(joinPath(dirPath, filename)) !== null) {
    filename = `新工单 (${num}).md`;
    num++;
  }

  const path = joinPath(dirPath, filename);
  const body = buildTaskFrontmatter('新工单', defaultStatus);

  try {
    await write(path, body);
    const handle = await getFileHandle(path, true);
    addMemFile(path, {
      isFile: true,
      content: body,
      lastModified: 0,
      handle,
      path,
      imageUrl: null,
    });
    await renderSidebar('issues');
    await refreshKanban();
    closeKanban();
    await openFile(path);
  } catch (err) {
    logError('createKanbanTask failed', err);
    alert('创建工单失败: ' + (err && (err as Error).message ? (err as Error).message : err));
  }
}

function renderStatusEditorList(): void {
  const list = document.getElementById('ticket-status-editor-list');
  if (!list) {
    return;
  }
  list.innerHTML = '';

  statusEditorDraft.forEach((status, index) => {
    const li = document.createElement('li');
    li.className = 'ticket-status-editor-item';

    const input = document.createElement('input');
    input.type = 'text';
    input.value = status.label;
    input.placeholder = '状态名称';
    input.addEventListener('input', () => {
      statusEditorDraft[index].label = input.value;
    });
    li.appendChild(input);

    const idHint = document.createElement('span');
    idHint.className = 'ticket-status-editor-id';
    idHint.textContent = status.id;
    li.appendChild(idHint);

    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '↑';
    up.disabled = index === 0;
    up.addEventListener('click', () => {
      if (index === 0) return;
      const tmp = statusEditorDraft[index - 1];
      statusEditorDraft[index - 1] = statusEditorDraft[index];
      statusEditorDraft[index] = tmp;
      renderStatusEditorList();
    });
    li.appendChild(up);

    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '↓';
    down.disabled = index === statusEditorDraft.length - 1;
    down.addEventListener('click', () => {
      if (index >= statusEditorDraft.length - 1) return;
      const tmp = statusEditorDraft[index + 1];
      statusEditorDraft[index + 1] = statusEditorDraft[index];
      statusEditorDraft[index] = tmp;
      renderStatusEditorList();
    });
    li.appendChild(down);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '删';
    remove.disabled = statusEditorDraft.length <= 1;
    remove.addEventListener('click', () => {
      statusEditorDraft.splice(index, 1);
      renderStatusEditorList();
    });
    li.appendChild(remove);

    list.appendChild(li);
  });
}

function openStatusEditor(): void {
  const modal = document.getElementById('ticket-status-config');
  if (!modal) {
    return;
  }
  statusEditorDraft = getTicketStatuses().map((s) => ({ ...s }));
  renderStatusEditorList();
  modal.style.display = 'flex';
}

function closeStatusEditor(): void {
  const modal = document.getElementById('ticket-status-config');
  if (modal) {
    modal.style.display = 'none';
  }
}

function renderColumnEditorList(): void {
  const list = document.getElementById('ticket-board-editor-list');
  if (!list) {
    return;
  }
  list.innerHTML = '';

  columnEditorDraft.forEach((column, index) => {
    const li = document.createElement('li');
    li.className = 'ticket-board-editor-item';

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.value = column.label;
    labelInput.placeholder = '列名称';
    labelInput.addEventListener('input', () => {
      columnEditorDraft[index].label = labelInput.value;
    });
    li.appendChild(labelInput);

    const statusSelect = document.createElement('select');
    statusSelect.className = 'ticket-board-editor-status';
    const noneOpt = document.createElement('option');
    noneOpt.value = '';
    noneOpt.textContent = '不关联状态';
    statusSelect.appendChild(noneOpt);
    for (const status of getTicketStatuses()) {
      const opt = document.createElement('option');
      opt.value = status.id;
      opt.textContent = status.label;
      if (column.statusId === status.id) {
        opt.selected = true;
      }
      statusSelect.appendChild(opt);
    }
    statusSelect.addEventListener('change', () => {
      columnEditorDraft[index].statusId = statusSelect.value || null;
    });
    li.appendChild(statusSelect);

    const lockedLabel = document.createElement('label');
    lockedLabel.className = 'ticket-board-editor-locked';
    const lockedCheck = document.createElement('input');
    lockedCheck.type = 'checkbox';
    lockedCheck.checked = column.locked;
    lockedCheck.title = '锁定列不可拖拽进出';
    lockedCheck.addEventListener('change', () => {
      columnEditorDraft[index].locked = lockedCheck.checked;
    });
    lockedLabel.appendChild(lockedCheck);
    lockedLabel.append(' 锁定');
    li.appendChild(lockedLabel);

    const idHint = document.createElement('span');
    idHint.className = 'ticket-board-editor-id';
    idHint.textContent = column.id;
    li.appendChild(idHint);

    const up = document.createElement('button');
    up.type = 'button';
    up.textContent = '↑';
    up.disabled = index === 0;
    up.addEventListener('click', () => {
      if (index === 0) return;
      const tmp = columnEditorDraft[index - 1];
      columnEditorDraft[index - 1] = columnEditorDraft[index];
      columnEditorDraft[index] = tmp;
      renderColumnEditorList();
    });
    li.appendChild(up);

    const down = document.createElement('button');
    down.type = 'button';
    down.textContent = '↓';
    down.disabled = index === columnEditorDraft.length - 1;
    down.addEventListener('click', () => {
      if (index >= columnEditorDraft.length - 1) return;
      const tmp = columnEditorDraft[index + 1];
      columnEditorDraft[index + 1] = columnEditorDraft[index];
      columnEditorDraft[index] = tmp;
      renderColumnEditorList();
    });
    li.appendChild(down);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '删';
    remove.disabled = columnEditorDraft.length <= 1;
    remove.addEventListener('click', () => {
      columnEditorDraft.splice(index, 1);
      renderColumnEditorList();
    });
    li.appendChild(remove);

    list.appendChild(li);
  });
}

function openColumnEditor(): void {
  const modal = document.getElementById('ticket-board-config');
  if (!modal) {
    return;
  }
  void loadTicketStatuses().then(() => {
    columnEditorDraft = getBoardColumns().map((c) => ({ ...c }));
    renderColumnEditorList();
    modal.style.display = 'flex';
  });
}

function closeColumnEditor(): void {
  const modal = document.getElementById('ticket-board-config');
  if (modal) {
    modal.style.display = 'none';
  }
}

async function saveColumnEditor(): Promise<void> {
  const labels = columnEditorDraft.map((c) => c.label.trim()).filter(Boolean);
  if (!labels.length) {
    alert('至少保留一列');
    return;
  }

  const existingIds = new Set<string>();
  const usedStatusIds = new Set<string>();
  const columns: BoardColumnDef[] = [];

  for (const item of columnEditorDraft) {
    const label = item.label.trim();
    if (!label) {
      continue;
    }
    let id = item.id.trim();
    if (!id || columns.some((c) => c.id === id)) {
      id = makeColumnId(label, existingIds);
    }
    existingIds.add(id);

    let statusId: string | null = item.statusId ? String(item.statusId).trim() : null;
    if (statusId) {
      if (usedStatusIds.has(statusId)) {
        alert(`状态「${getTicketStatus(statusId)?.label || statusId}」只能关联一列`);
        return;
      }
      usedStatusIds.add(statusId);
    } else {
      statusId = null;
    }

    columns.push({ id, label, statusId, locked: !!item.locked });
  }

  try {
    await writeBoardColumns({ version: 1, columns });
    closeColumnEditor();
    await refreshKanban();
    showToast('看板列已保存');
  } catch (err) {
    logError('saveColumnEditor failed', err);
    alert('保存失败: ' + (err && (err as Error).message ? (err as Error).message : err));
  }
}

async function saveStatusEditor(): Promise<void> {
  const labels = statusEditorDraft.map((s) => s.label.trim()).filter(Boolean);
  if (!labels.length) {
    alert('至少保留一个工单状态');
    return;
  }

  const existingIds = new Set<string>();
  const statuses: TicketStatusDef[] = [];
  for (const item of statusEditorDraft) {
    const label = item.label.trim();
    if (!label) {
      continue;
    }
    let id = item.id.trim();
    if (!id || statuses.some((s) => s.id === id)) {
      id = makeStatusId(label, existingIds);
    }
    existingIds.add(id);
    statuses.push({ id, label });
  }

  const current = await loadTicketStatuses(true);
  let defaultStatus = current.defaultStatus;
  if (!statuses.some((s) => s.id === defaultStatus)) {
    defaultStatus = statuses[0].id;
  }

  try {
    await writeTicketStatuses({ version: 1, defaultStatus, statuses });
    closeStatusEditor();
    await refreshKanban();
    showToast('工单状态已保存');
  } catch (err) {
    logError('saveStatusEditor failed', err);
    alert('保存失败: ' + (err && (err as Error).message ? (err as Error).message : err));
  }
}

async function openKanban(): Promise<void> {
  closeChatModal();
  const chatContainer = document.getElementById('chat-container');
  if (chatContainer) {
    chatContainer.style.display = 'none';
  }
  isChat = false;

  if (!kanbanDirExists()) {
    const ok = confirm(
      '尚未发现 issues/ 目录。\n\n是否现在创建「标准项目文档结构」（含 issues/）？'
    );
    if (ok && typeof scaffoldProjectDocs === 'function') {
      await scaffoldProjectDocs();
      if (!kanbanDirExists()) {
        return;
      }
    } else {
      return;
    }
  }

  await ensureTicketStatusesFile();
  await ensureBoardColumnsFile();

  if (currentEditor?.path && currentEditor.path !== CHAT_PATH) {
    history.pushState({ path: currentEditor.path, view: 'tickets' }, '');
  }

  isKanban = true;
  localStorage.setItem(KANBAN_STORAGE_KEY, 'true');

  const container = document.getElementById('kanban-container');
  if (container) {
    container.style.display = 'flex';
  }
  hideEditorForKanban();
  if (typeof hideReadingPanel === 'function') {
    hideReadingPanel();
  }
  await refreshKanban();
}

function closeKanban(): void {
  if (!isKanban) {
    return;
  }
  isKanban = false;
  localStorage.removeItem(KANBAN_STORAGE_KEY);
  closeStatusEditor();
  closeColumnEditor();

  const container = document.getElementById('kanban-container');
  if (container) {
    container.style.display = 'none';
  }
  showEditorFromKanban();
}

function toggleKanban(): void {
  if (isKanban) {
    closeKanban();
    if (currentEditor?.path && currentEditor.path !== CHAT_PATH) {
      editor.focus();
    }
    return;
  }
  void openKanban();
}

function initKanbanPlugin(api: PluginAPI): void {
  registerKanbanChatArchive(api);
  syncKanbanFilterPresetUI();
  updateTicketLayoutToggle();
  applyTicketLayoutVisibility();

  api.registerToolbarButton({
    id: 'open-kanban-btn',
    title: '工单看板 (Ctrl+Shift+B)',
    ariaLabel: 'Open ticket board',
    html:
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24">' +
      '<rect x="3.5" y="5" width="5" height="14" rx="1.2" stroke="currentColor" stroke-width="1.8"/>' +
      '<rect x="9.5" y="5" width="5" height="14" rx="1.2" stroke="currentColor" stroke-width="1.8"/>' +
      '<rect x="15.5" y="5" width="5" height="14" rx="1.2" stroke="currentColor" stroke-width="1.8"/>' +
      '</svg>',
    onClick: () => toggleKanban(),
  });

  api.registerToolbarButton({
    id: 'scaffold-project-docs',
    title: 'Project docs (docs/issues/changelog)',
    ariaLabel: 'Scaffold project documentation folders',
    html:
      '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24">' +
      '<path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M5 7h12M5 12h8M5 17h14"/>' +
      '<path stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M16 4.5h3v6h-3"/>' +
      '</svg>',
    onClick: () => {
      getProjectScaffoldModal().armOutsideClickGuard();
      void scaffoldProjectDocs();
    },
  });

  api.registerView({
    id: 'kanban',
    isOpen: () => isKanban,
    open: () => openKanban(),
    close: () => closeKanban(),
  });

  api.registerKeyboardShortcut({
    id: 'kanban-toggle',
    match: (event) =>
      isMetaKey(event) && event.shiftKey && (event.key === 'b' || event.key === 'B'),
    handler: (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleKanban();
    },
  });

  api.onEscape(() => {
    if (!isKanban) {
      return false;
    }
    closeKanban();
    editor.focus();
    return true;
  });

  document.getElementById('kanban-toggle-layout')?.addEventListener('click', () => {
    setTicketLayoutMode(getTicketLayoutMode() === 'list' ? 'board' : 'list');
    renderFilteredKanban();
  });
  document.getElementById('kanban-refresh')?.addEventListener('click', () => {
    void refreshKanban();
  });
  document.getElementById('kanban-filter-assignee')?.addEventListener('change', onKanbanFilterChange);
  document.getElementById('kanban-filter-priority')?.addEventListener('change', onKanbanFilterChange);
  document.getElementById('kanban-filter-tag')?.addEventListener('input', onKanbanFilterChange);
  document.getElementById('kanban-filter-clear')?.addEventListener('click', clearKanbanFilter);
  document.getElementById('kanban-filter-save')?.addEventListener('click', promptSaveKanbanFilterPreset);
  document.getElementById('kanban-filter-delete-preset')?.addEventListener('click', deleteSelectedKanbanFilterPreset);
  document.getElementById('kanban-filter-preset')?.addEventListener('change', (event) => {
    const select = event.target as HTMLSelectElement;
    applyKanbanFilterPreset(select.value);
  });
  document.getElementById('kanban-new-task')?.addEventListener('click', () => {
    void createKanbanTask();
  });
  document.getElementById('kanban-close')?.addEventListener('click', () => {
    closeKanban();
    editor.focus();
  });
  document.getElementById('kanban-edit-statuses')?.addEventListener('click', () => {
    openStatusEditor();
  });
  document.getElementById('kanban-edit-columns')?.addEventListener('click', () => {
    openColumnEditor();
  });
  document.getElementById('ticket-board-add')?.addEventListener('click', () => {
    const ids = new Set(columnEditorDraft.map((c) => c.id));
    columnEditorDraft.push({
      id: makeColumnId('新列', ids),
      label: '新列',
      statusId: null,
      locked: false,
    });
    renderColumnEditorList();
  });
  document.getElementById('ticket-board-save')?.addEventListener('click', () => {
    void saveColumnEditor();
  });
  document.getElementById('ticket-board-cancel')?.addEventListener('click', () => {
    closeColumnEditor();
  });
  document.getElementById('ticket-status-add')?.addEventListener('click', () => {
    const ids = new Set(statusEditorDraft.map((s) => s.id));
    statusEditorDraft.push({
      id: makeStatusId('新状态', ids),
      label: '新状态',
    });
    renderStatusEditorList();
  });
  document.getElementById('ticket-status-save')?.addEventListener('click', () => {
    void saveStatusEditor();
  });
  document.getElementById('ticket-status-cancel')?.addEventListener('click', () => {
    closeStatusEditor();
  });
}

Object.assign(globalThis, {
  openKanban,
  closeKanban,
  toggleKanban,
  refreshKanban,
  initKanbanPlugin,
  kanbanDirExists,
  KANBAN_TASK_DIRS,
});
