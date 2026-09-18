import {
  DOCUMENT_POLICY_EXTENSION_POINT,
  definePlugin,
  definePluginManifest,
} from '@mdular/plugin-sdk';
import type {
  Disposable,
  JsonValue,
  MarkdownEditDraft,
  PluginCollectionItem,
  PluginContext,
  PluginExtensionService,
  PluginFormOption,
  PluginManifestV1,
  PluginViewAction,
  PluginViewService,
  PluginWorkspaceService,
} from '@mdular/plugin-sdk';

import manifestData from '../plugin.json' with { type: 'json' };
import {
  appendChatMessage,
  chatDate,
  chatTimestamp,
  CHAT_LIMITS,
  journalPath,
  messageLocator,
  parseChatDocument,
  removeChatMessages,
  safeArchiveBasename,
  setChatMessageDone,
  splitArchiveTitle,
} from './model.js';
import type {
  ChatMessage,
  ChatMessageLocator,
  ChatMutationResult,
} from './model.js';

const VIEW_ID = 'chat';
const OPEN_COMMAND = 'mdular.chat.open';
const QUICK_CAPTURE_COMMAND = 'mdular.chat.quick-capture';
const CHAT_PATH = 'Chat.md';
const ARCHIVE_POINT = 'mdular.chat.archive-targets';
const MAX_EDIT_ATTEMPTS = 4;

type ChatWorkspace = Required<Pick<
  PluginWorkspaceService,
  | 'readMarkdown'
  | 'listMarkdownEntries'
  | 'watchMarkdown'
  | 'beginMarkdownEdit'
  | 'commitMarkdownEdit'
  | 'planTextWrites'
  | 'commitTextWritePlan'
>>;

interface ArchiveOption {
  readonly value: string;
  readonly label: string;
}

interface ArchiveResult {
  readonly path: string;
}

export const pluginManifest = definePluginManifest(manifestData as PluginManifestV1);

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

function normalizeMarkdownPath(value: unknown): string {
  if ('string' !== typeof value || '' === value || 1024 < value.length ||
      value.startsWith('/') || value.includes('\\') || !value.toLocaleLowerCase('en-US').endsWith('.md')) {
    throw new Error('Archive provider returned an invalid Markdown path');
  }
  const segments = value.split('/');
  if (segments.some((segment) => '' === segment || '.' === segment || '..' === segment ||
      segment.includes('\0'))) {
    throw new Error('Archive provider returned a non-canonical Markdown path');
  }
  return value;
}

function appendAtEnd(content: string, line: string): string {
  const prefix = content.replace(/\r\n?/gu, '\n').trimEnd();
  return `${'' === prefix ? '' : `${prefix}\n`}${line}\n`;
}

