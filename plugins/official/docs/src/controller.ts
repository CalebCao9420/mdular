import type {
  Disposable,
  PluginCollectionItem,
  PluginContext,
  PluginDocumentSnapshot,
  PluginDocumentsService,
  PluginExtensionService,
  PluginFormField,
  PluginNavigationService,
  PluginViewAction,
  PluginViewButton,
  PluginViewService,
  PluginWorkspaceService,
} from '@mdular/plugin-sdk';

import { archiveChatMessageToDocs } from './chat-archive.js';
import {
  parseRoundTripFrontmatter,
  updateRoundTripFrontmatter,
} from './frontmatter-roundtrip.js';
import type { RoundTripFrontmatterField } from './frontmatter-roundtrip.js';
import {
  buildDocsReaderDocument,
  summarizeDocsDocument,
} from './reading.js';
import type { DocsReaderDocument } from './reading.js';

const VIEW_ID = 'docs';
const CHAT_ARCHIVE_POINT = 'mdular.chat.archive-targets';
const OPEN_READER_COMMAND = 'mdular.docs.open-reader';
const OPEN_OUTLINE_COMMAND = 'mdular.docs.open-outline';
const BROWSE_COMMAND = 'mdular.docs.browse';
const EDIT_FRONTMATTER_COMMAND = 'mdular.docs.edit-frontmatter';
const MAX_BROWSE_DOCUMENTS = 200;
const BROWSE_CONCURRENCY = 4;

const EDITABLE_FIELDS = [
  'title',
  'status',
  'tags',
  'date',
  'author',
  'category',
  'cover',
  'cover_alt',
  'cover_focus',
] as const;

export type DocsWorkspace = Required<Pick<
  PluginWorkspaceService,
  | 'readMarkdown'
  | 'listMarkdown'
  | 'watchMarkdown'
  | 'planTextWrites'
  | 'commitTextWritePlan'
>>;

type DocsMode = 'reader' | 'outline' | 'browse' | 'frontmatter';

interface FrontmatterDraft {
  readonly snapshot: PluginDocumentSnapshot;
  readonly fields: readonly RoundTripFrontmatterField[];
  readonly original: ReadonlyMap<string, string | null>;
  readonly values: Map<string, string>;
  previewContent: string | null;
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

function isMarkdownSnapshot(snapshot: PluginDocumentSnapshot | null): snapshot is PluginDocumentSnapshot {
  return null !== snapshot && snapshot.path.toLocaleLowerCase('en-US').endsWith('.md');
}

function frontmatterExcerpt(content: string): string {
  const match = /^(?:\uFEFF)?---(?:\r\n|\n|\r)[\s\S]*?(?:\r\n|\n|\r)---(?=\r\n|\n|\r|$)/u.exec(content);
  return (match?.[0] ?? content).slice(0, 64 * 1024);
}

async function mapConcurrent<TInput, TOutput>(
  values: readonly TInput[],
  concurrency: number,
  map: (value: TInput) => Promise<TOutput>,
): Promise<readonly TOutput[]> {
  const output: TOutput[] = new Array(values.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, values.length) }, async () => {
    while (cursor < values.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await map(values[index]!);
    }
  });
  await Promise.all(workers);
  return output;
}

export class DocsController implements Disposable {
  readonly #context: PluginContext;
  readonly #documents: PluginDocumentsService;
  readonly #extensions: PluginExtensionService;
  readonly #navigation: PluginNavigationService;
  readonly #views: PluginViewService;
  readonly #workspace: DocsWorkspace;
  #mode: DocsMode = 'reader';
  #visible = false;
  #busy = false;
  #refreshRequested = false;
  #disposed = false;
  #generation = 0;
  #reader: DocsReaderDocument | null = null;
  #frontmatter: FrontmatterDraft | null = null;

