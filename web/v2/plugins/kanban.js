// Generated from src/ — edit TypeScript and run: npm run build


// packages/plugin-manifest/src/index.ts
function definePluginManifest(manifest) {
  return manifest;
}

// packages/plugin-sdk/src/index.ts
function definePlugin(plugin2) {
  return plugin2;
}

// plugins/official/kanban/plugin.json
var plugin_default = {
  schemaVersion: 1,
  id: "mdular.kanban",
  name: "Kanban",
  version: "0.1.0",
  entry: "kanban.js",
  description: "Official issues board, workflow configuration, filtering and Chat archive target.",
  activationEvents: [
    "onStartup"
  ],
  permissions: [
    "commands",
    "extensions.register",
    "navigation.openMarkdown",
    "storage.workspace",
    "ui.views",
    "workspace.readMarkdown",
    "workspace.readText",
    "workspace.modifyMarkdown",
    "workspace.modifyText",
    "workspace.writeTextBatch",
    "workspace.watchMarkdown"
  ],
  contributes: {
    commands: [
      {
        id: "mdular.kanban.open",
        title: "Kanban: Open Issues",
        defaultKeybindings: ["Mod+Shift+B"]
      },
      {
        id: "mdular.kanban.new-issue",
        title: "Kanban: New Issue"
      },
      {
        id: "mdular.kanban.configure",
        title: "Kanban: Configure Workflow"
      }
    ],
    views: [
      {
        id: "kanban",
        title: "Kanban",
        location: "editor-pane"
      }
    ]
  }
};