function appendUnderHeading(content: string, heading: string, text: string): string {
  const normalized = content.replace(/\r\n?/gu, '\n');
  const lines = normalized.split('\n');
  while (0 < lines.length && '' === lines.at(-1)) { lines.pop(); }
  const headingIndex = lines.findIndex((line) => line.trimEnd() === heading);
  if (-1 === headingIndex) {
    if (0 < lines.length) { lines.push(''); }
    lines.push(heading, text);
    return `${lines.join('\n')}\n`;
  }
  const level = /^#+/u.exec(heading)?.[0].length ?? 1;
  let insertion = headingIndex + 1;
  while (insertion < lines.length) {
    const nextLevel = /^(#+)\s/u.exec(lines[insertion] ?? '')?.[1]?.length;
    if (undefined !== nextLevel && nextLevel <= level) { break; }
    insertion += 1;
  }
  while (headingIndex + 1 < insertion && '' === lines[insertion - 1]) { insertion -= 1; }
  lines.splice(insertion, 0, text);
  return `${lines.join('\n')}\n`;
}

function capitalize(text: string): string {
  return `${text.slice(0, 1).toLocaleUpperCase()}${text.slice(1)}`;
}

class ChatController implements Disposable {
  readonly #context: PluginContext;
  readonly #extensions: PluginExtensionService;
  readonly #views: PluginViewService;
  readonly #workspace: ChatWorkspace;
  #messages: readonly ChatMessage[] = [];
  #selected = new Set<string>();
  #capture = '';
  #archiveTarget = 'journal';
  #archiveOptions: readonly ArchiveOption[] = [
    { value: 'journal', label: 'Journal' },
    { value: 'later', label: 'Later checklist' },
    { value: 'read', label: 'Read checklist' },
    { value: 'watch', label: 'Watch checklist' },
    { value: 'shop', label: 'Shop checklist' },
    { value: 'archive', label: 'New archive document' },
  ];
  #status = 'Loading Chat.md…';
  #queue: Promise<void> = Promise.resolve();
  #busy = false;
  #disposed = false;

  public constructor(context: PluginContext, services: {
    readonly extensions: PluginExtensionService;
    readonly views: PluginViewService;
    readonly workspace: ChatWorkspace;
  }) {
    this.#context = context;
    this.#extensions = services.extensions;
    this.#views = services.views;
    this.#workspace = services.workspace;
  }

  public start(): void {
    this.#context.subscriptions.add(this.#extensions.register(DOCUMENT_POLICY_EXTENSION_POINT, {
      id: 'mdular.chat',
      label: 'Chat document policy',
      order: 0,
      data: {
        schemaVersion: 1,
        paths: [CHAT_PATH],
        search: 'exclude',
        metadata: 'exclude',
      },
    }));
    this.#context.subscriptions.add(this.#extensions.onDidChange(ARCHIVE_POINT, () => {
      this.#enqueue(() => this.#refreshArchiveOptions());
    }));
    this.#context.subscriptions.add(this.#views.onAction(VIEW_ID, (action) =>
      this.#handleAction(action)));
    this.#context.subscriptions.add(this.#context.commands!.register(OPEN_COMMAND, async () => {
      await this.#show('Chat ready. Idle auto-switch is disabled.');
      return undefined;
    }));
    this.#context.subscriptions.add(this.#context.commands!.register(
      QUICK_CAPTURE_COMMAND,
      async () => {
        await this.#show('Quick capture ready. Enter sends; Shift+Enter adds a line.');
        return undefined;
      },
    ));
    this.#context.subscriptions.add(this.#workspace.watchMarkdown((change) => {
      if ('reset' === change.kind || CHAT_PATH.toLocaleLowerCase('en-US') ===
          change.path.toLocaleLowerCase('en-US')) {
        this.#enqueue(() => this.#loadChat());
      } else {
        this.#enqueue(() => this.#refreshArchiveOptions());
      }
    }));
    this.#render();
    this.#enqueue(async () => {
      await this.#loadChat();
      await this.#refreshArchiveOptions();
    });
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#selected.clear();
    this.#messages = [];
    this.#views.hide(VIEW_ID);
  }

  async #show(status: string): Promise<void> {
    this.#status = status;
    this.#render();
    await this.#views.reveal(VIEW_ID);
  }

  #enqueue(task: () => Promise<void>): void {
    this.#queue = this.#queue.then(async () => {
      if (!this.#disposed) { await task(); }
    }).catch((error: unknown) => {
      if (this.#disposed) { return; }
      this.#status = `Chat refresh failed: ${messageFrom(error)}`;
      this.#context.logger?.warn('Chat refresh failed', { message: messageFrom(error) });
      this.#render();
    });
  }

  async #handleAction(action: PluginViewAction): Promise<void> {
    if ('field' === action.type) {
      const id = payloadString(action, 'id');
      const value = payloadString(action, 'value');
      if (null === id || null === value) { throw new Error('Chat field action is malformed'); }
      if ('capture' === id) {
        this.#capture = value;
      } else if ('archive-target' === id) {
        if (!this.#archiveOptions.some((option) => option.value === value)) {
          throw new Error('Chat archive target is unavailable');
        }
        this.#archiveTarget = value;
      } else {
        throw new Error(`Unknown Chat field: ${id}`);
      }
      return;
    }
    if ('activate' === action.type) {
      const id = payloadString(action, 'id');
      if (!id || !this.#messages.some((message) => message.id === id)) {
        throw new Error('Chat selection action is malformed');
      }
      if (this.#selected.has(id)) { this.#selected.delete(id); } else { this.#selected.add(id); }
      this.#status = `${this.#selected.size} message${1 === this.#selected.size ? '' : 's'} selected.`;
      this.#render();
      return;
    }
    if ('item-command' === action.type) {
      const id = payloadString(action, 'id');
      const command = payloadString(action, 'actionId');
      const message = this.#messages.find((candidate) => candidate.id === id);
      if (!message || !command) { throw new Error('Chat item action is malformed'); }
      await this.#run(command, async () => {
        if ('complete' === command) {
          await this.#setDone(message, true);
        } else if ('restore' === command) {
          await this.#setDone(message, false);
        } else if ('delete' === command) {
          await this.#delete([message]);
        } else if ('archive' === command) {
          await this.#archive([message]);
        } else {
          throw new Error(`Unknown Chat item action: ${command}`);
        }
      });
      return;
    }
    if ('command' !== action.type) { return; }
    const command = payloadString(action, 'id');
    if (!command) { throw new Error('Chat command action is malformed'); }
    await this.#run(command, async () => {
      switch (command) {
        case 'send': await this.#send(); break;
        case 'select-all': this.#selectAll(); break;
        case 'clear-selection': this.#selected.clear(); this.#status = 'Selection cleared.'; break;
        case 'delete-selected': await this.#delete(this.#selectedMessages()); break;
        case 'archive-selected': await this.#archive(this.#selectedMessages()); break;
        case 'refresh': await this.#loadChat(); await this.#refreshArchiveOptions(); break;
        default: throw new Error(`Unknown Chat view command: ${command}`);
      }
    });
  }

  async #run(action: string, task: () => Promise<void>): Promise<void> {
    if (this.#busy) { return; }
    this.#busy = true;
    this.#render();
    try {
      await task();
    } catch (error) {
      this.#status = `${action} failed: ${messageFrom(error)}`;
      this.#context.logger?.warn('Chat action failed', {
        action,
        message: messageFrom(error),
      });
    } finally {
      this.#busy = false;
      this.#render();
    }
  }

  async #loadChat(): Promise<void> {
    try {
      const content = await this.#workspace.readMarkdown(CHAT_PATH);
      if (this.#disposed) { return; }
      this.#adoptContent(content);
      this.#status = `${this.#messages.length} Chat message${1 === this.#messages.length ? '' : 's'}.`;
    } catch (error) {
      if (!isNotFound(error)) { throw error; }
      this.#messages = [];
      this.#selected.clear();
      this.#status = 'Chat.md will be created on first capture.';
    }
    this.#render();
  }

  async #refreshArchiveOptions(): Promise<void> {
    const builtins: ArchiveOption[] = [
      { value: 'journal', label: 'Journal' },
      { value: 'later', label: 'Later checklist' },
      { value: 'read', label: 'Read checklist' },
      { value: 'watch', label: 'Watch checklist' },
      { value: 'shop', label: 'Shop checklist' },
      { value: 'archive', label: 'New archive document' },
    ];
    const recent = (await this.#workspace.listMarkdownEntries())
      .filter((entry) => {
        const path = entry.path.toLocaleLowerCase('en-US');
        return path !== 'chat.md' &&
          !['later.md', 'read.md', 'watch.md', 'shop.md'].includes(path) &&
          entry.path.length <= 480;
      })
      .sort((left, right) => right.lastModifiedMs - left.lastModifiedMs ||
        left.path.localeCompare(right.path))
      .slice(0, 1)
      .map((entry) => ({
        value: `recent:${entry.path}`,
        label: `Recent · ${entry.path}`.slice(0, 256),
      }));
    const extensions = this.#extensions.list(ARCHIVE_POINT)
      .filter((contribution) => contribution.execute && contribution.id.length <= 200)
      .slice(0, 56)
      .map((contribution) => ({
        value: `extension:${contribution.id}`,
        label: contribution.label.slice(0, 256),
      }));
    this.#archiveOptions = [...builtins, ...recent, ...extensions];
    if (!this.#archiveOptions.some((option) => option.value === this.#archiveTarget)) {
      this.#archiveTarget = 'journal';
    }
    this.#render();
  }

  #adoptContent(content: string): void {
    this.#messages = parseChatDocument(content, chatDate(new Date()));
    this.#selected.clear();
  }

  #visibleMessages(): readonly ChatMessage[] {
    return this.#messages.slice(-CHAT_LIMITS.maxRenderedMessages);
  }

  #selectedMessages(): readonly ChatMessage[] {
    return this.#visibleMessages().filter((message) => this.#selected.has(message.id));
  }

  #selectAll(): void {
    const visible = this.#visibleMessages();
    this.#selected = new Set(visible.map((message) => message.id));
    this.#status = `${visible.length} visible message${1 === visible.length ? '' : 's'} selected.`;
  }

  async #send(): Promise<void> {
    const text = this.#capture.trim();
    if ('' === text) { throw new Error('Enter a message first'); }
    const journalSuffix = /\s(?:jj|\?\?)$/iu.exec(text);
    if (journalSuffix) {
      const direct = text.slice(0, journalSuffix.index).trim();
      if ('' === direct) { throw new Error('Enter text before the Journal suffix'); }
      const path = await this.#archiveOne('journal', direct);
      this.#capture = '';
      this.#status = `Captured directly to ${path}.`;
      await this.#refreshArchiveOptions();
      return;
    }
    const now = new Date();
    const mutation = await this.#mutateChat((content) =>
      appendChatMessage(content, text, chatDate(now), chatTimestamp(now)));
    this.#adoptContent(mutation.content);
    this.#capture = '';
    this.#status = 'Message captured.';
  }

  async #setDone(message: ChatMessage, done: boolean): Promise<void> {
    const locator = messageLocator(message);
    const mutation = await this.#mutateChat((content) =>
      setChatMessageDone(content, locator, done, chatDate(new Date())), false);
    this.#adoptContent(mutation.content);
    this.#status = 0 === mutation.affected
      ? 'Message changed externally; nothing was overwritten.'
      : done ? 'Message completed.' : 'Message restored.';
  }

  async #delete(messages: readonly ChatMessage[]): Promise<void> {
    if (0 === messages.length) { throw new Error('Select at least one message'); }
    const locators = messages.map(messageLocator);
    const mutation = await this.#mutateChat((content) =>
      removeChatMessages(content, locators, chatDate(new Date())), false);
    this.#adoptContent(mutation.content);
    this.#status = `${mutation.affected} message${1 === mutation.affected ? '' : 's'} deleted` +
      `${0 < mutation.missing.length ? `; ${mutation.missing.length} changed externally` : ''}.`;
  }

  async #archive(messages: readonly ChatMessage[]): Promise<void> {
    if (0 === messages.length) { throw new Error('Select at least one message'); }
    const archived: Array<{ readonly locator: ChatMessageLocator; readonly path: string }> = [];
    let failed: string | null = null;
    for (const message of messages) {
      try {
        archived.push({
          locator: messageLocator(message),
          path: await this.#archiveOne(this.#archiveTarget, message.text),
        });
      } catch (error) {
        failed = messageFrom(error);
        break;
      }
    }
    if (0 === archived.length) { throw new Error(failed ?? 'No messages were archived'); }
    const mutation = await this.#mutateChat((content) =>
      removeChatMessages(
        content,
        archived.map((entry) => entry.locator),
        chatDate(new Date()),
      ), false);
    this.#adoptContent(mutation.content);
    await this.#refreshArchiveOptions();
    const uniquePaths = [...new Set(archived.map((entry) => entry.path))];
    const notes = [
      `${archived.length} archived to ${uniquePaths.join(', ')}`,
      ...(0 < mutation.missing.length
        ? [`${mutation.missing.length} source message${1 === mutation.missing.length ? '' : 's'} changed before removal`]
        : []),
      ...(failed ? [`batch stopped: ${failed}`] : []),
    ];
    this.#status = `${notes.join('; ')}.`;
  }

  async #archiveOne(target: string, text: string): Promise<string> {
    const now = new Date();
    if ('journal' === target) {
      const path = journalPath(now);
      await this.#editMarkdown(path, (content) =>
        appendUnderHeading(content, `## ${chatDate(now)}`, capitalize(text)));
      return path;
    }
    const checklistPaths: Readonly<Record<string, string>> = {
      later: 'Later.md',
      read: 'Read.md',
      watch: 'Watch.md',
      shop: 'Shop.md',
    };
    const checklistPath = checklistPaths[target];
    if (checklistPath) {
      await this.#editMarkdown(checklistPath, (content) => appendAtEnd(content, `- [ ] ${text}`));
      return checklistPath;
    }
    if ('archive' === target) { return this.#createArchiveDocument(text); }
    if (target.startsWith('recent:')) {
      const path = normalizeMarkdownPath(target.slice('recent:'.length));
      if (CHAT_PATH.toLocaleLowerCase('en-US') === path.toLocaleLowerCase('en-US')) {
        throw new Error('Chat.md cannot archive into itself');
      }
      await this.#editMarkdown(path, (content) =>
        appendUnderHeading(content, `#### ${chatDate(now)}`, text));
      return path;
    }
    if (target.startsWith('extension:')) {
      const id = target.slice('extension:'.length);
      const contribution = this.#extensions.list(ARCHIVE_POINT)
        .find((candidate) => candidate.id === id && candidate.execute);
      if (!contribution?.execute) { throw new Error('Archive extension is no longer available'); }
      return this.#decodeArchiveResponse(await contribution.execute({ schemaVersion: 1, text })).path;
    }
    throw new Error('Archive target is unavailable');
  }

  #decodeArchiveResponse(value: JsonValue | undefined): ArchiveResult {
    if (!isRecord(value) || 1 !== value.schemaVersion) {
      throw new Error('Archive provider returned a malformed response');
    }
    return { path: normalizeMarkdownPath(value.path) };
  }

  async #createArchiveDocument(text: string): Promise<string> {
    const { title, body } = splitArchiveTitle(text);
    const basename = safeArchiveBasename(title);
    for (let index = 0; index < 1_000; index += 1) {
      const suffix = 0 === index ? '' : ` (${index})`;
      const path = `archive/${basename}${suffix}.md`;
      const plan = await this.#workspace.planTextWrites(
        [{ path, content: `${body.trim()}\n` }],
        'skip-existing',
      );
      const result = await this.#workspace.commitTextWritePlan(plan.planId);
      if (result.created.includes(path)) { return path; }
      if ('partial' === result.status && !/exist/iu.test(result.failed.kind)) {
        throw new Error(`${result.failed.kind}: ${result.failed.message}`);
      }
    }
    throw new Error('No unique archive filename was available');
  }

  async #editMarkdown(path: string, update: (content: string) => string): Promise<string> {
    let draft: MarkdownEditDraft;
    try {
      draft = await this.#workspace.beginMarkdownEdit(path);
    } catch (error) {
      if (!isNotFound(error)) { throw error; }
      const content = update('');
      if (await this.#createText(path, content)) { return content; }
      draft = await this.#workspace.beginMarkdownEdit(path);
    }
    for (let attempt = 0; attempt < MAX_EDIT_ATTEMPTS; attempt += 1) {
      const content = update(draft.content);
      const result = await this.#workspace.commitMarkdownEdit(draft.editId, content);
      if ('written' === result.status) { return result.content; }
      draft = result.current;
    }
    throw new Error(`Concurrent edits to ${path} did not settle`);
  }

  async #mutateChat(
    transform: (content: string) => ChatMutationResult,
    createIfMissing = true,
  ): Promise<ChatMutationResult> {
    let draft: MarkdownEditDraft;
    try {
      draft = await this.#workspace.beginMarkdownEdit(CHAT_PATH);
    } catch (error) {
      if (!isNotFound(error)) { throw error; }
      const mutation = transform('');
      if (!createIfMissing) { return mutation; }
      if (await this.#createText(CHAT_PATH, mutation.content)) { return mutation; }
      draft = await this.#workspace.beginMarkdownEdit(CHAT_PATH);
    }
    for (let attempt = 0; attempt < MAX_EDIT_ATTEMPTS; attempt += 1) {
      const mutation = transform(draft.content);
      const result = await this.#workspace.commitMarkdownEdit(draft.editId, mutation.content);
      if ('written' === result.status) { return { ...mutation, content: result.content }; }
      draft = result.current;
    }
    throw new Error('Concurrent Chat.md edits did not settle');
  }

  async #createText(path: string, content: string): Promise<boolean> {
    const plan = await this.#workspace.planTextWrites([{ path, content }], 'skip-existing');
    const result = await this.#workspace.commitTextWritePlan(plan.planId);
    if ('partial' === result.status) {
      if (/exist/iu.test(result.failed.kind)) { return false; }
      throw new Error(`${result.failed.kind}: ${result.failed.message}`);
    }
    return result.created.includes(path);
  }

  #render(): void {
    if (this.#disposed) { return; }
    const visible = this.#visibleMessages();
    const items: readonly PluginCollectionItem[] = visible.map((message) => ({
      id: message.id,
      title: message.text.slice(0, 4_096),
      description: `${message.date}${message.timestamp ? ` · ${message.timestamp}` : ''}`.slice(0, 4_096),
      badges: [message.done ? 'done' : 'open'],
      selected: this.#selected.has(message.id),
      appearance: message.done ? 'completed' : 'default',
      actions: [
        {
          id: message.done ? 'restore' : 'complete',
          label: message.done ? 'Undo' : 'Done',
          disabled: this.#busy,
        },
        { id: 'archive', label: 'Archive', disabled: this.#busy },
        { id: 'delete', label: 'Delete', tone: 'danger', disabled: this.#busy },
      ],
    }));
    const archiveOptions: readonly PluginFormOption[] = this.#archiveOptions.map((option) => ({
      value: option.value,
      label: option.label,
    }));
    const hidden = this.#messages.length - visible.length;
    const selected = this.#selectedMessages().length;
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: 'collection',
      title: 'Chat',
      fields: [
        {
          id: 'capture',
          kind: 'textarea',
          label: 'Capture',
          value: this.#capture,
          placeholder: 'Capture a thought…',
          description: 'Enter sends. Shift+Enter adds a line. Suffix jj or ?? sends directly to Journal.',
          rows: 3,
          submitActionId: 'send',
        },
        {
          id: 'archive-target',
          kind: 'select',
          label: 'Archive selected messages to',
          value: this.#archiveTarget,
          options: archiveOptions,
        },
      ],
      actions: [
        { id: 'send', label: 'Send', tone: 'primary', disabled: this.#busy },
        { id: 'select-all', label: 'Select visible', disabled: this.#busy || 0 === visible.length },
        { id: 'clear-selection', label: 'Clear selection', disabled: this.#busy || 0 === selected },
        { id: 'archive-selected', label: 'Archive selected', disabled: this.#busy || 0 === selected },
        {
          id: 'delete-selected',
          label: 'Delete selected',
          tone: 'danger',
          disabled: this.#busy || 0 === selected,
        },
        { id: 'refresh', label: 'Refresh', disabled: this.#busy },
      ],
      status: `${this.#status}${0 < hidden ? ` · showing newest ${visible.length} of ${this.#messages.length}` : ''}`,
      busy: this.#busy,
      emptyMessage: 'No Chat messages yet.',
      items,
    });
  }
}

const plugin = definePlugin({
  activate(context) {
    if (!context.commands) { throw new Error('Chat requires commands'); }
    if (!context.extensions) { throw new Error('Chat requires extension consume/register access'); }
    if (!context.views) { throw new Error('Chat requires ui.views'); }
    if (
      !context.workspace?.readMarkdown ||
      !context.workspace.listMarkdownEntries ||
      !context.workspace.watchMarkdown ||
      !context.workspace.beginMarkdownEdit ||
      !context.workspace.commitMarkdownEdit ||
      !context.workspace.planTextWrites ||
      !context.workspace.commitTextWritePlan
    ) {
      throw new Error('Chat requires workspace read, watch, modify, and create access');
    }
    const controller = new ChatController(context, {
      extensions: context.extensions,
      views: context.views,
      workspace: {
        readMarkdown: context.workspace.readMarkdown,
        listMarkdownEntries: context.workspace.listMarkdownEntries,
        watchMarkdown: context.workspace.watchMarkdown,
        beginMarkdownEdit: context.workspace.beginMarkdownEdit,
        commitMarkdownEdit: context.workspace.commitMarkdownEdit,
        planTextWrites: context.workspace.planTextWrites,
        commitTextWritePlan: context.workspace.commitTextWritePlan,
      },
    });
    controller.start();
    return controller;
  },
});

export default plugin;
export {
  appendChatMessage,
  chatDate,
  chatTimestamp,
  CHAT_LIMITS,
  journalPath,
  messageLocator,
  parseChatDocument,
  removeChatMessages,
  safeArchiveBasename,
  serializeChatMessages,
  setChatMessageDone,
  splitArchiveTitle,
} from './model.js';
