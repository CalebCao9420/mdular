// Generated from src/ — edit TypeScript and run: npm run build

const KANBAN_TASK_DIRS = ["/issues"];
const KANBAN_STORAGE_KEY = appStorageKey("kanban-open");
const KANBAN_LAYOUT_KEY = appStorageKey("ticket-layout");
const KANBAN_FILTER_KEY = appStorageKey("kanban-filter");
const KANBAN_FILTER_PRESETS_KEY = appStorageKey("kanban-filter-presets");
let kanbanLoading = false;
let isKanban = false;
let lastKanbanCards = [];
let statusEditorDraft = [];
let columnEditorDraft = [];
let dragCardPath = null;
function getTicketLayoutMode() {
  return localStorage.getItem(KANBAN_LAYOUT_KEY) === "list" ? "list" : "board";
}
function setTicketLayoutMode(mode) {
  localStorage.setItem(KANBAN_LAYOUT_KEY, mode);
  updateTicketLayoutToggle();
  applyTicketLayoutVisibility();
}
function updateTicketLayoutToggle() {
  const btn = document.getElementById("kanban-toggle-layout");
  if (!btn) {
    return;
  }
  const isList = getTicketLayoutMode() === "list";
  btn.textContent = isList ? "\u770B\u677F\u89C6\u56FE" : "\u5217\u8868\u89C6\u56FE";
  btn.setAttribute("aria-pressed", isList ? "true" : "false");
}
function applyTicketLayoutVisibility() {
  const board = document.getElementById("ticket-board");
  const list = document.getElementById("ticket-list");
  const isList = getTicketLayoutMode() === "list";
  if (board) {
    board.style.display = isList ? "none" : "flex";
  }
  if (list) {
    list.style.display = isList ? "flex" : "none";
  }
}
function kanbanDirExists() {
  return !!files["issues/"];
}
function isKanbanTaskPath(path) {
  if (!path.endsWith(".md")) {
    return false;
  }
  if (path.endsWith("/README.md")) {
    return false;
  }
  if (path === TICKET_STATUSES_PATH || path === TICKET_BOARD_PATH) {
    return false;
  }
  const dir = toDirPath(path);
  return KANBAN_TASK_DIRS.some((scope) => dir === scope || dir.startsWith(scope + "/"));
}
async function readTaskFileContent(path) {
  const mem = getMemFile(path);
  if (mem?.content != null && typeof mem.content === "string") {
    return mem.content;
  }
  try {
    return await read(path);
  } catch {
    return null;
  }
}
async function loadTaskCards() {
  await loadTicketStatuses();
  await loadBoardColumns();
  const paths = [];
  walk(files, (path, isFile) => {
    if (!isFile || !isKanbanTaskPath(path)) {
      return;
    }
    paths.push(path);
  });
  const cards = [];
  for (const path of paths) {
    const text = await readTaskFileContent(path);
    if (text == null) {
      continue;
    }
    const { meta } = parseFrontmatter(text);
    const statusId = normalizeTicketStatus(meta?.status);
    const status = getTicketStatus(statusId);
    const boardColumn = (meta?.boardColumn || "").trim();
    const statusAssociated = isStatusAssociated(statusId);
    const columnId = resolveCardColumnId(statusId, boardColumn);
    cards.push({
      path,
      statusId,
      statusLabel: status?.label || statusId,
      title: (meta?.title || trimPostfix(toFilename(path), ".md")).trim(),
      assignee: (meta?.assignee || "").trim(),
      priority: (meta?.priority || "").trim(),
      tags: (meta?.tags || "").trim(),
      date: (meta?.date || "").trim(),
      configured: isConfiguredTicketStatus(statusId),
      boardColumn,
      columnId,
      statusAssociated
    });
  }
  cards.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  return cards;
}
function resolveCardColumnId(statusId, boardColumn) {
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
  return columns[0]?.id || "col-unknown";
}
function hideEditorForKanban() {
  const codemirror = document.querySelector(".CodeMirror-wrap");
  if (codemirror) {
    codemirror.style.display = "none";
  }
  const editorContainer = document.getElementById("editor-container");
  if (editorContainer) {
    editorContainer.style.display = "none";
  }
  hideEditor2();
}
function showEditorFromKanban() {
  const editorContainer = document.getElementById("editor-container");
  if (editorContainer) {
    editorContainer.style.display = "flex";
  }
  const codemirror = document.querySelector(".CodeMirror-wrap");
  if (codemirror) {
    codemirror.style.display = "block";
  }
}
function groupCardsByColumn(cards) {
  const byId = /* @__PURE__ */ new Map();
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
  const sections = [];
  for (const column of getBoardColumns()) {
    sections.push({ column, cards: byId.get(column.id) || [] });
  }
  return { sections };
}
function groupCardsByStatus(cards) {
  const byId = /* @__PURE__ */ new Map();
  for (const status of getTicketStatuses()) {
    byId.set(status.id, []);
  }
  const orphan = [];
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
  const sections = [];
  for (const status of getTicketStatuses()) {
    sections.push({ status, cards: byId.get(status.id) || [] });
  }
  if (orphan.length) {
    sections.push({ status: null, cards: orphan });
  }
  return { sections };
}
function normalizePriorityClass(priority) {
  return priority.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9_-]/g, "");
}
function appendCardMeta(parent, card) {
  const tags = parseCardTags(card.tags);
  const hasMeta = card.assignee || card.priority || card.date || tags.length;
  if (!hasMeta) {
    return;
  }
  const meta = document.createElement("div");
  meta.className = "ticket-card-meta";
  if (card.assignee || card.priority || card.date) {
    const row = document.createElement("div");
    row.className = "ticket-card-meta-row";
    if (card.assignee) {
      const el = document.createElement("span");
      el.className = "ticket-meta-assignee";
      el.textContent = card.assignee;
      el.title = "\u8D1F\u8D23\u4EBA";
      row.appendChild(el);
    }
    if (card.priority) {
      const el = document.createElement("span");
      el.className = "ticket-meta-priority ticket-meta-priority--" + normalizePriorityClass(card.priority);
      el.textContent = card.priority;
      el.title = "\u4F18\u5148\u7EA7";
      row.appendChild(el);
    }
    if (card.date) {
      const el = document.createElement("span");
      el.className = "ticket-meta-date";
      el.textContent = card.date;
      el.title = "\u65E5\u671F";
      row.appendChild(el);
    }
    meta.appendChild(row);
  }
  if (tags.length) {
    const tagsEl = document.createElement("div");
    tagsEl.className = "ticket-card-meta-tags";
    for (const tag of tags) {
      const chip = document.createElement("span");
      chip.className = "ticket-meta-tag";
      chip.textContent = tag;
      tagsEl.appendChild(chip);
    }
    meta.appendChild(tagsEl);
  }
  parent.appendChild(meta);
}
function parseCardTags(raw) {
  return raw.split(/[,，\s]+/).map((t) => t.trim().toLowerCase()).filter(Boolean);
}
function getKanbanFilter() {
  try {
    const raw = localStorage.getItem(KANBAN_FILTER_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        assignee: (parsed.assignee || "").trim(),
        tag: (parsed.tag || "").trim(),
        priority: (parsed.priority || "").trim()
      };
    }
  } catch {
  }
  return { assignee: "", tag: "", priority: "" };
}
function setKanbanFilter(filter) {
  localStorage.setItem(KANBAN_FILTER_KEY, JSON.stringify(filter));
}
function getKanbanFilterPresets() {
  try {
    const raw = localStorage.getItem(KANBAN_FILTER_PRESETS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((item) => item && typeof item.name === "string" && item.filter).map((item) => ({
      name: item.name.trim(),
      filter: {
        assignee: (item.filter.assignee || "").trim(),
        tag: (item.filter.tag || "").trim(),
        priority: (item.filter.priority || "").trim()
      }
    })).filter((item) => item.name);
  } catch {
    return [];
  }
}
function saveKanbanFilterPresets(presets) {
  localStorage.setItem(KANBAN_FILTER_PRESETS_KEY, JSON.stringify(presets));
}
function saveCurrentKanbanFilterPreset(name) {
  const trimmed = name.trim();
  if (!trimmed) {
    return;
  }
  const filter = readKanbanFilterFromUI();
  const presets = getKanbanFilterPresets().filter((p) => p.name !== trimmed);
  presets.push({ name: trimmed, filter });
  presets.sort((a, b) => a.name.localeCompare(b.name, "zh-CN"));
  saveKanbanFilterPresets(presets);
  syncKanbanFilterPresetUI(trimmed);
}
function deleteSelectedKanbanFilterPreset() {
  const select = document.getElementById("kanban-filter-preset");
  const name = (select?.value || "").trim();
  if (!name) {
    return;
  }
  if (!confirm(`\u5220\u9664\u7B5B\u9009\u9884\u8BBE\u300C${name}\u300D\uFF1F`)) {
    return;
  }
  const presets = getKanbanFilterPresets().filter((p) => p.name !== name);
  saveKanbanFilterPresets(presets);
  syncKanbanFilterPresetUI("");
}
function applyKanbanFilterPreset(name) {
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
function syncKanbanFilterPresetUI(selectedName = "") {
  const select = document.getElementById("kanban-filter-preset");
  if (!select) {
    return;
  }
  const presets = getKanbanFilterPresets();
  const current = selectedName || select.value;
  select.innerHTML = '<option value="">\u7B5B\u9009\u9884\u8BBE</option>';
  for (const preset of presets) {
    const opt = document.createElement("option");
    opt.value = preset.name;
    opt.textContent = preset.name;
    if (preset.name === current) {
      opt.selected = true;
    }
    select.appendChild(opt);
  }
}
function promptSaveKanbanFilterPreset() {
  const name = prompt("\u4E3A\u5F53\u524D\u7B5B\u9009\u547D\u540D\uFF1A", "");
  if (name == null) {
    return;
  }
  saveCurrentKanbanFilterPreset(name);
  showToast("\u5DF2\u4FDD\u5B58\u7B5B\u9009\u9884\u8BBE");
}
function readKanbanFilterFromUI() {
  const assigneeEl = document.getElementById("kanban-filter-assignee");
  const tagEl = document.getElementById("kanban-filter-tag");
  const priorityEl = document.getElementById("kanban-filter-priority");
  return {
    assignee: (assigneeEl?.value || "").trim(),
    tag: (tagEl?.value || "").trim(),
    priority: (priorityEl?.value || "").trim()
  };
}
function matchesKanbanFilter(card, filter) {
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
function applyKanbanFilter(cards, filter) {
  const active = filter.assignee || filter.tag || filter.priority;
  if (!active) {
    return cards;
  }
  return cards.filter((card) => matchesKanbanFilter(card, filter));
}
function collectKanbanFilterValues(cards) {
  const assigneeSet = /* @__PURE__ */ new Set();
  const prioritySet = /* @__PURE__ */ new Set();
  const tagSet = /* @__PURE__ */ new Set();
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
  const sortZh = (a, b) => a.localeCompare(b, "zh-CN");
  return {
    assignees: Array.from(assigneeSet).sort(sortZh),
    priorities: Array.from(prioritySet).sort(sortZh),
    tags: Array.from(tagSet).sort(sortZh)
  };
}
function syncKanbanFilterUI(cards) {
  const filter = getKanbanFilter();
  const { assignees, priorities, tags } = collectKanbanFilterValues(cards);
  const assigneeEl = document.getElementById("kanban-filter-assignee");
  if (assigneeEl) {
    const current = filter.assignee;
    assigneeEl.innerHTML = '<option value="">\u5168\u90E8\u8D1F\u8D23\u4EBA</option>';
    for (const name of assignees) {
      const opt = document.createElement("option");
      opt.value = name;
      opt.textContent = name;
      if (name === current) {
        opt.selected = true;
      }
      assigneeEl.appendChild(opt);
    }
  }
  const priorityEl = document.getElementById("kanban-filter-priority");
  if (priorityEl) {
    const current = filter.priority;
    priorityEl.innerHTML = '<option value="">\u5168\u90E8\u4F18\u5148\u7EA7</option>';
    for (const p of priorities) {
      const opt = document.createElement("option");
      opt.value = p;
      opt.textContent = p;
      if (p === current) {
        opt.selected = true;
      }
      priorityEl.appendChild(opt);
    }
  }
  const tagList = document.getElementById("kanban-tag-suggestions");
  if (tagList) {
    tagList.innerHTML = "";
    for (const tag of tags) {
      const opt = document.createElement("option");
      opt.value = tag;
      tagList.appendChild(opt);
    }
  }
  const tagEl = document.getElementById("kanban-filter-tag");
  if (tagEl && tagEl.value !== filter.tag) {
    tagEl.value = filter.tag;
  }
  syncKanbanFilterPresetUI();
}
function updateKanbanFilterSummary(shown, total) {
  const el = document.getElementById("kanban-filter-summary");
  if (!el) {
    return;
  }
  const filter = getKanbanFilter();
  const active = filter.assignee || filter.tag || filter.priority;
  if (!active || shown === total) {
    el.textContent = total ? `${total} \u4E2A\u5DE5\u5355` : "";
  } else {
    el.textContent = `\u663E\u793A ${shown} / ${total}`;
  }
}
function renderFilteredKanban() {
  const filter = getKanbanFilter();
  const filtered = applyKanbanFilter(lastKanbanCards, filter);
  syncKanbanFilterUI(lastKanbanCards);
  applyTicketLayoutVisibility();
  renderTickets(filtered);
  updateKanbanFilterSummary(filtered.length, lastKanbanCards.length);
}
function onKanbanFilterChange() {
  const filter = readKanbanFilterFromUI();
  setKanbanFilter(filter);
  renderFilteredKanban();
}
function clearKanbanFilter() {
  setKanbanFilter({ assignee: "", tag: "", priority: "" });
  const tagEl = document.getElementById("kanban-filter-tag");
  if (tagEl) {
    tagEl.value = "";
  }
  syncKanbanFilterPresetUI("");
  renderFilteredKanban();
}
function buildStatusSelect(card) {
  const select = document.createElement("select");
  select.className = "ticket-card-status";
  select.title = "\u53D8\u66F4\u72B6\u6001";
  for (const status of getTicketStatuses()) {
    const opt = document.createElement("option");
    opt.value = status.id;
    opt.textContent = status.label;
    if (status.id === card.statusId || status.label === card.statusLabel) {
      opt.selected = true;
    }
    select.appendChild(opt);
  }
  if (!card.configured) {
    const opt = document.createElement("option");
    opt.value = card.statusId;
    opt.textContent = card.statusLabel + "\uFF08\u672A\u914D\u7F6E\uFF09";
    opt.selected = true;
    select.insertBefore(opt, select.firstChild);
  }
  select.addEventListener("change", () => {
    void changeTaskStatus(card.path, select.value);
  });
  return select;
}
function renderTickets(cards) {
  if (getTicketLayoutMode() === "list") {
    renderTicketList(cards);
  } else {
    renderTicketBoard(cards);
  }
}
function renderTicketBoard(cards) {
  const board = document.getElementById("ticket-board");
  if (!board) {
    return;
  }
  board.innerHTML = "";
  const { sections } = groupCardsByColumn(cards);
  for (const section of sections) {
    board.appendChild(createBoardColumn(section.column, section.cards));
  }
}
function isCardDraggable(card, column) {
  if (column.locked) {
    return false;
  }
  if (card.statusAssociated) {
    return false;
  }
  return true;
}
function createBoardColumn(column, cards) {
  const el = document.createElement("section");
  el.className = "ticket-board-column";
  el.dataset.column = column.id;
  if (column.statusId) {
    el.classList.add("ticket-board-column-linked");
    el.dataset.status = column.statusId;
  }
  if (column.locked) {
    el.classList.add("ticket-board-column-locked");
  }
  const header = document.createElement("div");
  header.className = "ticket-board-column-header";
  const linkHint = column.statusId ? `<span class="ticket-board-column-link" title="\u5173\u8054\u72B6\u6001">\u2194</span>` : "";
  header.innerHTML = `<span class="ticket-board-column-label">${escapeHtml(column.label)}</span>${linkHint}`;
  el.appendChild(header);
  const body = document.createElement("div");
  body.className = "ticket-board-column-cards";
  setupColumnDropZone(body, column);
  for (const card of cards) {
    body.appendChild(createBoardCard(card, column));
  }
  el.appendChild(body);
  return el;
}
function setupColumnDropZone(body, column) {
  body.addEventListener("dragover", (e) => {
    if (column.locked) {
      return;
    }
    e.preventDefault();
    body.classList.add("ticket-board-column-dragover");
  });
  body.addEventListener("dragleave", () => {
    body.classList.remove("ticket-board-column-dragover");
  });
  body.addEventListener("drop", (e) => {
    e.preventDefault();
    body.classList.remove("ticket-board-column-dragover");
    if (column.locked || !dragCardPath) {
      return;
    }
    void handleBoardDrop(dragCardPath, column);
    dragCardPath = null;
  });
}
function setupCardDrag(cardEl, card, column) {
  if (!isCardDraggable(card, column)) {
    cardEl.draggable = false;
    cardEl.classList.add("ticket-board-card-fixed");
    return;
  }
  cardEl.draggable = true;
  cardEl.addEventListener("dragstart", (e) => {
    dragCardPath = card.path;
    cardEl.classList.add("ticket-board-card-dragging");
    e.dataTransfer?.setData("text/plain", card.path);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = "move";
    }
  });
  cardEl.addEventListener("dragend", () => {
    cardEl.classList.remove("ticket-board-card-dragging");
    dragCardPath = null;
    document.querySelectorAll(".ticket-board-column-dragover").forEach((n) => {
      n.classList.remove("ticket-board-column-dragover");
    });
  });
}
async function handleBoardDrop(path, targetColumn) {
  if (targetColumn.locked) {
    return;
  }
  if (targetColumn.statusId) {
    await changeTaskStatus(path, targetColumn.statusId, { clearBoardColumn: true });
    return;
  }
  await changeTaskBoardColumn(path, targetColumn.id);
}
async function changeTaskBoardColumn(path, columnId) {
  const column = getBoardColumn(columnId);
  if (!column || column.statusId || column.locked) {
    return;
  }
  try {
    const content = await readTaskFileContent(path);
    if (content == null) {
      throw new Error("\u65E0\u6CD5\u8BFB\u53D6\u6587\u4EF6");
    }
    let updated = setFrontmatterField(content, "boardColumn", columnId);
    await write(path, updated);
    const mem = getMemFile(path);
    if (mem) {
      addMemFile(path, { ...mem, content: updated, lastModified: Date.now() });
    }
    if (currentEditor?.path === path) {
      const header = toHeader(toFilename(path));
      currentEditor.setValue(`${header}
${updated}`);
      currentEditor.markClean();
    }
    await refreshKanban();
    showToast("\u5DF2\u79FB\u52A8\u5230\u65B0\u5217");
  } catch (err) {
    logError("changeTaskBoardColumn failed", err);
    alert("\u79FB\u52A8\u5931\u8D25: " + (err && err.message ? err.message : err));
    await refreshKanban();
  }
}
function createBoardCard(card, column) {
  const el = document.createElement("article");
  el.className = "ticket-board-card";
  el.dataset.path = card.path;
  const titleBtn = document.createElement("button");
  titleBtn.type = "button";
  titleBtn.className = "ticket-board-card-title";
  titleBtn.textContent = card.title;
  titleBtn.addEventListener("click", () => {
    closeKanban();
    openFile(card.path);
  });
  el.appendChild(titleBtn);
  appendCardMeta(el, card);
  el.appendChild(buildStatusSelect(card));
  setupCardDrag(el, card, column);
  return el;
}
function renderTicketList(cards) {
  const listRoot = document.getElementById("ticket-list");
  if (!listRoot) {
    return;
  }
  listRoot.innerHTML = "";
  const { sections } = groupCardsByStatus(cards);
  for (const section of sections) {
    listRoot.appendChild(createStatusSection(section.status, section.cards));
  }
}
function createStatusSection(status, cards) {
  const section = document.createElement("section");
  section.className = "ticket-status-section";
  const label = status ? status.label : "\u672A\u914D\u7F6E\u72B6\u6001";
  const header = document.createElement("button");
  header.type = "button";
  header.className = "ticket-status-header";
  header.innerHTML = `<span class="ticket-status-label">${escapeHtml(label)}</span><span class="ticket-status-count">${cards.length}</span>`;
  header.addEventListener("click", () => {
    section.classList.toggle("collapsed");
  });
  section.appendChild(header);
  const body = document.createElement("div");
  body.className = "ticket-status-body";
  if (!cards.length) {
    const empty = document.createElement("div");
    empty.className = "ticket-status-empty";
    empty.textContent = "\u6682\u65E0\u5DE5\u5355";
    body.appendChild(empty);
  } else {
    const ul = document.createElement("ul");
    ul.className = "ticket-rows";
    for (const card of cards) {
      ul.appendChild(createTicketRow(card));
    }
    body.appendChild(ul);
  }
  section.appendChild(body);
  return section;
}
function createTicketRow(card) {
  const row = document.createElement("li");
  row.className = "ticket-row";
  const main = document.createElement("div");
  main.className = "ticket-row-main";
  const titleBtn = document.createElement("button");
  titleBtn.type = "button";
  titleBtn.className = "ticket-row-title-btn";
  titleBtn.textContent = card.title;
  titleBtn.addEventListener("click", () => {
    closeKanban();
    openFile(card.path);
  });
  main.appendChild(titleBtn);
  appendCardMeta(main, card);
  row.appendChild(main);
  const select = buildStatusSelect(card);
  select.classList.add("ticket-row-status");
  row.appendChild(select);
  return row;
}
function escapeHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
async function changeTaskStatus(path, statusId, opts) {
  if (!getTicketStatus(statusId)) {
    return;
  }
  try {
    const content = await readTaskFileContent(path);
    if (content == null) {
      throw new Error("\u65E0\u6CD5\u8BFB\u53D6\u6587\u4EF6");
    }
    let updated = setFrontmatterField(content, "status", statusId);
    if (opts?.clearBoardColumn || isStatusAssociated(statusId)) {
      updated = removeFrontmatterField(updated, "boardColumn");
    }
    await write(path, updated);
    const mem = getMemFile(path);
    if (mem) {
      addMemFile(path, { ...mem, content: updated, lastModified: Date.now() });
    }
    if (currentEditor?.path === path) {
      const header = toHeader(toFilename(path));
      currentEditor.setValue(`${header}
${updated}`);
      currentEditor.markClean();
    }
    await refreshKanban();
    showToast("\u72B6\u6001\u5DF2\u66F4\u65B0");
  } catch (err) {
    logError("changeTaskStatus failed", err);
    alert("\u66F4\u65B0\u72B6\u6001\u5931\u8D25: " + (err && err.message ? err.message : err));
    await refreshKanban();
  }
}
async function refreshKanban() {
  if (!isKanban || kanbanLoading) {
    return;
  }
  kanbanLoading = true;
  const board = document.getElementById("ticket-board");
  const listRoot = document.getElementById("ticket-list");
  board?.classList.add("ticket-board-loading");
  listRoot?.classList.add("ticket-list-loading");
  try {
    await loadTicketStatuses(true);
    await loadBoardColumns(true);
    const cards = await loadTaskCards();
    lastKanbanCards = cards;
    renderFilteredKanban();
  } catch (err) {
    logError("refreshKanban failed", err);
  } finally {
    kanbanLoading = false;
    board?.classList.remove("ticket-board-loading");
    listRoot?.classList.remove("ticket-list-loading");
  }
}
async function createKanbanTask() {
  if (!kanbanDirExists()) {
    alert("\u8BF7\u5148\u521B\u5EFA issues/ \u76EE\u5F55\uFF08\u5DE5\u5177\u680F\u300C\u9879\u76EE\u6587\u6863\u7ED3\u6784\u300D\u2192 \u6807\u51C6\u7ED3\u6784\uFF09");
    return;
  }
  await ensureTicketStatusesFile();
  await ensureBoardColumnsFile();
  const defaultStatus = getDefaultTicketStatusId();
  const dirPath = "/issues";
  let filename = "\u65B0\u5DE5\u5355.md";
  let num = 1;
  while (getMemFile(joinPath(dirPath, filename)) !== null) {
    filename = `\u65B0\u5DE5\u5355 (${num}).md`;
    num++;
  }
  const path = joinPath(dirPath, filename);
  const body = buildTaskFrontmatter("\u65B0\u5DE5\u5355", defaultStatus);
  try {
    await write(path, body);
    const handle = await getFileHandle(path, true);
    addMemFile(path, {
      isFile: true,
      content: body,
      lastModified: 0,
      handle,
      path,
      imageUrl: null
    });
    await renderSidebar("issues");
    await refreshKanban();
    closeKanban();
    await openFile(path);
  } catch (err) {
    logError("createKanbanTask failed", err);
    alert("\u521B\u5EFA\u5DE5\u5355\u5931\u8D25: " + (err && err.message ? err.message : err));
  }
}
function renderStatusEditorList() {
  const list = document.getElementById("ticket-status-editor-list");
  if (!list) {
    return;
  }
  list.innerHTML = "";
  statusEditorDraft.forEach((status, index) => {
    const li = document.createElement("li");
    li.className = "ticket-status-editor-item";
    const input = document.createElement("input");
    input.type = "text";
    input.value = status.label;
    input.placeholder = "\u72B6\u6001\u540D\u79F0";
    input.addEventListener("input", () => {
      statusEditorDraft[index].label = input.value;
    });
    li.appendChild(input);
    const idHint = document.createElement("span");
    idHint.className = "ticket-status-editor-id";
    idHint.textContent = status.id;
    li.appendChild(idHint);
    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "\u2191";
    up.disabled = index === 0;
    up.addEventListener("click", () => {
      if (index === 0) return;
      const tmp = statusEditorDraft[index - 1];
      statusEditorDraft[index - 1] = statusEditorDraft[index];
      statusEditorDraft[index] = tmp;
      renderStatusEditorList();
    });
    li.appendChild(up);
    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "\u2193";
    down.disabled = index === statusEditorDraft.length - 1;
    down.addEventListener("click", () => {
      if (index >= statusEditorDraft.length - 1) return;
      const tmp = statusEditorDraft[index + 1];
      statusEditorDraft[index + 1] = statusEditorDraft[index];
      statusEditorDraft[index] = tmp;
      renderStatusEditorList();
    });
    li.appendChild(down);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "\u5220";
    remove.disabled = statusEditorDraft.length <= 1;
    remove.addEventListener("click", () => {
      statusEditorDraft.splice(index, 1);
      renderStatusEditorList();
    });
    li.appendChild(remove);
    list.appendChild(li);
  });
}
function openStatusEditor() {
  const modal = document.getElementById("ticket-status-config");
  if (!modal) {
    return;
  }
  statusEditorDraft = getTicketStatuses().map((s) => ({ ...s }));
  renderStatusEditorList();
  modal.style.display = "flex";
}
function closeStatusEditor() {
  const modal = document.getElementById("ticket-status-config");
  if (modal) {
    modal.style.display = "none";
  }
}
function renderColumnEditorList() {
  const list = document.getElementById("ticket-board-editor-list");
  if (!list) {
    return;
  }
  list.innerHTML = "";
  columnEditorDraft.forEach((column, index) => {
    const li = document.createElement("li");
    li.className = "ticket-board-editor-item";
    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.value = column.label;
    labelInput.placeholder = "\u5217\u540D\u79F0";
    labelInput.addEventListener("input", () => {
      columnEditorDraft[index].label = labelInput.value;
    });
    li.appendChild(labelInput);
    const statusSelect = document.createElement("select");
    statusSelect.className = "ticket-board-editor-status";
    const noneOpt = document.createElement("option");
    noneOpt.value = "";
    noneOpt.textContent = "\u4E0D\u5173\u8054\u72B6\u6001";
    statusSelect.appendChild(noneOpt);
    for (const status of getTicketStatuses()) {
      const opt = document.createElement("option");
      opt.value = status.id;
      opt.textContent = status.label;
      if (column.statusId === status.id) {
        opt.selected = true;
      }
      statusSelect.appendChild(opt);
    }
    statusSelect.addEventListener("change", () => {
      columnEditorDraft[index].statusId = statusSelect.value || null;
    });
    li.appendChild(statusSelect);
    const lockedLabel = document.createElement("label");
    lockedLabel.className = "ticket-board-editor-locked";
    const lockedCheck = document.createElement("input");
    lockedCheck.type = "checkbox";
    lockedCheck.checked = column.locked;
    lockedCheck.title = "\u9501\u5B9A\u5217\u4E0D\u53EF\u62D6\u62FD\u8FDB\u51FA";
    lockedCheck.addEventListener("change", () => {
      columnEditorDraft[index].locked = lockedCheck.checked;
    });
    lockedLabel.appendChild(lockedCheck);
    lockedLabel.append(" \u9501\u5B9A");
    li.appendChild(lockedLabel);
    const idHint = document.createElement("span");
    idHint.className = "ticket-board-editor-id";
    idHint.textContent = column.id;
    li.appendChild(idHint);
    const up = document.createElement("button");
    up.type = "button";
    up.textContent = "\u2191";
    up.disabled = index === 0;
    up.addEventListener("click", () => {
      if (index === 0) return;
      const tmp = columnEditorDraft[index - 1];
      columnEditorDraft[index - 1] = columnEditorDraft[index];
      columnEditorDraft[index] = tmp;
      renderColumnEditorList();
    });
    li.appendChild(up);
    const down = document.createElement("button");
    down.type = "button";
    down.textContent = "\u2193";
    down.disabled = index === columnEditorDraft.length - 1;
    down.addEventListener("click", () => {
      if (index >= columnEditorDraft.length - 1) return;
      const tmp = columnEditorDraft[index + 1];
      columnEditorDraft[index + 1] = columnEditorDraft[index];
      columnEditorDraft[index] = tmp;
      renderColumnEditorList();
    });
    li.appendChild(down);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.textContent = "\u5220";
    remove.disabled = columnEditorDraft.length <= 1;
    remove.addEventListener("click", () => {
      columnEditorDraft.splice(index, 1);
      renderColumnEditorList();
    });
    li.appendChild(remove);
    list.appendChild(li);
  });
}
function openColumnEditor() {
  const modal = document.getElementById("ticket-board-config");
  if (!modal) {
    return;
  }
  void loadTicketStatuses().then(() => {
    columnEditorDraft = getBoardColumns().map((c) => ({ ...c }));
    renderColumnEditorList();
    modal.style.display = "flex";
  });
}
function closeColumnEditor() {
  const modal = document.getElementById("ticket-board-config");
  if (modal) {
    modal.style.display = "none";
  }
}
async function saveColumnEditor() {
  const labels = columnEditorDraft.map((c) => c.label.trim()).filter(Boolean);
  if (!labels.length) {
    alert("\u81F3\u5C11\u4FDD\u7559\u4E00\u5217");
    return;
  }
  const existingIds = /* @__PURE__ */ new Set();
  const usedStatusIds = /* @__PURE__ */ new Set();
  const columns = [];
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
    let statusId = item.statusId ? String(item.statusId).trim() : null;
    if (statusId) {
      if (usedStatusIds.has(statusId)) {
        alert(`\u72B6\u6001\u300C${getTicketStatus(statusId)?.label || statusId}\u300D\u53EA\u80FD\u5173\u8054\u4E00\u5217`);
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
    showToast("\u770B\u677F\u5217\u5DF2\u4FDD\u5B58");
  } catch (err) {
    logError("saveColumnEditor failed", err);
    alert("\u4FDD\u5B58\u5931\u8D25: " + (err && err.message ? err.message : err));
  }
}
async function saveStatusEditor() {
  const labels = statusEditorDraft.map((s) => s.label.trim()).filter(Boolean);
  if (!labels.length) {
    alert("\u81F3\u5C11\u4FDD\u7559\u4E00\u4E2A\u5DE5\u5355\u72B6\u6001");
    return;
  }
  const existingIds = /* @__PURE__ */ new Set();
  const statuses = [];
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
    showToast("\u5DE5\u5355\u72B6\u6001\u5DF2\u4FDD\u5B58");
  } catch (err) {
    logError("saveStatusEditor failed", err);
    alert("\u4FDD\u5B58\u5931\u8D25: " + (err && err.message ? err.message : err));
  }
}
async function openKanban() {
  closeChatModal();
  const chatContainer = document.getElementById("chat-container");
  if (chatContainer) {
    chatContainer.style.display = "none";
  }
  isChat = false;
  if (!kanbanDirExists()) {
    const ok = confirm(
      "\u5C1A\u672A\u53D1\u73B0 issues/ \u76EE\u5F55\u3002\n\n\u662F\u5426\u73B0\u5728\u521B\u5EFA\u300C\u6807\u51C6\u9879\u76EE\u6587\u6863\u7ED3\u6784\u300D\uFF08\u542B issues/\uFF09\uFF1F"
    );
    if (ok && typeof scaffoldProjectDocs === "function") {
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
    history.pushState({ path: currentEditor.path, view: "tickets" }, "");
  }
  isKanban = true;
  localStorage.setItem(KANBAN_STORAGE_KEY, "true");
  const container = document.getElementById("kanban-container");
  if (container) {
    container.style.display = "flex";
  }
  hideEditorForKanban();
  if (typeof hideReadingPanel === "function") {
    hideReadingPanel();
  }
  await refreshKanban();
}
function closeKanban() {
  if (!isKanban) {
    return;
  }
  isKanban = false;
  localStorage.removeItem(KANBAN_STORAGE_KEY);
  closeStatusEditor();
  closeColumnEditor();
  const container = document.getElementById("kanban-container");
  if (container) {
    container.style.display = "none";
  }
  showEditorFromKanban();
}
function toggleKanban() {
  if (isKanban) {
    closeKanban();
    if (currentEditor?.path && currentEditor.path !== CHAT_PATH) {
      editor.focus();
    }
    return;
  }
  void openKanban();
}
function initKanbanPlugin(api) {
  registerKanbanChatArchive(api);
  syncKanbanFilterPresetUI();
  updateTicketLayoutToggle();
  applyTicketLayoutVisibility();
  api.registerToolbarButton({
    id: "open-kanban-btn",
    title: "\u5DE5\u5355\u770B\u677F (Ctrl+Shift+B)",
    ariaLabel: "Open ticket board",
    html: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24"><rect x="3.5" y="5" width="5" height="14" rx="1.2" stroke="currentColor" stroke-width="1.8"/><rect x="9.5" y="5" width="5" height="14" rx="1.2" stroke="currentColor" stroke-width="1.8"/><rect x="15.5" y="5" width="5" height="14" rx="1.2" stroke="currentColor" stroke-width="1.8"/></svg>',
    onClick: () => toggleKanban()
  });
  api.registerToolbarButton({
    id: "scaffold-project-docs",
    title: "Project docs (docs/issues/changelog)",
    ariaLabel: "Scaffold project documentation folders",
    html: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" stroke-width="1.8" stroke-linecap="round" d="M5 7h12M5 12h8M5 17h14"/><path stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" d="M16 4.5h3v6h-3"/></svg>',
    onClick: () => {
      getProjectScaffoldModal().armOutsideClickGuard();
      void scaffoldProjectDocs();
    }
  });
  api.registerView({
    id: "kanban",
    isOpen: () => isKanban,
    open: () => openKanban(),
    close: () => closeKanban()
  });
  api.registerKeyboardShortcut({
    id: "kanban-toggle",
    match: (event) => isMetaKey(event) && event.shiftKey && (event.key === "b" || event.key === "B"),
    handler: (event) => {
      event.preventDefault();
      event.stopPropagation();
      toggleKanban();
    }
  });
  api.onEscape(() => {
    if (!isKanban) {
      return false;
    }
    closeKanban();
    editor.focus();
    return true;
  });
  document.getElementById("kanban-toggle-layout")?.addEventListener("click", () => {
    setTicketLayoutMode(getTicketLayoutMode() === "list" ? "board" : "list");
    renderFilteredKanban();
  });
  document.getElementById("kanban-refresh")?.addEventListener("click", () => {
    void refreshKanban();
  });
  document.getElementById("kanban-filter-assignee")?.addEventListener("change", onKanbanFilterChange);
  document.getElementById("kanban-filter-priority")?.addEventListener("change", onKanbanFilterChange);
  document.getElementById("kanban-filter-tag")?.addEventListener("input", onKanbanFilterChange);
  document.getElementById("kanban-filter-clear")?.addEventListener("click", clearKanbanFilter);
  document.getElementById("kanban-filter-save")?.addEventListener("click", promptSaveKanbanFilterPreset);
  document.getElementById("kanban-filter-delete-preset")?.addEventListener("click", deleteSelectedKanbanFilterPreset);
  document.getElementById("kanban-filter-preset")?.addEventListener("change", (event) => {
    const select = event.target;
    applyKanbanFilterPreset(select.value);
  });
  document.getElementById("kanban-new-task")?.addEventListener("click", () => {
    void createKanbanTask();
  });
  document.getElementById("kanban-close")?.addEventListener("click", () => {
    closeKanban();
    editor.focus();
  });
  document.getElementById("kanban-edit-statuses")?.addEventListener("click", () => {
    openStatusEditor();
  });
  document.getElementById("kanban-edit-columns")?.addEventListener("click", () => {
    openColumnEditor();
  });
  document.getElementById("ticket-board-add")?.addEventListener("click", () => {
    const ids = new Set(columnEditorDraft.map((c) => c.id));
    columnEditorDraft.push({
      id: makeColumnId("\u65B0\u5217", ids),
      label: "\u65B0\u5217",
      statusId: null,
      locked: false
    });
    renderColumnEditorList();
  });
  document.getElementById("ticket-board-save")?.addEventListener("click", () => {
    void saveColumnEditor();
  });
  document.getElementById("ticket-board-cancel")?.addEventListener("click", () => {
    closeColumnEditor();
  });
  document.getElementById("ticket-status-add")?.addEventListener("click", () => {
    const ids = new Set(statusEditorDraft.map((s) => s.id));
    statusEditorDraft.push({
      id: makeStatusId("\u65B0\u72B6\u6001", ids),
      label: "\u65B0\u72B6\u6001"
    });
    renderStatusEditorList();
  });
  document.getElementById("ticket-status-save")?.addEventListener("click", () => {
    void saveStatusEditor();
  });
  document.getElementById("ticket-status-cancel")?.addEventListener("click", () => {
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
  KANBAN_TASK_DIRS
});