// plugins/official/kanban/src/model.ts
var KANBAN_LIMITS = Object.freeze({
  maxIssues: 2e3,
  maxTotalBytes: 16 * 1024 * 1024,
  maxStatuses: 64,
  maxColumns: 64,
  maxPresets: 32,
  maxTitle: 200,
  maxDescription: 128 * 1024
});
var DEFAULT_STATUSES = Object.freeze([
  { id: "pending-assign", label: "\u5F85\u5206\u914D" },
  { id: "assigned-waiting", label: "\u5DF2\u5206\u914D\u7B49\u5F85\u4E2D" },
  { id: "in-progress", label: "\u8FDB\u884C\u4E2D" },
  { id: "done-pending-review", label: "\u521D\u7248\u5B8C\u6210\u5F85\u9A8C\u6536" },
  { id: "reviewing", label: "\u9A8C\u6536\u4E2D" },
  { id: "review-done-pending-test", label: "\u9A8C\u6536\u5B8C\u6210\u5F85\u6D4B\u8BD5" },
  { id: "testing", label: "\u6D4B\u8BD5\u4E2D" },
  { id: "done", label: "\u9A8C\u6D4B\u5B8C\u6210" },
  { id: "requirement-rejected", label: "\u9700\u6C42\u9A73\u56DE" },
  { id: "review-failed", label: "\u9A8C\u6536\u4E0D\u901A\u8FC7" },
  { id: "test-failed", label: "\u6D4B\u8BD5\u4E0D\u901A\u8FC7" }
]);
function isRecord(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function boundedText(value, label, maximum) {
  if ("string" !== typeof value || "" === value.trim() || maximum < value.length) {
    throw new Error(`${label} is invalid`);
  }
  return value.trim();
}
function assertSupportedVersion(source, label) {
  if (void 0 === source.version || 1 === source.version) {
    return;
  }
  if ("number" === typeof source.version && source.version < 1) {
    return;
  }
  throw new Error(`${label} uses unsupported version ${String(source.version)}`);
}
function defaultStatusConfig() {
  const source = {
    version: 1,
    defaultStatus: DEFAULT_STATUSES[0].id,
    statuses: DEFAULT_STATUSES.map((status) => ({ ...status }))
  };
  return parseStatusConfig(source);
}
function defaultBoardConfig(statuses = defaultStatusConfig()) {
  const source = {
    version: 1,
    columns: [
      { id: "col-inbox", label: "\u6536\u4EF6\u7BB1", statusId: null, locked: false },
      ...statuses.statuses.map((status) => ({
        id: `col-${status.id}`,
        label: status.label,
        statusId: status.id,
        locked: false
      }))
    ]
  };
  return parseBoardConfig(source);
}
function parseStatusConfig(value) {
  if (!isRecord(value) || !Array.isArray(value.statuses) || 0 === value.statuses.length || KANBAN_LIMITS.maxStatuses < value.statuses.length) {
    throw new Error("Ticket status configuration is invalid");
  }
  assertSupportedVersion(value, "Ticket status configuration");
  const seen = /* @__PURE__ */ new Set();
  const statuses = [];
  for (const candidate of value.statuses) {
    if (!isRecord(candidate)) {
      throw new Error("Ticket status entry is invalid");
    }
    const id = boundedText(candidate.id, "Ticket status ID", 128);
    const label = boundedText(candidate.label, "Ticket status label", 256);
    if (seen.has(id)) {
      throw new Error(`Ticket status ID is duplicated: ${id}`);
    }
    seen.add(id);
    statuses.push({ id, label, source: { ...candidate } });
  }
  const defaultStatus = "string" === typeof value.defaultStatus && seen.has(value.defaultStatus) ? value.defaultStatus : statuses[0].id;
  return { version: 1, defaultStatus, statuses, source: { ...value } };
}
function parseBoardConfig(value) {
  if (!isRecord(value) || !Array.isArray(value.columns) || 0 === value.columns.length || KANBAN_LIMITS.maxColumns < value.columns.length) {
    throw new Error("Ticket board configuration is invalid");
  }
  assertSupportedVersion(value, "Ticket board configuration");
  const ids = /* @__PURE__ */ new Set();
  const linkedStatuses = /* @__PURE__ */ new Set();
  const columns = [];
  for (const candidate of value.columns) {
    if (!isRecord(candidate)) {
      throw new Error("Ticket board column is invalid");
    }
    const id = boundedText(candidate.id, "Ticket board column ID", 128);
    const label = boundedText(candidate.label, "Ticket board column label", 256);
    if (ids.has(id)) {
      throw new Error(`Ticket board column ID is duplicated: ${id}`);
    }
    ids.add(id);
    let statusId = null;
    if (null !== candidate.statusId && void 0 !== candidate.statusId && "" !== candidate.statusId) {
      statusId = boundedText(candidate.statusId, "Ticket board status ID", 128);
      if (linkedStatuses.has(statusId)) {
        throw new Error(`Ticket board status is linked more than once: ${statusId}`);
      }
      linkedStatuses.add(statusId);
    }
    columns.push({
      id,
      label,
      statusId,
      locked: true === candidate.locked,
      source: { ...candidate }
    });
  }
  return { version: 1, columns, source: { ...value } };
}
function serializeStatusConfig(config) {
  return `${JSON.stringify({
    ...config.source,
    version: 1,
    defaultStatus: config.defaultStatus,
    statuses: config.statuses.map((status) => ({
      ...status.source,
      id: status.id,
      label: status.label
    }))
  }, null, 2)}
`;
}
function serializeBoardConfig(config) {
  return `${JSON.stringify({
    ...config.source,
    version: 1,
    columns: config.columns.map((column) => ({
      ...column.source,
      id: column.id,
      label: column.label,
      statusId: column.statusId,
      locked: column.locked
    }))
  }, null, 2)}
`;
}
function scalarValue(raw) {
  const value = raw.trim();
  if (2 <= value.length && '"' === value[0] && '"' === value.at(-1)) {
    try {
      const parsed = JSON.parse(value);
      if ("string" === typeof parsed) {
        return parsed;
      }
    } catch {
    }
  }
  if (2 <= value.length && "'" === value[0] && "'" === value.at(-1)) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}
function parseFrontmatter(content) {
  const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = bom ? content.slice(1) : content;
  const eol = source.includes("\r\n") ? "\r\n" : source.includes("\r") ? "\r" : "\n";
  const lines = source.split(/\r\n|\n|\r/u);
  if ("---" !== lines[0]?.trim()) {
    return null;
  }
  const close = lines.findIndex((line, index) => 0 < index && "---" === line.trim());
  if (close < 1) {
    return null;
  }
  const values = /* @__PURE__ */ new Map();
  for (let index = 1; index < close; index += 1) {
    const match = /^([A-Za-z0-9_.-]+):(?:[ \t]*(.*))?$/u.exec(lines[index] ?? "");
    if (match && !values.has(match[1])) {
      values.set(match[1], scalarValue(match[2] ?? ""));
    }
  }
  const rawSchema = values.get("kanbanSchema");
  const schemaVersion = void 0 === rawSchema || "" === rawSchema ? 0 : /^[0-9]+$/u.test(rawSchema) ? Number(rawSchema) : Number.NaN;
  return { bom, eol, lines, close, values, schemaVersion };
}
function yamlScalar(value) {
  if ("" === value) {
    return "";
  }
  return /^[A-Za-z0-9_.@/+ -]+$/u.test(value) && value === value.trim() ? value : JSON.stringify(value);
}
function patchIssueFrontmatter(content, changes) {
  let parsed = parseFrontmatter(content);
  if (parsed && (!Number.isSafeInteger(parsed.schemaVersion) || 1 < parsed.schemaVersion)) {
    throw new Error(`Issue uses unsupported kanbanSchema ${String(parsed.schemaVersion)}`);
  }
  if (!parsed) {
    const bom = content.startsWith("\uFEFF") ? "\uFEFF" : "";
    const body = bom ? content.slice(1) : content;
    const eol = body.includes("\r\n") ? "\r\n" : body.includes("\r") ? "\r" : "\n";
    const prefix = `---${eol}kanbanSchema: 1${eol}---${eol}${eol}`;
    parsed = parseFrontmatter(`${bom}${prefix}${body}`);
  }
  const lines = [...parsed.lines];
  let close = parsed.close;
  const nextChanges = new Map([
    ["kanbanSchema", "1"],
    ...Object.entries(changes)
  ]);
  for (const [key, value] of nextChanges) {
    const matches = [];
    for (let index = 1; index < close; index += 1) {
      if (new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}:`, "u").test(lines[index] ?? "")) {
        matches.push(index);
      }
    }
    if (null === value) {
      for (const index of matches.reverse()) {
        lines.splice(index, 1);
        close -= 1;
      }
      continue;
    }
    const rendered = `${key}: ${yamlScalar(value)}`;
    if (0 === matches.length) {
      lines.splice(close, 0, rendered);
      close += 1;
    } else {
      lines[matches[0]] = rendered;
      for (const index of matches.slice(1).reverse()) {
        lines.splice(index, 1);
        close -= 1;
      }
    }
  }
  return `${parsed.bom}${lines.join(parsed.eol)}`;
}
function basename(path) {
  return path.split("/").at(-1)?.replace(/\.md$/iu, "") ?? path;
}
function normalizeStatus(raw, statuses) {
  const key = raw.trim().toLocaleLowerCase("en-US");
  if (!key) {
    return statuses.defaultStatus;
  }
  return statuses.statuses.find((status) => status.id.toLocaleLowerCase("en-US") === key || status.label.toLocaleLowerCase("en-US") === key)?.id ?? raw.trim();
}
function resolveIssueColumn(statusId, boardColumn, board) {
  return board.columns.find((column) => column.statusId === statusId)?.id ?? board.columns.find((column) => column.id === boardColumn)?.id ?? board.columns.find((column) => null === column.statusId)?.id ?? board.columns[0].id;
}
function parseIssueCard(path, content, statuses, board) {
  const parsed = parseFrontmatter(content);
  const values = parsed?.values ?? /* @__PURE__ */ new Map();
  const schemaVersion = parsed?.schemaVersion ?? 0;
  const statusId = normalizeStatus((values.get("status") ?? "").slice(0, 128), statuses);
  const status = statuses.statuses.find((candidate) => candidate.id === statusId);
  const boardColumn = (values.get("boardColumn") ?? "").trim().slice(0, 128);
  const statusAssociated = board.columns.some((column) => column.statusId === statusId);
  return {
    path,
    title: ((values.get("title") ?? basename(path)).trim() || basename(path)).slice(0, KANBAN_LIMITS.maxTitle),
    statusId,
    statusLabel: status?.label ?? statusId,
    assignee: (values.get("assignee") ?? "").trim().slice(0, 120),
    priority: (values.get("priority") ?? "").trim().slice(0, 120),
    tags: (values.get("tags") ?? "").trim().slice(0, 1024),
    date: (values.get("date") ?? "").trim().slice(0, 64),
    boardColumn,
    columnId: resolveIssueColumn(statusId, boardColumn, board),
    configured: void 0 !== status,
    statusAssociated,
    writable: Number.isSafeInteger(schemaVersion) && schemaVersion <= 1,
    schemaVersion
  };
}
function issueTags(raw) {
  return raw.split(/[,，\s]+/u).map((tag) => tag.trim().toLocaleLowerCase("en-US")).filter(Boolean);
}
function matchesIssueFilter(card, filter) {
  if (filter.assignee && card.assignee.toLocaleLowerCase("en-US") !== filter.assignee.toLocaleLowerCase("en-US")) {
    return false;
  }
  if (filter.priority && card.priority.toLocaleLowerCase("en-US") !== filter.priority.toLocaleLowerCase("en-US")) {
    return false;
  }
  if (filter.tag) {
    const needle = filter.tag.toLocaleLowerCase("en-US");
    if (!issueTags(card.tags).some((tag) => tag === needle || tag.includes(needle))) {
      return false;
    }
  }
  return true;
}
function groupIssuesByColumn(cards, board) {
  const grouped = new Map(board.columns.map((column) => [column.id, []]));
  for (const card of cards) {
    (grouped.get(card.columnId) ?? grouped.get(board.columns[0].id))?.push(card);
  }
  return board.columns.map((column) => ({ column, cards: grouped.get(column.id) ?? [] }));
}
function groupIssuesByStatus(cards, statuses) {
  const grouped = new Map(statuses.statuses.map((status) => [status.id, []]));
  const orphan = [];
  for (const card of cards) {
    const target = grouped.get(card.statusId);
    (target ?? orphan).push(card);
  }
  return [
    ...statuses.statuses.map((status) => ({
      id: `status:${status.id}`,
      label: status.label,
      cards: grouped.get(status.id) ?? []
    })),
    ...0 === orphan.length ? [] : [{ id: "status:unconfigured", label: "\u672A\u914D\u7F6E\u72B6\u6001", cards: orphan }]
  ];
}
function buildIssueDocument(input) {
  const title = input.title.trim().slice(0, KANBAN_LIMITS.maxTitle);
  if (!title) {
    throw new Error("Issue title is required");
  }
  const description = (input.description ?? "").trim().slice(0, KANBAN_LIMITS.maxDescription);
  return [
    "---",
    "kanbanSchema: 1",
    `status: ${yamlScalar(input.status)}`,
    `title: ${yamlScalar(title)}`,
    `priority: ${yamlScalar((input.priority ?? "medium").trim().slice(0, 120))}`,
    `assignee: ${yamlScalar((input.assignee ?? "").trim().slice(0, 120))}`,
    `tags: ${yamlScalar((input.tags ?? "").trim().slice(0, 1024))}`,
    `date: ${yamlScalar(input.date.slice(0, 64))}`,
    "---",
    "",
    "## \u63CF\u8FF0",
    "",
    description,
    ""
  ].join("\n");
}
function issuePathStem(title) {
  const stem = title.normalize("NFC").trim().replace(/[\\/:*?"<>|\u0000-\u001F]/gu, "-").replace(/\s+/gu, " ").replace(/[. ]+$/gu, "").slice(0, 100);
  return stem || "untitled";
}
function splitIssueArchiveText(text) {
  const normalized = text.replace(/\r\n?/gu, "\n").trim();
  const lines = normalized.split("\n");
  const title = (lines.shift() ?? "Untitled").trim().slice(0, 100) || "Untitled";
  return { title, body: lines.join("\n").trim() };
}

// plugins/official/kanban/src/controller.ts
var VIEW_ID = "kanban";
var OPEN_COMMAND = "mdular.kanban.open";
var NEW_COMMAND = "mdular.kanban.new-issue";
var CONFIGURE_COMMAND = "mdular.kanban.configure";
var CHAT_ARCHIVE_POINT = "mdular.chat.archive-targets";
var STATUS_PATH = "issues/ticket-statuses.json";
var BOARD_PATH = "issues/ticket-board.json";
var SETTINGS_KEY = "kanban-settings";
var MAX_EDIT_ATTEMPTS = 4;
var MAX_CONFIG_CHARACTERS = 60 * 1024;
function isRecord2(value) {
  return null !== value && "object" === typeof value && !Array.isArray(value);
}
function payloadString(action, key) {
  return isRecord2(action.payload) && "string" === typeof action.payload[key] ? action.payload[key] : null;
}
function messageFrom(error) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 480);
}
function isNotFound(error) {
  return /(?:^|\s)not-found:/u.test(messageFrom(error));
}
function emptyFilter() {
  return { assignee: "", tag: "", priority: "" };
}
function decodeFilter(value) {
  if (!isRecord2(value)) {
    return emptyFilter();
  }
  return {
    assignee: "string" === typeof value.assignee ? value.assignee.slice(0, 256).trim() : "",
    tag: "string" === typeof value.tag ? value.tag.slice(0, 256).trim() : "",
    priority: "string" === typeof value.priority ? value.priority.slice(0, 256).trim() : ""
  };
}
function decodeSettings(value) {
  if (!isRecord2(value) || 1 !== value.schemaVersion) {
    return { layout: "board", filter: emptyFilter(), presets: [] };
  }
  const presets = [];
  if (Array.isArray(value.presets)) {
    for (const candidate of value.presets.slice(0, KANBAN_LIMITS.maxPresets)) {
      if (!isRecord2(candidate) || "string" !== typeof candidate.name || !candidate.name.trim()) {
        continue;
      }
      presets.push({ name: candidate.name.trim().slice(0, 128), filter: decodeFilter(candidate.filter) });
    }
  }
  return {
    layout: "list" === value.layout ? "list" : "board",
    filter: decodeFilter(value.filter),
    presets
  };
}
function uniqueSorted(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN"));
}
function today() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
var KanbanController = class {
  #context;
  #extensions;
  #storage;
  #views;
  #workspace;
  #statuses = defaultStatusConfig();
  #board = defaultBoardConfig(this.#statuses);
  #cards = [];
  #settings = { layout: "board", filter: emptyFilter(), presets: [] };
  #mode = "board";
  #status = "Loading issues\u2026";
  #statusConfigMissing = false;
  #boardConfigMissing = false;
  #statusConfigEditable = true;
  #boardConfigEditable = true;
  #statusConfigText = "";
  #boardConfigText = "";
  #presetName = "";
  #selectedPreset = "";
  #newTitle = "";
  #newDescription = "";
  #newAssignee = "";
  #newPriority = "medium";
  #newTags = "";
  #newStatus = this.#statuses.defaultStatus;
  #queue = Promise.resolve();
  #busy = false;
  #disposed = false;
  constructor(context, services) {
    this.#context = context;
    this.#extensions = services.extensions;
    this.#storage = services.storage;
    this.#views = services.views;
    this.#workspace = services.workspace;
  }
  start() {
    this.#context.subscriptions.add(this.#views.onAction(VIEW_ID, (action) => this.#handleAction(action)));
    this.#context.subscriptions.add(this.#context.commands.register(OPEN_COMMAND, async () => {
      this.#mode = "board";
      this.#render();
      await this.#views.reveal(VIEW_ID);
      return void 0;
    }));
    this.#context.subscriptions.add(this.#context.commands.register(NEW_COMMAND, async () => {
      this.#openNew();
      await this.#views.reveal(VIEW_ID);
      return void 0;
    }));
    this.#context.subscriptions.add(this.#context.commands.register(CONFIGURE_COMMAND, async () => {
      this.#openStatusConfig();
      await this.#views.reveal(VIEW_ID);
      return void 0;
    }));
    this.#context.subscriptions.add(this.#workspace.watchMarkdown((change) => {
      if ("reset" === change.kind || change.path.toLocaleLowerCase("en-US").startsWith("issues/")) {
        this.#enqueue(() => this.#refresh());
      }
    }));
    this.#context.subscriptions.add(this.#extensions.register(CHAT_ARCHIVE_POINT, {
      id: "mdular.kanban.issues",
      label: "To Issues",
      order: 12,
      data: { schemaVersion: 1 },
      execute: async (request) => {
        if (!isRecord2(request) || 1 !== request.schemaVersion || "string" !== typeof request.text || KANBAN_LIMITS.maxDescription < request.text.length) {
          throw new Error("Kanban Chat archive request is malformed");
        }
        const { title, body } = splitIssueArchiveText(request.text);
        const path = await this.#createIssue({ title, description: body });
        this.#enqueue(() => this.#refresh());
        return { schemaVersion: 1, path };
      }
    }));
    this.#render();
    this.#enqueue(async () => {
      await this.#loadSettings();
      await this.#refresh();
    });
  }
  dispose() {
    if (this.#disposed) {
      return;
    }
    this.#disposed = true;
    this.#cards = [];
    this.#statusConfigText = "";
    this.#boardConfigText = "";
    this.#views.hide(VIEW_ID);
  }
  #enqueue(task) {
    this.#queue = this.#queue.then(async () => {
      if (!this.#disposed) {
        await task();
      }
    }).catch((error) => {
      if (this.#disposed) {
        return;
      }
      this.#busy = false;
      this.#status = `Kanban failed: ${messageFrom(error)}`;
      this.#context.logger?.warn("Kanban operation failed", { message: messageFrom(error) });
      this.#render();
    });
  }
  async #loadSettings() {
    const result = await this.#storage.get(SETTINGS_KEY);
    if (!result.ok || !result.value || 1 !== result.value.schemaVersion) {
      return;
    }
    this.#settings = decodeSettings(result.value.value);
  }
  async #saveSettings() {
    const result = await this.#storage.set(SETTINGS_KEY, {
      schemaVersion: 1,
      value: {
        schemaVersion: 1,
        layout: this.#settings.layout,
        filter: { ...this.#settings.filter },
        presets: this.#settings.presets.map((preset) => ({
          name: preset.name,
          filter: { ...preset.filter }
        }))
      }
    });
    if (!result.ok) {
      throw new Error(`${result.error.kind}: ${result.error.message}`);
    }
  }
  async #readConfig(path, parse, fallback) {
    let text;
    try {
      text = await this.#workspace.readText(path);
    } catch (error) {
      if (isNotFound(error)) {
        return { value: fallback, missing: true, editable: true };
      }
      return { value: fallback, missing: false, editable: false, warning: messageFrom(error) };
    }
    if (MAX_CONFIG_CHARACTERS < text.length) {
      return {
        value: fallback,
        missing: false,
        editable: false,
        warning: `configuration exceeds ${String(MAX_CONFIG_CHARACTERS)} characters`
      };
    }
    try {
      return { value: parse(JSON.parse(text)), missing: false, editable: true, rawText: text };
    } catch (error) {
      return {
        value: fallback,
        missing: false,
        editable: true,
        rawText: text,
        warning: messageFrom(error)
      };
    }
  }
  async #refresh() {
    this.#busy = true;
    this.#render();
    const statusResult = await this.#readConfig(
      STATUS_PATH,
      parseStatusConfig,
      defaultStatusConfig()
    );
    const boardResult = await this.#readConfig(
      BOARD_PATH,
      parseBoardConfig,
      defaultBoardConfig(statusResult.value)
    );
    this.#statuses = statusResult.value;
    this.#board = boardResult.value;
    this.#statusConfigMissing = statusResult.missing;
    this.#boardConfigMissing = boardResult.missing;
    this.#statusConfigEditable = statusResult.editable;
    this.#boardConfigEditable = boardResult.editable;
    this.#statusConfigText = statusResult.rawText ?? serializeStatusConfig(this.#statuses);
    this.#boardConfigText = boardResult.rawText ?? serializeBoardConfig(this.#board);
    if (!this.#statuses.statuses.some((status) => status.id === this.#newStatus)) {
      this.#newStatus = this.#statuses.defaultStatus;
    }
    const paths = (await this.#workspace.listMarkdown("issues")).filter((path) => path.toLocaleLowerCase("en-US").endsWith(".md")).filter((path) => !path.toLocaleLowerCase("en-US").endsWith("/readme.md")).slice(0, KANBAN_LIMITS.maxIssues);
    const cards = [];
    let totalBytes = 0;
    let skipped = 0;
    for (const path of paths) {
      try {
        const content = await this.#workspace.readMarkdown(path);
        totalBytes += new TextEncoder().encode(content).byteLength;
        if (KANBAN_LIMITS.maxTotalBytes < totalBytes) {
          throw new Error("issue text budget exceeded");
        }
        cards.push(parseIssueCard(path, content, this.#statuses, this.#board));
      } catch {
        skipped += 1;
      }
    }
    cards.sort((left, right) => left.title.localeCompare(right.title, "zh-CN"));
    this.#cards = cards;
    this.#busy = false;
    const warnings = [statusResult.warning, boardResult.warning].filter(Boolean);
    this.#status = `${cards.length} issues loaded${skipped ? ` \xB7 ${skipped} skipped` : ""}${warnings.length ? ` \xB7 config fallback: ${warnings.join("; ")}` : ""}`;
    this.#render();
  }
  async #handleAction(action) {
    if ("field" === action.type) {
      const id = payloadString(action, "id");
      const value = payloadString(action, "value");
      if (null === id || null === value) {
        throw new Error("Kanban field action is malformed");
      }
      await this.#setField(id, value);
      return;
    }
    if ("activate" === action.type) {
      const path = payloadString(action, "id");
      if (!path || !this.#cards.some((card) => card.path === path)) {
        throw new Error("Kanban issue activation is malformed");
      }
      await this.#context.navigation.openMarkdown(path);
      return;
    }
    if ("item-field" === action.type) {
      const path = payloadString(action, "id");
      const fieldId = payloadString(action, "fieldId");
      const value = payloadString(action, "value");
      if (!path || "status" !== fieldId || !value) {
        throw new Error("Kanban issue field action is malformed");
      }
      await this.#run(async () => this.#changeStatus(path, value));
      return;
    }
    if ("board-drop" === action.type) {
      const path = payloadString(action, "id");
      const columnId = payloadString(action, "columnId");
      if (!path || !columnId) {
        throw new Error("Kanban board drop is malformed");
      }
      await this.#run(async () => this.#moveIssue(path, columnId));
      return;
    }
    if ("command" !== action.type) {
      return;
    }
    const command = payloadString(action, "id");
    if (!command) {
      throw new Error("Kanban command action is malformed");
    }
    await this.#handleCommand(command);
  }
  async #setField(id, value) {
    if ("board" === this.#mode) {
      if ("assignee" === id || "tag" === id || "priority" === id) {
        this.#settings = { ...this.#settings, filter: { ...this.#settings.filter, [id]: value } };
        await this.#saveSettings();
      } else if ("preset" === id) {
        this.#selectedPreset = value;
        const preset = this.#settings.presets.find((candidate) => candidate.name === value);
        if (preset) {
          this.#settings = { ...this.#settings, filter: preset.filter };
          await this.#saveSettings();
        }
      } else if ("preset-name" === id) {
        this.#presetName = value.slice(0, 128);
      } else {
        throw new Error(`Unknown Kanban field: ${id}`);
      }
    } else if ("new" === this.#mode) {
      if ("new-title" === id) {
        this.#newTitle = value.slice(0, KANBAN_LIMITS.maxTitle);
      } else if ("new-description" === id) {
        this.#newDescription = value.slice(0, 60 * 1024);
      } else if ("new-assignee" === id) {
        this.#newAssignee = value.slice(0, 120);
      } else if ("new-priority" === id) {
        this.#newPriority = value.slice(0, 120);
      } else if ("new-tags" === id) {
        this.#newTags = value.slice(0, 1024);
      } else if ("new-status" === id) {
        this.#newStatus = value;
      } else {
        throw new Error(`Unknown new issue field: ${id}`);
      }
    } else if ("status-config" === this.#mode && "status-json" === id) {
      this.#statusConfigText = value;
    } else if ("board-config" === this.#mode && "board-json" === id) {
      this.#boardConfigText = value;
    } else {
      throw new Error(`Unknown Kanban field: ${id}`);
    }
    this.#render();
  }
  async #handleCommand(command) {
    switch (command) {
      case "new":
        this.#openNew();
        break;
      case "back":
        this.#mode = "board";
        break;
      case "toggle-layout":
        this.#settings = {
          ...this.#settings,
          layout: "board" === this.#settings.layout ? "list" : "board"
        };
        await this.#saveSettings();
        break;
      case "clear-filter":
        this.#settings = { ...this.#settings, filter: emptyFilter() };
        this.#selectedPreset = "";
        await this.#saveSettings();
        break;
      case "save-preset":
        await this.#savePreset();
        break;
      case "delete-preset":
        await this.#deletePreset();
        break;
      case "status-config":
        this.#openStatusConfig();
        break;
      case "board-config":
        this.#openBoardConfig();
        break;
      case "save-status-config":
        await this.#run(() => this.#saveStatusConfig());
        return;
      case "save-board-config":
        await this.#run(() => this.#saveBoardConfig());
        return;
      case "initialize-configs":
        await this.#run(() => this.#initializeConfigs());
        return;
      case "create-issue":
        await this.#run(() => this.#createFromForm());
        return;
      case "refresh":
        this.#enqueue(() => this.#refresh());
        return;
      default:
        throw new Error(`Unknown Kanban command: ${command}`);
    }
    this.#render();
  }
  async #run(task) {
    if (this.#busy) {
      return;
    }
    this.#busy = true;
    this.#render();
    try {
      await task();
    } catch (error) {
      this.#status = `Kanban action failed: ${messageFrom(error)}`;
    } finally {
      this.#busy = false;
      this.#render();
    }
  }
  #openNew() {
    this.#mode = "new";
    this.#newStatus = this.#statuses.defaultStatus;
    this.#status = "Preview the generated path and create a new Markdown issue.";
    this.#render();
  }
  #openStatusConfig() {
    this.#mode = "status-config";
    if (!this.#statusConfigText.trim()) {
      this.#statusConfigText = serializeStatusConfig(this.#statuses);
    }
    this.#status = this.#statusConfigEditable ? "Edit version 1 status JSON. Unknown fields are retained." : "Status configuration exceeds the editor budget or could not be read; saving is disabled.";
    this.#render();
  }
  #openBoardConfig() {
    this.#mode = "board-config";
    if (!this.#boardConfigText.trim()) {
      this.#boardConfigText = serializeBoardConfig(this.#board);
    }
    this.#status = this.#boardConfigEditable ? "Edit version 1 column JSON. Linked statuses must be unique." : "Column configuration exceeds the editor budget or could not be read; saving is disabled.";
    this.#render();
  }
  async #savePreset() {
    const name = this.#presetName.trim();
    if (!name) {
      throw new Error("Preset name is required");
    }
    const presets = this.#settings.presets.filter((preset) => preset.name !== name);
    presets.push({ name, filter: this.#settings.filter });
    presets.sort((left, right) => left.name.localeCompare(right.name, "zh-CN"));
    if (KANBAN_LIMITS.maxPresets < presets.length) {
      throw new Error("Kanban preset limit reached");
    }
    this.#settings = { ...this.#settings, presets };
    this.#selectedPreset = name;
    this.#presetName = "";
    await this.#saveSettings();
  }
  async #deletePreset() {
    if (!this.#selectedPreset) {
      return;
    }
    this.#settings = {
      ...this.#settings,
      presets: this.#settings.presets.filter((preset) => preset.name !== this.#selectedPreset)
    };
    this.#selectedPreset = "";
    await this.#saveSettings();
  }
  async #saveStatusConfig() {
    if (!this.#statusConfigEditable) {
      throw new Error("Status configuration is read-only");
    }
    const parsed = parseStatusConfig(JSON.parse(this.#statusConfigText));
    await this.#writeConfig(STATUS_PATH, serializeStatusConfig(parsed));
    this.#mode = "board";
    await this.#refresh();
  }
  async #saveBoardConfig() {
    if (!this.#boardConfigEditable) {
      throw new Error("Board configuration is read-only");
    }
    const parsed = parseBoardConfig(JSON.parse(this.#boardConfigText));
    for (const column of parsed.columns) {
      if (column.statusId && !this.#statuses.statuses.some((status) => status.id === column.statusId)) {
        throw new Error(`Column links an unknown status: ${column.statusId}`);
      }
    }
    await this.#writeConfig(BOARD_PATH, serializeBoardConfig(parsed));
    this.#mode = "board";
    await this.#refresh();
  }
  async #writeConfig(path, content) {
    let draft;
    try {
      draft = await this.#workspace.beginTextEdit(path);
    } catch (error) {
      if (!isNotFound(error)) {
        throw error;
      }
      const plan = await this.#workspace.planTextWrites([{ path, content }], "fail-if-existing");
      const result2 = await this.#workspace.commitTextWritePlan(plan.planId);
      if ("complete" === result2.status && result2.created.includes(path)) {
        return;
      }
      throw new Error(`${path} appeared concurrently; refresh before saving`);
    }
    const result = await this.#workspace.commitTextEdit(draft.editId, content);
    if ("conflict" === result.status) {
      throw new Error(`${path} changed externally; refresh before saving`);
    }
  }
  async #initializeConfigs() {
    const operations = [
      ...this.#statusConfigMissing ? [{ path: STATUS_PATH, content: serializeStatusConfig(this.#statuses) }] : [],
      ...this.#boardConfigMissing ? [{ path: BOARD_PATH, content: serializeBoardConfig(this.#board) }] : []
    ];
    if (0 === operations.length) {
      return;
    }
    const plan = await this.#workspace.planTextWrites(operations, "skip-existing");
    const result = await this.#workspace.commitTextWritePlan(plan.planId);
    if ("partial" === result.status) {
      throw new Error(`${result.failed.kind}: ${result.failed.message}`);
    }
    await this.#refresh();
  }
  async #changeStatus(path, statusId) {
    if (!this.#statuses.statuses.some((status) => status.id === statusId)) {
      throw new Error("Target issue status is unavailable");
    }
    const clearColumn = this.#board.columns.some((column) => column.statusId === statusId);
    await this.#editIssue(path, { status: statusId, ...clearColumn ? { boardColumn: null } : {} });
    await this.#refresh();
  }
  async #moveIssue(path, columnId) {
    const card = this.#cards.find((candidate) => candidate.path === path);
    const target = this.#board.columns.find((column) => column.id === columnId);
    const source = card && this.#board.columns.find((column) => column.id === card.columnId);
    if (!card || !target || target.locked || !source || source.locked || card.statusAssociated || !card.writable) {
      throw new Error("Issue cannot be moved from its current column");
    }
    await this.#editIssue(path, target.statusId ? { status: target.statusId, boardColumn: null } : { boardColumn: target.id });
    await this.#refresh();
  }
  async #editIssue(path, changes) {
    if (!this.#cards.some((card) => card.path === path)) {
      throw new Error("Issue is unavailable");
    }
    let draft = await this.#workspace.beginMarkdownEdit(path);
    for (let attempt = 0; attempt < MAX_EDIT_ATTEMPTS; attempt += 1) {
      const content = patchIssueFrontmatter(draft.content, changes);
      const result = await this.#workspace.commitMarkdownEdit(draft.editId, content);
      if ("written" === result.status) {
        return;
      }
      draft = result.current;
    }
    throw new Error(`Concurrent edits to ${path} did not settle`);
  }
  async #createFromForm() {
    const path = await this.#createIssue({
      title: this.#newTitle,
      description: this.#newDescription,
      assignee: this.#newAssignee,
      priority: this.#newPriority,
      tags: this.#newTags,
      status: this.#newStatus
    });
    this.#newTitle = "";
    this.#newDescription = "";
    this.#newAssignee = "";
    this.#newPriority = "medium";
    this.#newTags = "";
    this.#mode = "board";
    await this.#refresh();
    await this.#context.navigation.openMarkdown(path);
  }
  async #createIssue(input) {
    const status = input.status ?? this.#statuses.defaultStatus;
    if (!this.#statuses.statuses.some((candidate) => candidate.id === status)) {
      throw new Error("New issue status is unavailable");
    }
    const content = buildIssueDocument({
      title: input.title,
      status,
      ...void 0 === input.description ? {} : { description: input.description },
      ...void 0 === input.assignee ? {} : { assignee: input.assignee },
      ...void 0 === input.priority ? {} : { priority: input.priority },
      ...void 0 === input.tags ? {} : { tags: input.tags },
      date: today()
    });
    const stem = issuePathStem(input.title);
    for (let index = 0; index < 1e3; index += 1) {
      const suffix = 0 === index ? "" : ` (${String(index)})`;
      const path = `issues/${stem}${suffix}.md`;
      const plan = await this.#workspace.planTextWrites([{ path, content }], "skip-existing");
      const result = await this.#workspace.commitTextWritePlan(plan.planId);
      if (result.created.includes(path)) {
        return path;
      }
      if ("partial" === result.status && !/exist/iu.test(result.failed.kind)) {
        throw new Error(`${result.failed.kind}: ${result.failed.message}`);
      }
    }
    throw new Error("No unique issue filename was available");
  }
  #cardItem(card, draggable) {
    const options = [
      ...!card.configured ? [{ value: card.statusId, label: `${card.statusLabel} (unconfigured)` }] : [],
      ...this.#statuses.statuses.map((status) => ({ value: status.id, label: status.label }))
    ];
    return {
      id: card.path,
      title: card.title,
      description: card.path,
      badges: [
        ...card.assignee ? [`@${card.assignee}`] : [],
        ...card.priority ? [card.priority] : [],
        ...card.date ? [card.date] : [],
        ...issueTags(card.tags).slice(0, 8).map((tag) => `#${tag.slice(0, 120)}`),
        ...!card.writable ? [`schema ${String(card.schemaVersion)} read-only`] : []
      ],
      appearance: "done" === card.statusId ? "completed" : "default",
      draggable,
      fields: [{
        id: "status",
        kind: "select",
        label: "Status",
        value: card.statusId,
        options,
        readOnly: this.#busy || !card.writable
      }]
    };
  }
  #boardColumns(filtered) {
    if ("list" === this.#settings.layout) {
      return groupIssuesByStatus(filtered, this.#statuses).map((section) => ({
        id: section.id,
        title: section.label,
        locked: true,
        items: section.cards.map((card) => this.#cardItem(card, false))
      }));
    }
    return groupIssuesByColumn(filtered, this.#board).map(({ column, cards }) => ({
      id: column.id,
      title: column.label,
      locked: column.locked,
      items: cards.map((card) => this.#cardItem(
        card,
        !this.#busy && card.writable && !column.locked && !card.statusAssociated
      ))
    }));
  }
  #filterFields() {
    const select = (id, label, value, values) => ({
      id,
      kind: "select",
      label,
      value,
      options: [
        { value: "", label: `All ${label.toLocaleLowerCase("en-US")}` },
        ...values.map((entry) => ({ value: entry, label: entry }))
      ]
    });
    return [
      select(
        "assignee",
        "Assignees",
        this.#settings.filter.assignee,
        uniqueSorted(this.#cards.map((card) => card.assignee))
      ),
      { id: "tag", kind: "text", label: "Tag contains", value: this.#settings.filter.tag },
      select(
        "priority",
        "Priorities",
        this.#settings.filter.priority,
        uniqueSorted(this.#cards.map((card) => card.priority))
      ),
      {
        id: "preset",
        kind: "select",
        label: "Filter preset",
        value: this.#settings.presets.some((preset) => preset.name === this.#selectedPreset) ? this.#selectedPreset : "",
        options: [
          { value: "", label: "Choose preset" },
          ...this.#settings.presets.map((preset) => ({ value: preset.name, label: preset.name }))
        ]
      },
      { id: "preset-name", kind: "text", label: "Preset name", value: this.#presetName }
    ];
  }
  #render() {
    if (this.#disposed) {
      return;
    }
    if ("board" === this.#mode) {
      this.#renderBoard();
      return;
    }
    if ("new" === this.#mode) {
      this.#renderNew();
      return;
    }
    this.#renderConfig();
  }
  #renderBoard() {
    const filtered = this.#cards.filter((card) => matchesIssueFilter(card, this.#settings.filter));
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: "board",
      title: "Kanban",
      layout: this.#settings.layout,
      fields: this.#filterFields(),
      actions: [
        { id: "new", label: "New issue", tone: "primary", disabled: this.#busy },
        {
          id: "toggle-layout",
          label: "board" === this.#settings.layout ? "List view" : "Board view",
          disabled: this.#busy
        },
        { id: "clear-filter", label: "Clear filters", disabled: this.#busy },
        { id: "save-preset", label: "Save preset", disabled: this.#busy || !this.#presetName.trim() },
        { id: "delete-preset", label: "Delete preset", disabled: this.#busy || !this.#selectedPreset },
        { id: "status-config", label: "Statuses", disabled: this.#busy },
        { id: "board-config", label: "Columns", disabled: this.#busy },
        ...this.#statusConfigMissing || this.#boardConfigMissing ? [{ id: "initialize-configs", label: "Create config files", disabled: this.#busy }] : [],
        { id: "refresh", label: "Refresh", disabled: this.#busy }
      ],
      status: `${this.#status} \xB7 showing ${filtered.length} / ${this.#cards.length}`,
      busy: this.#busy,
      emptyMessage: "No issues match the current filters.",
      columns: this.#boardColumns(filtered)
    });
  }
  #renderNew() {
    const title = this.#newTitle.trim();
    const previewPath = `issues/${issuePathStem(title)}.md`;
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: "collection",
      title: "New issue",
      fields: [
        { id: "new-title", kind: "text", label: "Title", value: this.#newTitle },
        { id: "new-description", kind: "textarea", label: "Description", value: this.#newDescription, rows: 10 },
        { id: "new-assignee", kind: "text", label: "Assignee", value: this.#newAssignee },
        { id: "new-priority", kind: "text", label: "Priority", value: this.#newPriority },
        { id: "new-tags", kind: "text", label: "Tags", value: this.#newTags },
        {
          id: "new-status",
          kind: "select",
          label: "Status",
          value: this.#newStatus,
          options: this.#statuses.statuses.map((status) => ({ value: status.id, label: status.label }))
        }
      ],
      actions: [
        { id: "create-issue", label: "Create", tone: "primary", disabled: this.#busy || !title },
        { id: "back", label: "Back", disabled: this.#busy }
      ],
      status: `${this.#status} \xB7 candidate ${previewPath}; collisions receive a numeric suffix.`,
      busy: this.#busy,
      items: []
    });
  }
  #renderConfig() {
    const statusMode = "status-config" === this.#mode;
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: "collection",
      title: statusMode ? "Kanban statuses" : "Kanban columns",
      fields: [{
        id: statusMode ? "status-json" : "board-json",
        kind: "textarea",
        label: statusMode ? STATUS_PATH : BOARD_PATH,
        value: statusMode ? this.#statusConfigText : this.#boardConfigText,
        rows: 24
      }],
      actions: [
        {
          id: statusMode ? "save-status-config" : "save-board-config",
          label: "Validate and save",
          tone: "primary",
          disabled: this.#busy || !(statusMode ? this.#statusConfigEditable : this.#boardConfigEditable)
        },
        { id: "back", label: "Back", disabled: this.#busy }
      ],
      status: this.#status,
      busy: this.#busy,
      items: []
    });
  }
};

// plugins/official/kanban/src/index.ts
var pluginManifest = definePluginManifest(plugin_default);
function workspaceServices(context) {
  const workspace = context.workspace;
  if (!workspace?.beginMarkdownEdit || !workspace.beginTextEdit || !workspace.commitMarkdownEdit || !workspace.commitTextEdit || !workspace.commitTextWritePlan || !workspace.listMarkdown || !workspace.planTextWrites || !workspace.readMarkdown || !workspace.readText || !workspace.watchMarkdown) {
    throw new Error("Kanban requires bounded workspace read, watch, create and modify access");
  }
  return {
    beginMarkdownEdit: workspace.beginMarkdownEdit,
    beginTextEdit: workspace.beginTextEdit,
    commitMarkdownEdit: workspace.commitMarkdownEdit,
    commitTextEdit: workspace.commitTextEdit,
    commitTextWritePlan: workspace.commitTextWritePlan,
    listMarkdown: workspace.listMarkdown,
    planTextWrites: workspace.planTextWrites,
    readMarkdown: workspace.readMarkdown,
    readText: workspace.readText,
    watchMarkdown: workspace.watchMarkdown
  };
}
var plugin = definePlugin({
  activate(context) {
    if (!context.commands) {
      throw new Error("Kanban requires commands");
    }
    if (!context.extensions) {
      throw new Error("Kanban requires extension registration");
    }
    if (!context.navigation) {
      throw new Error("Kanban requires Markdown navigation");
    }
    if (!context.storage) {
      throw new Error("Kanban requires workspace storage");
    }
    if (!context.views) {
      throw new Error("Kanban requires ui.views");
    }
    const controller = new KanbanController(context, {
      extensions: context.extensions,
      storage: context.storage,
      views: context.views,
      workspace: workspaceServices(context)
    });
    controller.start();
    return controller;
  }
});
var index_default = plugin;
export {
  KANBAN_LIMITS,
  buildIssueDocument,
  index_default as default,
  defaultBoardConfig,
  defaultStatusConfig,
  groupIssuesByColumn,
  groupIssuesByStatus,
  issuePathStem,
  issueTags,
  matchesIssueFilter,
  normalizeStatus,
  parseBoardConfig,
  parseIssueCard,
  parseStatusConfig,
  patchIssueFrontmatter,
  pluginManifest,
  resolveIssueColumn,
  serializeBoardConfig,
  serializeStatusConfig,
  splitIssueArchiveText
};

export const pluginContentHash="sha256:86a553860c7bb7305bca4d568f0fa769023608d4cd148f7d5ff117f9ba5e72e8";