  public constructor(context: PluginContext, services: {
    readonly documents: PluginDocumentsService;
    readonly extensions: PluginExtensionService;
    readonly navigation: PluginNavigationService;
    readonly views: PluginViewService;
    readonly workspace: DocsWorkspace;
  }) {
    this.#context = context;
    this.#documents = services.documents;
    this.#extensions = services.extensions;
    this.#navigation = services.navigation;
    this.#views = services.views;
    this.#workspace = services.workspace;
  }

  public start(): void {
    this.#context.subscriptions.add(this.#extensions.register(CHAT_ARCHIVE_POINT, {
      id: 'mdular.docs',
      label: 'To Docs',
      order: 11,
      execute: (request) => archiveChatMessageToDocs(request, this.#workspace),
    }));
    this.#context.subscriptions.add(this.#views.onAction(VIEW_ID, (action) =>
      this.#handleAction(action)));
    this.#context.subscriptions.add(this.#context.commands!.register(
      OPEN_READER_COMMAND,
      async () => { await this.#show('reader'); return undefined; },
    ));
    this.#context.subscriptions.add(this.#context.commands!.register(
      OPEN_OUTLINE_COMMAND,
      async () => { await this.#show('outline'); return undefined; },
    ));
    this.#context.subscriptions.add(this.#context.commands!.register(
      BROWSE_COMMAND,
      async () => { await this.#show('browse'); return undefined; },
    ));
    this.#context.subscriptions.add(this.#context.commands!.register(
      EDIT_FRONTMATTER_COMMAND,
      async () => {
        const snapshot = this.#documents.getActiveSnapshot();
        if (!isMarkdownSnapshot(snapshot) || 'none' === parseRoundTripFrontmatter(snapshot.content).kind) {
          this.#context.logger?.info('Frontmatter editor remains hidden because the active document has no frontmatter');
          return undefined;
        }
        await this.#show('frontmatter');
        return undefined;
      },
    ));
    const refreshActive = (): void => {
      this.#reader = null;
      this.#frontmatter = null;
      if (this.#visible && 'browse' !== this.#mode) { void this.#refresh(); }
    };
    this.#context.subscriptions.add(this.#documents.onDidOpen(refreshActive));
    this.#context.subscriptions.add(this.#documents.onDidChange(refreshActive));
    this.#context.subscriptions.add(this.#documents.onDidActivatePane(refreshActive));
    this.#context.subscriptions.add(this.#workspace.watchMarkdown(() => {
      if (this.#visible) { void this.#refresh(); }
    }));
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#generation += 1;
    this.#reader = null;
    this.#frontmatter = null;
    this.#views.hide(VIEW_ID);
  }

  async #show(mode: DocsMode): Promise<void> {
    if (this.#disposed) { return; }
    this.#mode = mode;
    this.#visible = true;
    await this.#refresh();
    if (!this.#disposed && this.#visible) { await this.#views.reveal(VIEW_ID); }
  }

  async #refresh(): Promise<void> {
    if (this.#disposed) { return; }
    if (this.#busy) {
      this.#refreshRequested = true;
      this.#generation += 1;
      return;
    }
    const generation = ++this.#generation;
    this.#busy = true;
    this.#renderLoading();
    try {
      if ('browse' === this.#mode) {
        await this.#renderBrowse(generation);
      } else if ('frontmatter' === this.#mode) {
        this.#renderFrontmatter();
      } else {
        await this.#renderReaderOrOutline(generation);
      }
    } catch (error) {
      if (generation !== this.#generation || this.#disposed) { return; }
      this.#views.setState(VIEW_ID, {
        schemaVersion: 1,
        kind: 'collection',
        title: 'Docs',
        status: `Docs failed: ${messageFrom(error)}`,
        emptyMessage: 'The document was left unchanged.',
        items: [],
        actions: this.#navigationActions(),
      });
    } finally {
      this.#busy = false;
      if (this.#refreshRequested && !this.#disposed) {
        this.#refreshRequested = false;
        void this.#refresh();
      }
    }
  }

  #renderLoading(): void {
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: 'collection',
      title: 'Docs',
      status: 'Loading bounded document view…',
      busy: true,
      items: [],
    });
  }

  async #loadReader(): Promise<DocsReaderDocument> {
    const snapshot = this.#documents.getActiveSnapshot();
    if (!isMarkdownSnapshot(snapshot)) { throw new Error('Open a Markdown document first'); }
    const reader = await buildDocsReaderDocument(
      snapshot.path,
      snapshot.content,
      (path) => this.#workspace.readMarkdown(path),
    );
    this.#reader = reader;
    return reader;
  }

  async #renderReaderOrOutline(generation: number): Promise<void> {
    const reader = this.#reader ?? await this.#loadReader();
    if (generation !== this.#generation || this.#disposed) { return; }
    const snapshot = this.#documents.getActiveSnapshot();
    const hasFrontmatter = isMarkdownSnapshot(snapshot) &&
      'frontmatter' === parseRoundTripFrontmatter(snapshot.content).kind;
    if ('reader' === this.#mode) {
      this.#views.setState(VIEW_ID, {
        schemaVersion: 1,
        kind: 'reader',
        title: reader.title,
        sourcePath: reader.path,
        status: reader.status,
        ...(reader.cover ? { cover: reader.cover } : {}),
        outline: reader.outline,
        blocks: reader.blocks,
        actions: this.#navigationActions(hasFrontmatter),
      });
      return;
    }
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: 'collection',
      title: `Outline · ${reader.title}`,
      status: `${String(reader.outline.length)} heading(s)`,
      emptyMessage: 'No headings outside fenced code blocks.',
      items: reader.outline.map((heading) => ({
        id: heading.id,
        title: heading.label,
        badges: [`H${String(heading.level)}`],
      })),
      actions: this.#navigationActions(hasFrontmatter),
    });
  }

  async #renderBrowse(generation: number): Promise<void> {
    const paths = (await this.#workspace.listMarkdown('docs'))
      .slice()
      .sort((left, right) => left.localeCompare(right))
      .slice(0, MAX_BROWSE_DOCUMENTS);
    const summaries = [...(await mapConcurrent(paths, BROWSE_CONCURRENCY, async (path) => {
      try {
        return summarizeDocsDocument(path, await this.#workspace.readMarkdown(path));
      } catch {
        return { path, title: path.split('/').at(-1)?.replace(/\.md$/iu, '') ?? path };
      }
    }))].sort((left, right) =>
      left.title.localeCompare(right.title) || left.path.localeCompare(right.path));
    if (generation !== this.#generation || this.#disposed) { return; }
    const items: readonly PluginCollectionItem[] = summaries.map((summary) => ({
      id: summary.path,
      title: summary.title,
      description: summary.path,
      badges: ['docs'],
      ...(summary.cover ? { image: summary.cover } : {}),
    }));
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: 'collection',
      title: 'Browse Docs',
      status: `${String(items.length)} document(s)${MAX_BROWSE_DOCUMENTS === paths.length ? ' · bounded list' : ''}`,
      emptyMessage: 'No Markdown documents were found under docs/.',
      items,
      actions: this.#navigationActions(),
    });
  }

  #createFrontmatterDraft(snapshot: PluginDocumentSnapshot): FrontmatterDraft | null {
    const parsed = parseRoundTripFrontmatter(snapshot.content);
    if ('frontmatter' !== parsed.kind) { return null; }
    const byKey = new Map(parsed.fields.map((field) => [field.key, field]));
    const original = new Map<string, string | null>();
    const values = new Map<string, string>();
    for (const key of EDITABLE_FIELDS) {
      const field = byKey.get(key);
      const value = field?.editable ? field.value ?? '' : '';
      original.set(key, field ? value : null);
      values.set(key, value);
    }
    return { snapshot, fields: parsed.fields, original, values, previewContent: null };
  }

  #renderFrontmatter(status?: string): void {
    const snapshot = this.#documents.getActiveSnapshot();
    if (!isMarkdownSnapshot(snapshot)) { throw new Error('Open a Markdown document first'); }
    const parsed = parseRoundTripFrontmatter(snapshot.content);
    if ('none' === parsed.kind) {
      this.#frontmatter = null;
      this.#visible = false;
      this.#views.hide(VIEW_ID);
      return;
    }
    if ('invalid' === parsed.kind) {
      this.#frontmatter = null;
      this.#views.setState(VIEW_ID, {
        schemaVersion: 1,
        kind: 'collection',
        title: `Frontmatter · ${snapshot.path}`,
        status: `Frontmatter is not safely editable: ${parsed.reason}`,
        emptyMessage: 'The document was left unchanged.',
        items: [],
        actions: this.#navigationActions(),
      });
      return;
    }
    if (!this.#frontmatter ||
        this.#frontmatter.snapshot.path !== snapshot.path ||
        this.#frontmatter.snapshot.bufferVersion !== snapshot.bufferVersion) {
      this.#frontmatter = this.#createFrontmatterDraft(snapshot);
    }
    const draft = this.#frontmatter;
    if (!draft) { throw new Error('Frontmatter draft could not be created'); }
    const byKey = new Map(draft.fields.map((field) => [field.key, field]));
    const fields: PluginFormField[] = EDITABLE_FIELDS.map((key) => {
      const field = byKey.get(key);
      return {
        id: key,
        kind: 'text',
        label: key,
        value: field && !field.editable ? '[complex value preserved]' : draft.values.get(key) ?? '',
        placeholder: field ? '' : 'Optional; leave empty to keep absent',
        ...(field && !field.editable
          ? { readOnly: true, description: 'Complex YAML is preserved byte-for-byte and is not edited here.' }
          : {}),
      };
    });
    if (draft.previewContent) {
      fields.push({
        id: 'preview',
        kind: 'textarea',
        label: 'Round-trip preview',
        value: frontmatterExcerpt(draft.previewContent),
        rows: 10,
        readOnly: true,
        description: 'Unknown fields, comments, ordering, delimiters and body remain in place.',
      });
    }
    const unknown = draft.fields.filter((field) => !EDITABLE_FIELDS.includes(
      field.key as typeof EDITABLE_FIELDS[number],
    )).length;
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: 'collection',
      title: `Frontmatter · ${snapshot.path}`,
      status: status ?? `${String(unknown)} unknown field(s) preserved · changes stay in the editor until Save`,
      fields,
      items: [],
      actions: [
        { id: 'preview-frontmatter', label: 'Preview' },
        {
          id: 'apply-frontmatter',
          label: 'Apply to editor',
          tone: 'primary',
          disabled: null === draft.previewContent,
        },
        ...this.#navigationActions(),
      ],
    });
  }

  #frontmatterUpdates(draft: FrontmatterDraft): Readonly<Record<string, string>> {
    return Object.fromEntries(EDITABLE_FIELDS.flatMap((key) => {
      const before = draft.original.get(key) ?? null;
      const after = draft.values.get(key) ?? '';
      if (null === before && '' === after) { return []; }
      return before === after ? [] : [[key, after]];
    }));
  }

  #previewFrontmatter(): void {
    const draft = this.#frontmatter;
    if (!draft) { throw new Error('Frontmatter editor is unavailable'); }
    const result = updateRoundTripFrontmatter(
      draft.snapshot.content,
      this.#frontmatterUpdates(draft),
    );
    if (!result.ok) { throw new Error(result.reason); }
    draft.previewContent = result.changed ? result.content : null;
    this.#renderFrontmatter(result.changed
      ? 'Preview ready · review before applying to the active editor'
      : 'No frontmatter changes to apply');
  }

  async #applyFrontmatter(): Promise<void> {
    const draft = this.#frontmatter;
    if (!draft?.previewContent) { throw new Error('Preview frontmatter changes first'); }
    const apply = this.#documents.applyActiveEdit;
    if (!apply) { throw new Error('Active document editing permission is unavailable'); }
    const result = await apply({
      path: draft.snapshot.path,
      expectedBufferVersion: draft.snapshot.bufferVersion,
      content: draft.previewContent,
    });
    if ('stale' === result.status) {
      this.#frontmatter = result.current ? this.#createFrontmatterDraft(result.current) : null;
      this.#renderFrontmatter(
        'Document changed before apply · no overwrite occurred; review the fresh fields and retry',
      );
      return;
    }
    if ('read-only' === result.status) { throw new Error(result.message); }
    this.#frontmatter = this.#createFrontmatterDraft(result.snapshot);
    this.#renderFrontmatter('Frontmatter applied to the editor · use Save to persist it');
  }

  async #handleAction(action: PluginViewAction): Promise<void> {
    if ('dismiss' === action.type) {
      this.#visible = false;
      this.#generation += 1;
      return;
    }
    if ('field' === action.type && 'frontmatter' === this.#mode) {
      const id = payloadString(action, 'id');
      const value = payloadString(action, 'value');
      if (!id || null === value || !EDITABLE_FIELDS.includes(id as typeof EDITABLE_FIELDS[number])) {
        throw new Error('Frontmatter field action is malformed');
      }
      if (4_096 < value.length) { throw new Error('Frontmatter field exceeds the value limit'); }
      const field = this.#frontmatter?.fields.find((candidate) => candidate.key === id);
      if (field && !field.editable) { throw new Error(`Complex field cannot be edited: ${id}`); }
      this.#frontmatter?.values.set(id, value);
      if (this.#frontmatter) { this.#frontmatter.previewContent = null; }
      return;
    }
    if ('activate' === action.type) {
      const id = payloadString(action, 'id');
      if (!id) { throw new Error('Docs activation is malformed'); }
      if ('browse' === this.#mode) {
        await this.#navigation.openMarkdown(id);
        this.#reader = null;
        await this.#show('reader');
        return;
      }
      if ('outline' === this.#mode) {
        const reader = this.#reader;
        if (!reader || !reader.outline.some((heading) => heading.id === id)) {
          throw new Error('Outline heading is unavailable');
        }
        this.#mode = 'reader';
        await this.#renderReaderOrOutline(this.#generation);
        await this.#views.reveal(VIEW_ID);
        this.#views.revealReaderBlock(VIEW_ID, id);
      }
      return;
    }
    if ('command' !== action.type) { return; }
    const command = payloadString(action, 'id');
    if (!command) { throw new Error('Docs command action is malformed'); }
    if ('preview-frontmatter' === command) {
      this.#previewFrontmatter();
      return;
    }
    if ('apply-frontmatter' === command) {
      await this.#applyFrontmatter();
      return;
    }
    const mode: DocsMode | null = 'reader' === command
      ? 'reader'
      : 'outline' === command
        ? 'outline'
        : 'browse' === command
          ? 'browse'
          : 'frontmatter' === command
            ? 'frontmatter'
            : null;
    if ('refresh' === command) {
      this.#reader = null;
      this.#frontmatter = null;
      await this.#refresh();
      return;
    }
    if (!mode) { throw new Error(`Unknown Docs action: ${command}`); }
    if ('frontmatter' === mode) {
      const snapshot = this.#documents.getActiveSnapshot();
      if (!isMarkdownSnapshot(snapshot) || 'none' === parseRoundTripFrontmatter(snapshot.content).kind) {
        return;
      }
    }
    await this.#show(mode);
  }

  #navigationActions(hasFrontmatter = false): readonly PluginViewButton[] {
    return [
      { id: 'reader', label: 'Read', disabled: 'reader' === this.#mode },
      { id: 'outline', label: 'Outline', disabled: 'outline' === this.#mode },
      { id: 'browse', label: 'Browse Docs', disabled: 'browse' === this.#mode },
      ...(hasFrontmatter ? [{ id: 'frontmatter', label: 'Frontmatter' }] : []),
      { id: 'refresh', label: 'Refresh' },
    ];
  }
}

export const DOCS_COMMANDS = Object.freeze({
  openReader: OPEN_READER_COMMAND,
  openOutline: OPEN_OUTLINE_COMMAND,
  browse: BROWSE_COMMAND,
  editFrontmatter: EDIT_FRONTMATTER_COMMAND,
});
