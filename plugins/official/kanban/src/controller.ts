import type {
  Disposable,
  JsonValue,
  PluginBoardColumn,
  PluginBoardItem,
  PluginContext,
  PluginExtensionService,
  PluginFormField,
  PluginStorageService,
  PluginViewAction,
  PluginViewService,
  PluginWorkspaceService,
  TextEditDraft,
} from '@mdular/plugin-sdk';

import {
  buildIssueDocument,
  defaultBoardConfig,
  defaultStatusConfig,
  groupIssuesByColumn,
  groupIssuesByStatus,
  issuePathStem,
  issueTags,
  KANBAN_LIMITS,
  matchesIssueFilter,
  parseBoardConfig,
  parseIssueCard,
  parseStatusConfig,
  patchIssueFrontmatter,
  serializeBoardConfig,
  serializeStatusConfig,
  splitIssueArchiveText,
} from './model.js';
import type {
  BoardConfig,
  IssueCard,
  KanbanFilter,
  KanbanFilterPreset,
  StatusConfig,
} from './model.js';

const VIEW_ID = 'kanban';
const OPEN_COMMAND = 'mdular.kanban.open';
const NEW_COMMAND = 'mdular.kanban.new-issue';
const CONFIGURE_COMMAND = 'mdular.kanban.configure';
const CHAT_ARCHIVE_POINT = 'mdular.chat.archive-targets';
const STATUS_PATH = 'issues/ticket-statuses.json';
const BOARD_PATH = 'issues/ticket-board.json';
const SETTINGS_KEY = 'kanban-settings';
const MAX_EDIT_ATTEMPTS = 4;
const MAX_CONFIG_CHARACTERS = 60 * 1024;

type KanbanWorkspace = Required<Pick<
  PluginWorkspaceService,
  | 'beginMarkdownEdit'
  | 'beginTextEdit'
  | 'commitMarkdownEdit'
  | 'commitTextEdit'
  | 'commitTextWritePlan'
  | 'listMarkdown'
  | 'planTextWrites'
  | 'readMarkdown'
  | 'readText'
  | 'watchMarkdown'
>>;

type ViewMode = 'board' | 'new' | 'status-config' | 'board-config';

interface Settings {
  readonly layout: 'board' | 'list';
  readonly filter: KanbanFilter;
  readonly presets: readonly KanbanFilterPreset[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

function payloadString(action: PluginViewAction, key: string): string | null {
  return isRecord(action.payload) && 'string' === typeof action.payload[key]
    ? action.payload[key] as string
    : null;
}

function messageFrom(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 480);
}

function isNotFound(error: unknown): boolean {
  return /(?:^|\s)not-found:/u.test(messageFrom(error));
}

function emptyFilter(): KanbanFilter {
  return { assignee: '', tag: '', priority: '' };
}

function decodeFilter(value: unknown): KanbanFilter {
  if (!isRecord(value)) { return emptyFilter(); }
  return {
    assignee: 'string' === typeof value.assignee ? value.assignee.slice(0, 256).trim() : '',
    tag: 'string' === typeof value.tag ? value.tag.slice(0, 256).trim() : '',
    priority: 'string' === typeof value.priority ? value.priority.slice(0, 256).trim() : '',
  };
}

function decodeSettings(value: unknown): Settings {
  if (!isRecord(value) || 1 !== value.schemaVersion) {
    return { layout: 'board', filter: emptyFilter(), presets: [] };
  }
  const presets: KanbanFilterPreset[] = [];
  if (Array.isArray(value.presets)) {
    for (const candidate of value.presets.slice(0, KANBAN_LIMITS.maxPresets)) {
      if (!isRecord(candidate) || 'string' !== typeof candidate.name || !candidate.name.trim()) {
        continue;
      }
      presets.push({ name: candidate.name.trim().slice(0, 128), filter: decodeFilter(candidate.filter) });
    }
  }
  return {
    layout: 'list' === value.layout ? 'list' : 'board',
    filter: decodeFilter(value.filter),
    presets,
  };
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, 'zh-CN'));
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export class KanbanController implements Disposable {
  readonly #context: PluginContext;
  readonly #extensions: PluginExtensionService;
  readonly #storage: PluginStorageService;
  readonly #views: PluginViewService;
  readonly #workspace: KanbanWorkspace;
  #statuses = defaultStatusConfig();
  #board = defaultBoardConfig(this.#statuses);
  #cards: readonly IssueCard[] = [];
  #settings: Settings = { layout: 'board', filter: emptyFilter(), presets: [] };
  #mode: ViewMode = 'board';
  #status = 'Loading issues…';
  #statusConfigMissing = false;
  #boardConfigMissing = false;
  #statusConfigEditable = true;
  #boardConfigEditable = true;
  #statusConfigText = '';
  #boardConfigText = '';
  #presetName = '';
  #selectedPreset = '';
  #newTitle = '';
  #newDescription = '';
  #newAssignee = '';
  #newPriority = 'medium';
  #newTags = '';
  #newStatus = this.#statuses.defaultStatus;
  #queue: Promise<void> = Promise.resolve();
  #busy = false;
  #disposed = false;

  public constructor(context: PluginContext, services: {
    readonly extensions: PluginExtensionService;
    readonly storage: PluginStorageService;
    readonly views: PluginViewService;
    readonly workspace: KanbanWorkspace;
  }) {
    this.#context = context;
    this.#extensions = services.extensions;
    this.#storage = services.storage;
    this.#views = services.views;
    this.#workspace = services.workspace;
  }

  public start(): void {
    this.#context.subscriptions.add(this.#views.onAction(VIEW_ID, (action) =>
      this.#handleAction(action)));
    this.#context.subscriptions.add(this.#context.commands!.register(OPEN_COMMAND, async () => {
      this.#mode = 'board';
      this.#render();
      await this.#views.reveal(VIEW_ID);
      return undefined;
    }));
    this.#context.subscriptions.add(this.#context.commands!.register(NEW_COMMAND, async () => {
      this.#openNew();
      await this.#views.reveal(VIEW_ID);
      return undefined;
    }));
    this.#context.subscriptions.add(this.#context.commands!.register(CONFIGURE_COMMAND, async () => {
      this.#openStatusConfig();
      await this.#views.reveal(VIEW_ID);
      return undefined;
    }));
    this.#context.subscriptions.add(this.#workspace.watchMarkdown((change) => {
      if ('reset' === change.kind || change.path.toLocaleLowerCase('en-US').startsWith('issues/')) {
        this.#enqueue(() => this.#refresh());
      }
    }));
    this.#context.subscriptions.add(this.#extensions.register(CHAT_ARCHIVE_POINT, {
      id: 'mdular.kanban.issues',
      label: 'To Issues',
      order: 12,
      data: { schemaVersion: 1 },
      execute: async (request) => {
        if (!isRecord(request) || 1 !== request.schemaVersion ||
            'string' !== typeof request.text || KANBAN_LIMITS.maxDescription < request.text.length) {
          throw new Error('Kanban Chat archive request is malformed');
        }
        const { title, body } = splitIssueArchiveText(request.text);
        const path = await this.#createIssue({ title, description: body });
        this.#enqueue(() => this.#refresh());
        return { schemaVersion: 1, path };
      },
    }));
    this.#render();
    this.#enqueue(async () => {
      await this.#loadSettings();
      await this.#refresh();
    });
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#cards = [];
    this.#statusConfigText = '';
    this.#boardConfigText = '';
    this.#views.hide(VIEW_ID);
  }

  #enqueue(task: () => Promise<void>): void {
    this.#queue = this.#queue.then(async () => {
      if (!this.#disposed) { await task(); }
    }).catch((error: unknown) => {
      if (this.#disposed) { return; }
      this.#busy = false;
      this.#status = `Kanban failed: ${messageFrom(error)}`;
      this.#context.logger?.warn('Kanban operation failed', { message: messageFrom(error) });
      this.#render();
    });
  }

  async #loadSettings(): Promise<void> {
    const result = await this.#storage.get(SETTINGS_KEY);
    if (!result.ok || !result.value || 1 !== result.value.schemaVersion) { return; }
    this.#settings = decodeSettings(result.value.value);
  }

  async #saveSettings(): Promise<void> {
    const result = await this.#storage.set(SETTINGS_KEY, {
      schemaVersion: 1,
      value: {
        schemaVersion: 1,
        layout: this.#settings.layout,
        filter: { ...this.#settings.filter },
        presets: this.#settings.presets.map((preset) => ({
          name: preset.name,
          filter: { ...preset.filter },
        })),
      } satisfies JsonValue,
    });
    if (!result.ok) { throw new Error(`${result.error.kind}: ${result.error.message}`); }
  }

  async #readConfig<T>(
    path: string,
    parse: (value: unknown) => T,
    fallback: T,
  ): Promise<{
    readonly value: T;
    readonly missing: boolean;
    readonly editable: boolean;
    readonly rawText?: string;
    readonly warning?: string;
  }> {
    let text: string;
    try {
      text = await this.#workspace.readText(path);
    } catch (error) {
      if (isNotFound(error)) { return { value: fallback, missing: true, editable: true }; }
      return { value: fallback, missing: false, editable: false, warning: messageFrom(error) };
    }
    if (MAX_CONFIG_CHARACTERS < text.length) {
      return {
        value: fallback,
        missing: false,
        editable: false,
        warning: `configuration exceeds ${String(MAX_CONFIG_CHARACTERS)} characters`,
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
        warning: messageFrom(error),
      };
    }
  }

  async #refresh(): Promise<void> {
    this.#busy = true;
    this.#render();
    const statusResult = await this.#readConfig(
      STATUS_PATH,
      parseStatusConfig,
      defaultStatusConfig(),
    );
    const boardResult = await this.#readConfig(
      BOARD_PATH,
      parseBoardConfig,
      defaultBoardConfig(statusResult.value),
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
    const paths = (await this.#workspace.listMarkdown('issues'))
      .filter((path) => path.toLocaleLowerCase('en-US').endsWith('.md'))
      .filter((path) => !path.toLocaleLowerCase('en-US').endsWith('/readme.md'))
      .slice(0, KANBAN_LIMITS.maxIssues);
    const cards: IssueCard[] = [];
    let totalBytes = 0;
    let skipped = 0;
    for (const path of paths) {
      try {
        const content = await this.#workspace.readMarkdown(path);
        totalBytes += new TextEncoder().encode(content).byteLength;
        if (KANBAN_LIMITS.maxTotalBytes < totalBytes) { throw new Error('issue text budget exceeded'); }
        cards.push(parseIssueCard(path, content, this.#statuses, this.#board));
      } catch {
        skipped += 1;
      }
    }
    cards.sort((left, right) => left.title.localeCompare(right.title, 'zh-CN'));
    this.#cards = cards;
    this.#busy = false;
    const warnings = [statusResult.warning, boardResult.warning].filter(Boolean);
    this.#status = `${cards.length} issues loaded${skipped ? ` · ${skipped} skipped` : ''}` +
      `${warnings.length ? ` · config fallback: ${warnings.join('; ')}` : ''}`;
    this.#render();
  }

  async #handleAction(action: PluginViewAction): Promise<void> {
    if ('field' === action.type) {
      const id = payloadString(action, 'id');
      const value = payloadString(action, 'value');
      if (null === id || null === value) { throw new Error('Kanban field action is malformed'); }
      await this.#setField(id, value);
      return;
    }
    if ('activate' === action.type) {
      const path = payloadString(action, 'id');
      if (!path || !this.#cards.some((card) => card.path === path)) {
        throw new Error('Kanban issue activation is malformed');
      }
      await this.#context.navigation!.openMarkdown(path);
      return;
    }
    if ('item-field' === action.type) {
      const path = payloadString(action, 'id');
      const fieldId = payloadString(action, 'fieldId');
      const value = payloadString(action, 'value');
      if (!path || 'status' !== fieldId || !value) {
        throw new Error('Kanban issue field action is malformed');
      }
      await this.#run(async () => this.#changeStatus(path, value));
      return;
    }
    if ('board-drop' === action.type) {
      const path = payloadString(action, 'id');
      const columnId = payloadString(action, 'columnId');
      if (!path || !columnId) { throw new Error('Kanban board drop is malformed'); }
      await this.#run(async () => this.#moveIssue(path, columnId));
      return;
    }
    if ('command' !== action.type) { return; }
    const command = payloadString(action, 'id');
    if (!command) { throw new Error('Kanban command action is malformed'); }
    await this.#handleCommand(command);
  }

  async #setField(id: string, value: string): Promise<void> {
    if ('board' === this.#mode) {
      if ('assignee' === id || 'tag' === id || 'priority' === id) {
        this.#settings = { ...this.#settings, filter: { ...this.#settings.filter, [id]: value } };
        await this.#saveSettings();
      } else if ('preset' === id) {
        this.#selectedPreset = value;
        const preset = this.#settings.presets.find((candidate) => candidate.name === value);
        if (preset) {
          this.#settings = { ...this.#settings, filter: preset.filter };
          await this.#saveSettings();
        }
      } else if ('preset-name' === id) {
        this.#presetName = value.slice(0, 128);
      } else {
        throw new Error(`Unknown Kanban field: ${id}`);
      }
    } else if ('new' === this.#mode) {
      if ('new-title' === id) { this.#newTitle = value.slice(0, KANBAN_LIMITS.maxTitle); }
      else if ('new-description' === id) { this.#newDescription = value.slice(0, 60 * 1024); }
      else if ('new-assignee' === id) { this.#newAssignee = value.slice(0, 120); }
      else if ('new-priority' === id) { this.#newPriority = value.slice(0, 120); }
      else if ('new-tags' === id) { this.#newTags = value.slice(0, 1024); }
      else if ('new-status' === id) { this.#newStatus = value; }
      else { throw new Error(`Unknown new issue field: ${id}`); }
    } else if ('status-config' === this.#mode && 'status-json' === id) {
      this.#statusConfigText = value;
    } else if ('board-config' === this.#mode && 'board-json' === id) {
      this.#boardConfigText = value;
    } else {
      throw new Error(`Unknown Kanban field: ${id}`);
    }
    this.#render();
  }

  async #handleCommand(command: string): Promise<void> {
    switch (command) {
      case 'new': this.#openNew(); break;
      case 'back': this.#mode = 'board'; break;
      case 'toggle-layout':
        this.#settings = {
          ...this.#settings,
          layout: 'board' === this.#settings.layout ? 'list' : 'board',
        };
        await this.#saveSettings();
        break;
      case 'clear-filter':
        this.#settings = { ...this.#settings, filter: emptyFilter() };
        this.#selectedPreset = '';
        await this.#saveSettings();
        break;
      case 'save-preset': await this.#savePreset(); break;
      case 'delete-preset': await this.#deletePreset(); break;
      case 'status-config': this.#openStatusConfig(); break;
      case 'board-config': this.#openBoardConfig(); break;
      case 'save-status-config': await this.#run(() => this.#saveStatusConfig()); return;
      case 'save-board-config': await this.#run(() => this.#saveBoardConfig()); return;
      case 'initialize-configs': await this.#run(() => this.#initializeConfigs()); return;
      case 'create-issue': await this.#run(() => this.#createFromForm()); return;
      case 'refresh': this.#enqueue(() => this.#refresh()); return;
      default: throw new Error(`Unknown Kanban command: ${command}`);
    }
    this.#render();
  }

  async #run(task: () => Promise<void>): Promise<void> {
    if (this.#busy) { return; }
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

  #openNew(): void {
    this.#mode = 'new';
    this.#newStatus = this.#statuses.defaultStatus;
    this.#status = 'Preview the generated path and create a new Markdown issue.';
    this.#render();
  }

  #openStatusConfig(): void {
    this.#mode = 'status-config';
    if (!this.#statusConfigText.trim()) {
      this.#statusConfigText = serializeStatusConfig(this.#statuses);
    }
    this.#status = this.#statusConfigEditable
      ? 'Edit version 1 status JSON. Unknown fields are retained.'
      : 'Status configuration exceeds the editor budget or could not be read; saving is disabled.';
    this.#render();
  }

  #openBoardConfig(): void {
    this.#mode = 'board-config';
    if (!this.#boardConfigText.trim()) {
      this.#boardConfigText = serializeBoardConfig(this.#board);
    }
    this.#status = this.#boardConfigEditable
      ? 'Edit version 1 column JSON. Linked statuses must be unique.'
      : 'Column configuration exceeds the editor budget or could not be read; saving is disabled.';
    this.#render();
  }

  async #savePreset(): Promise<void> {
    const name = this.#presetName.trim();
    if (!name) { throw new Error('Preset name is required'); }
    const presets = this.#settings.presets.filter((preset) => preset.name !== name);
    presets.push({ name, filter: this.#settings.filter });
    presets.sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
    if (KANBAN_LIMITS.maxPresets < presets.length) { throw new Error('Kanban preset limit reached'); }
    this.#settings = { ...this.#settings, presets };
    this.#selectedPreset = name;
    this.#presetName = '';
    await this.#saveSettings();
  }

  async #deletePreset(): Promise<void> {
    if (!this.#selectedPreset) { return; }
    this.#settings = {
      ...this.#settings,
      presets: this.#settings.presets.filter((preset) => preset.name !== this.#selectedPreset),
    };
    this.#selectedPreset = '';
    await this.#saveSettings();
  }

  async #saveStatusConfig(): Promise<void> {
    if (!this.#statusConfigEditable) { throw new Error('Status configuration is read-only'); }
    const parsed = parseStatusConfig(JSON.parse(this.#statusConfigText));
    await this.#writeConfig(STATUS_PATH, serializeStatusConfig(parsed));
    this.#mode = 'board';
    await this.#refresh();
  }

  async #saveBoardConfig(): Promise<void> {
    if (!this.#boardConfigEditable) { throw new Error('Board configuration is read-only'); }
    const parsed = parseBoardConfig(JSON.parse(this.#boardConfigText));
    for (const column of parsed.columns) {
      if (column.statusId && !this.#statuses.statuses.some((status) => status.id === column.statusId)) {
        throw new Error(`Column links an unknown status: ${column.statusId}`);
      }
    }
    await this.#writeConfig(BOARD_PATH, serializeBoardConfig(parsed));
    this.#mode = 'board';
    await this.#refresh();
  }

  async #writeConfig(path: string, content: string): Promise<void> {
    let draft: TextEditDraft;
    try {
      draft = await this.#workspace.beginTextEdit(path);
    } catch (error) {
      if (!isNotFound(error)) { throw error; }
      const plan = await this.#workspace.planTextWrites([{ path, content }], 'fail-if-existing');
      const result = await this.#workspace.commitTextWritePlan(plan.planId);
      if ('complete' === result.status && result.created.includes(path)) { return; }
      throw new Error(`${path} appeared concurrently; refresh before saving`);
    }
    const result = await this.#workspace.commitTextEdit(draft.editId, content);
    if ('conflict' === result.status) {
      throw new Error(`${path} changed externally; refresh before saving`);
    }
  }

  async #initializeConfigs(): Promise<void> {
    const operations = [
      ...(this.#statusConfigMissing
        ? [{ path: STATUS_PATH, content: serializeStatusConfig(this.#statuses) }]
        : []),
      ...(this.#boardConfigMissing
        ? [{ path: BOARD_PATH, content: serializeBoardConfig(this.#board) }]
        : []),
    ];
    if (0 === operations.length) { return; }
    const plan = await this.#workspace.planTextWrites(operations, 'skip-existing');
    const result = await this.#workspace.commitTextWritePlan(plan.planId);
    if ('partial' === result.status) {
      throw new Error(`${result.failed.kind}: ${result.failed.message}`);
    }
    await this.#refresh();
  }

  async #changeStatus(path: string, statusId: string): Promise<void> {
    if (!this.#statuses.statuses.some((status) => status.id === statusId)) {
      throw new Error('Target issue status is unavailable');
    }
    const clearColumn = this.#board.columns.some((column) => column.statusId === statusId);
    await this.#editIssue(path, { status: statusId, ...(clearColumn ? { boardColumn: null } : {}) });
    await this.#refresh();
  }

  async #moveIssue(path: string, columnId: string): Promise<void> {
    const card = this.#cards.find((candidate) => candidate.path === path);
    const target = this.#board.columns.find((column) => column.id === columnId);
    const source = card && this.#board.columns.find((column) => column.id === card.columnId);
    if (!card || !target || target.locked || !source || source.locked ||
        card.statusAssociated || !card.writable) {
      throw new Error('Issue cannot be moved from its current column');
    }
    await this.#editIssue(path, target.statusId
      ? { status: target.statusId, boardColumn: null }
      : { boardColumn: target.id });
    await this.#refresh();
  }

  async #editIssue(path: string, changes: Readonly<Record<string, string | null>>): Promise<void> {
    if (!this.#cards.some((card) => card.path === path)) { throw new Error('Issue is unavailable'); }
    let draft = await this.#workspace.beginMarkdownEdit(path);
    for (let attempt = 0; attempt < MAX_EDIT_ATTEMPTS; attempt += 1) {
      const content = patchIssueFrontmatter(draft.content, changes);
      const result = await this.#workspace.commitMarkdownEdit(draft.editId, content);
      if ('written' === result.status) { return; }
      draft = result.current;
    }
    throw new Error(`Concurrent edits to ${path} did not settle`);
  }

  async #createFromForm(): Promise<void> {
    const path = await this.#createIssue({
      title: this.#newTitle,
      description: this.#newDescription,
      assignee: this.#newAssignee,
      priority: this.#newPriority,
      tags: this.#newTags,
      status: this.#newStatus,
    });
    this.#newTitle = '';
    this.#newDescription = '';
    this.#newAssignee = '';
    this.#newPriority = 'medium';
    this.#newTags = '';
    this.#mode = 'board';
    await this.#refresh();
    await this.#context.navigation!.openMarkdown(path);
  }

  async #createIssue(input: {
    readonly title: string;
    readonly description?: string;
    readonly assignee?: string;
    readonly priority?: string;
    readonly tags?: string;
    readonly status?: string;
  }): Promise<string> {
    const status = input.status ?? this.#statuses.defaultStatus;
    if (!this.#statuses.statuses.some((candidate) => candidate.id === status)) {
      throw new Error('New issue status is unavailable');
    }
    const content = buildIssueDocument({
      title: input.title,
      status,
      ...(undefined === input.description ? {} : { description: input.description }),
      ...(undefined === input.assignee ? {} : { assignee: input.assignee }),
      ...(undefined === input.priority ? {} : { priority: input.priority }),
      ...(undefined === input.tags ? {} : { tags: input.tags }),
      date: today(),
    });
    const stem = issuePathStem(input.title);
    for (let index = 0; index < 1_000; index += 1) {
      const suffix = 0 === index ? '' : ` (${String(index)})`;
      const path = `issues/${stem}${suffix}.md`;
      const plan = await this.#workspace.planTextWrites([{ path, content }], 'skip-existing');
      const result = await this.#workspace.commitTextWritePlan(plan.planId);
      if (result.created.includes(path)) { return path; }
      if ('partial' === result.status && !/exist/iu.test(result.failed.kind)) {
        throw new Error(`${result.failed.kind}: ${result.failed.message}`);
      }
    }
    throw new Error('No unique issue filename was available');
  }

  #cardItem(card: IssueCard, draggable: boolean): PluginBoardItem {
    const options = [
      ...(!card.configured ? [{ value: card.statusId, label: `${card.statusLabel} (unconfigured)` }] : []),
      ...this.#statuses.statuses.map((status) => ({ value: status.id, label: status.label })),
    ];
    return {
      id: card.path,
      title: card.title,
      description: card.path,
      badges: [
        ...(card.assignee ? [`@${card.assignee}`] : []),
        ...(card.priority ? [card.priority] : []),
        ...(card.date ? [card.date] : []),
        ...issueTags(card.tags).slice(0, 8).map((tag) => `#${tag.slice(0, 120)}`),
        ...(!card.writable ? [`schema ${String(card.schemaVersion)} read-only`] : []),
      ],
      appearance: 'done' === card.statusId ? 'completed' : 'default',
      draggable,
      fields: [{
        id: 'status',
        kind: 'select',
        label: 'Status',
        value: card.statusId,
        options,
        readOnly: this.#busy || !card.writable,
      }],
    };
  }

  #boardColumns(filtered: readonly IssueCard[]): readonly PluginBoardColumn[] {
    if ('list' === this.#settings.layout) {
      return groupIssuesByStatus(filtered, this.#statuses).map((section) => ({
        id: section.id,
        title: section.label,
        locked: true,
        items: section.cards.map((card) => this.#cardItem(card, false)),
      }));
    }
    return groupIssuesByColumn(filtered, this.#board).map(({ column, cards }) => ({
      id: column.id,
      title: column.label,
      locked: column.locked,
      items: cards.map((card) => this.#cardItem(
        card,
        !this.#busy && card.writable && !column.locked && !card.statusAssociated,
      )),
    }));
  }

  #filterFields(): readonly PluginFormField[] {
    const select = (id: string, label: string, value: string, values: readonly string[]): PluginFormField => ({
      id,
      kind: 'select',
      label,
      value,
      options: [{ value: '', label: `All ${label.toLocaleLowerCase('en-US')}` },
        ...values.map((entry) => ({ value: entry, label: entry }))],
    });
    return [
      select('assignee', 'Assignees', this.#settings.filter.assignee,
        uniqueSorted(this.#cards.map((card) => card.assignee))),
      { id: 'tag', kind: 'text', label: 'Tag contains', value: this.#settings.filter.tag },
      select('priority', 'Priorities', this.#settings.filter.priority,
        uniqueSorted(this.#cards.map((card) => card.priority))),
      {
        id: 'preset',
        kind: 'select',
        label: 'Filter preset',
        value: this.#settings.presets.some((preset) => preset.name === this.#selectedPreset)
          ? this.#selectedPreset : '',
        options: [{ value: '', label: 'Choose preset' },
          ...this.#settings.presets.map((preset) => ({ value: preset.name, label: preset.name }))],
      },
      { id: 'preset-name', kind: 'text', label: 'Preset name', value: this.#presetName },
    ];
  }

  #render(): void {
    if (this.#disposed) { return; }
    if ('board' === this.#mode) { this.#renderBoard(); return; }
    if ('new' === this.#mode) { this.#renderNew(); return; }
    this.#renderConfig();
  }

  #renderBoard(): void {
    const filtered = this.#cards.filter((card) => matchesIssueFilter(card, this.#settings.filter));
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: 'board',
      title: 'Kanban',
      layout: this.#settings.layout,
      fields: this.#filterFields(),
      actions: [
        { id: 'new', label: 'New issue', tone: 'primary', disabled: this.#busy },
        {
          id: 'toggle-layout',
          label: 'board' === this.#settings.layout ? 'List view' : 'Board view',
          disabled: this.#busy,
        },
        { id: 'clear-filter', label: 'Clear filters', disabled: this.#busy },
        { id: 'save-preset', label: 'Save preset', disabled: this.#busy || !this.#presetName.trim() },
        { id: 'delete-preset', label: 'Delete preset', disabled: this.#busy || !this.#selectedPreset },
        { id: 'status-config', label: 'Statuses', disabled: this.#busy },
        { id: 'board-config', label: 'Columns', disabled: this.#busy },
        ...((this.#statusConfigMissing || this.#boardConfigMissing)
          ? [{ id: 'initialize-configs', label: 'Create config files', disabled: this.#busy }]
          : []),
        { id: 'refresh', label: 'Refresh', disabled: this.#busy },
      ],
      status: `${this.#status} · showing ${filtered.length} / ${this.#cards.length}`,
      busy: this.#busy,
      emptyMessage: 'No issues match the current filters.',
      columns: this.#boardColumns(filtered),
    });
  }

  #renderNew(): void {
    const title = this.#newTitle.trim();
    const previewPath = `issues/${issuePathStem(title)}.md`;
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: 'collection',
      title: 'New issue',
      fields: [
        { id: 'new-title', kind: 'text', label: 'Title', value: this.#newTitle },
        { id: 'new-description', kind: 'textarea', label: 'Description', value: this.#newDescription, rows: 10 },
        { id: 'new-assignee', kind: 'text', label: 'Assignee', value: this.#newAssignee },
        { id: 'new-priority', kind: 'text', label: 'Priority', value: this.#newPriority },
        { id: 'new-tags', kind: 'text', label: 'Tags', value: this.#newTags },
        {
          id: 'new-status',
          kind: 'select',
          label: 'Status',
          value: this.#newStatus,
          options: this.#statuses.statuses.map((status) => ({ value: status.id, label: status.label })),
        },
      ],
      actions: [
        { id: 'create-issue', label: 'Create', tone: 'primary', disabled: this.#busy || !title },
        { id: 'back', label: 'Back', disabled: this.#busy },
      ],
      status: `${this.#status} · candidate ${previewPath}; collisions receive a numeric suffix.`,
      busy: this.#busy,
      items: [],
    });
  }

  #renderConfig(): void {
    const statusMode = 'status-config' === this.#mode;
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: 'collection',
      title: statusMode ? 'Kanban statuses' : 'Kanban columns',
      fields: [{
        id: statusMode ? 'status-json' : 'board-json',
        kind: 'textarea',
        label: statusMode ? STATUS_PATH : BOARD_PATH,
        value: statusMode ? this.#statusConfigText : this.#boardConfigText,
        rows: 24,
      }],
      actions: [
        {
          id: statusMode ? 'save-status-config' : 'save-board-config',
          label: 'Validate and save',
          tone: 'primary',
          disabled: this.#busy || !(statusMode
            ? this.#statusConfigEditable
            : this.#boardConfigEditable),
        },
        { id: 'back', label: 'Back', disabled: this.#busy },
      ],
      status: this.#status,
      busy: this.#busy,
      items: [],
    });
  }
}
