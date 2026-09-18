import type {
  Disposable,
  PluginCollectionItem,
  PluginContext,
  PluginDocumentsService,
  PluginStorageService,
  PluginVcsExternalClient,
  PluginVcsService,
  PluginVcsStatusSnapshot,
  PluginViewAction,
  PluginViewService,
} from '@mdular/plugin-sdk';

import {
  diffReaderBlocks,
  mergeVcsStatus,
  VCS_LIMITS,
  visibleStatusCode,
} from './model.js';

const VIEW_ID = 'vcs';
const CLIENT_KEY = 'external-client';
const CLIENTS: readonly PluginVcsExternalClient[] = [
  'default',
  'source-git',
  'tortoise-git',
  'explorer',
  'finder',
];

interface Services {
  readonly documents: PluginDocumentsService;
  readonly storage: PluginStorageService;
  readonly vcs: PluginVcsService;
  readonly views: PluginViewService;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

function payloadString(action: PluginViewAction, key: string): string | null {
  return isRecord(action.payload) && 'string' === typeof action.payload[key]
    ? action.payload[key] as string
    : null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function clientLabel(client: PluginVcsExternalClient): string {
  switch (client) {
    case 'source-git': return 'SourceGit';
    case 'tortoise-git': return 'TortoiseGit';
    case 'explorer': return 'Explorer';
    case 'finder': return 'Finder';
    default: return 'Platform default';
  }
}

export class VcsController implements Disposable {
  readonly #context: PluginContext;
  readonly #documents: PluginDocumentsService;
  readonly #storage: PluginStorageService;
  readonly #vcs: PluginVcsService;
  readonly #views: PluginViewService;
  readonly #pathByItem = new Map<string, string>();
  #snapshot: PluginVcsStatusSnapshot = {
    kind: 'none',
    entries: [],
    truncated: false,
  };
  #selectedClient: PluginVcsExternalClient = 'default';
  #selectedDiffPath: string | null = null;
  #status = 'Detecting Git or SVN workspace…';
  #busy = false;
  #disposed = false;
  #queue: Promise<void> = Promise.resolve();

  public constructor(context: PluginContext, services: Services) {
    this.#context = context;
    this.#documents = services.documents;
    this.#storage = services.storage;
    this.#vcs = services.vcs;
    this.#views = services.views;
  }

  public start(): void {
    this.#context.subscriptions.add(this.#context.commands!.register(
      'mdular.vcs.open',
      () => {
        this.#enqueue(async () => {
          await this.#views.reveal(VIEW_ID);
          await this.#refresh();
        });
        return undefined;
      },
    ));
    this.#context.subscriptions.add(this.#context.commands!.register(
      'mdular.vcs.refresh',
      () => {
        this.#enqueue(() => this.#refresh());
        return undefined;
      },
    ));
    this.#context.subscriptions.add(this.#context.commands!.register(
      'mdular.vcs.open-external',
      () => {
        this.#enqueue(() => this.#openExternal());
        return undefined;
      },
    ));
    this.#context.subscriptions.add(this.#views.onAction(
      VIEW_ID,
      (action) => this.#handleAction(action),
    ));
    const rerender = (): void => { this.#renderStatus(); };
    this.#context.subscriptions.add(this.#documents.onDidOpen(rerender));
    this.#context.subscriptions.add(this.#documents.onDidChange(rerender));
    this.#context.subscriptions.add(this.#documents.onDidActivatePane(rerender));
    this.#context.subscriptions.add(this.#documents.onDidSave(() => {
      this.#enqueue(() => this.#refresh());
    }));
    this.#renderStatus();
    this.#enqueue(async () => {
      await this.#restoreClient();
      await this.#refresh();
    });
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#pathByItem.clear();
    this.#views.hide(VIEW_ID);
  }

  #enqueue(task: () => Promise<void>): void {
    this.#queue = this.#queue.then(async () => {
      if (!this.#disposed) { await task(); }
    }).catch((error: unknown) => {
      if (this.#disposed) { return; }
      this.#busy = false;
      this.#selectedDiffPath = null;
      this.#status = `Version control unavailable: ${message(error)}`;
      this.#context.logger?.warn('VCS operation failed', { message: message(error) });
      this.#renderStatus();
    });
  }

  async #restoreClient(): Promise<void> {
    const stored = await this.#storage.get(CLIENT_KEY);
    if (!stored.ok || !stored.value || 1 !== stored.value.schemaVersion) { return; }
    const value = stored.value.value;
    if ('string' === typeof value && CLIENTS.includes(value as PluginVcsExternalClient)) {
      this.#selectedClient = value as PluginVcsExternalClient;
    }
  }

  async #persistClient(): Promise<void> {
    const result = await this.#storage.set(CLIENT_KEY, {
      schemaVersion: 1,
      value: this.#selectedClient,
    });
    if (!result.ok) {
      this.#context.logger?.warn('VCS external-client preference was not saved', {
        kind: result.error.kind,
        message: result.error.message,
      });
    }
  }

  async #refresh(): Promise<void> {
    this.#busy = true;
    this.#status = 'Refreshing version-control status…';
    this.#renderStatus();
    this.#snapshot = await this.#vcs.status();
    if (this.#disposed) { return; }
    this.#busy = false;
    const count = this.#snapshot.entries.length;
    this.#status = 'none' === this.#snapshot.kind
      ? 'This workspace is not a supported Git or SVN checkout.'
      : `${this.#snapshot.kind.toUpperCase()} · ${String(count)} changed path${1 === count ? '' : 's'}` +
        `${this.#snapshot.truncated ? ' · native result truncated' : ''}`;
    this.#selectedDiffPath = null;
    this.#renderStatus();
  }

  async #openDiff(path: string): Promise<void> {
    if ('none' === this.#snapshot.kind) { return; }
    this.#busy = true;
    this.#status = `Loading diff for ${path}…`;
    this.#renderStatus();
    const result = await this.#vcs.diff(path);
    if (this.#disposed) { return; }
    this.#busy = false;
    this.#selectedDiffPath = path;
    const rendered = diffReaderBlocks(result);
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: 'reader',
      title: `Diff · ${path}`,
      sourcePath: path,
      status: 0 === rendered.blocks.length
        ? 'No textual working-tree or staged diff is available for this path.'
        : `${result.kind.toUpperCase()} diff${rendered.truncated ? ' · display truncated' : ''}`,
      outline: [],
      blocks: rendered.blocks,
      actions: [
        { id: 'back', label: 'Back' },
        { id: 'refresh-diff', label: 'Refresh' },
      ],
    });
  }

  async #openExternal(): Promise<void> {
    if ('none' === this.#snapshot.kind) {
      throw new Error('External VCS client requires a Git or SVN workspace');
    }
    const result = await this.#vcs.openExternal(this.#selectedClient);
    this.#status = `Opened ${clientLabel(result.client)}`;
    this.#renderStatus();
  }

  #handleAction(action: PluginViewAction): void {
    if ('activate' === action.type) {
      const id = payloadString(action, 'id');
      const path = id ? this.#pathByItem.get(id) : undefined;
      if (path) { this.#enqueue(() => this.#openDiff(path)); }
      return;
    }
    if ('field' === action.type && 'client' === payloadString(action, 'id')) {
      const value = payloadString(action, 'value');
      if (!value || !CLIENTS.includes(value as PluginVcsExternalClient)) {
        throw new Error('External VCS client selection is malformed');
      }
      this.#selectedClient = value as PluginVcsExternalClient;
      this.#renderStatus();
      this.#enqueue(() => this.#persistClient());
      return;
    }
    if ('command' !== action.type) { return; }
    const id = payloadString(action, 'id');
    if ('refresh' === id) {
      this.#enqueue(() => this.#refresh());
    } else if ('open-external' === id) {
      this.#enqueue(() => this.#openExternal());
    } else if ('back' === id) {
      this.#selectedDiffPath = null;
      this.#renderStatus();
    } else if ('refresh-diff' === id && this.#selectedDiffPath) {
      this.#enqueue(() => this.#openDiff(this.#selectedDiffPath!));
    }
  }

  #renderStatus(): void {
    if (this.#disposed || null !== this.#selectedDiffPath) { return; }
    const merged = mergeVcsStatus(
      this.#snapshot.entries,
      this.#documents.listOpenSaveStates(),
    );
    const visible = merged.slice(0, VCS_LIMITS.renderedStatusEntries);
    this.#pathByItem.clear();
    const items: PluginCollectionItem[] = visible.map((entry, index) => {
      const id = `entry-${String(index)}`;
      this.#pathByItem.set(id, entry.path);
      const badges = [
        ...(entry.status ? [visibleStatusCode(entry.status)] : []),
        ...(entry.unsaved ? ['Unsaved'] : []),
      ];
      return {
        id,
        title: entry.path,
        description: entry.status
          ? `index ${entry.status.indexStatus} · working tree ${entry.status.workingTreeStatus}`
          : 'Open document has unsaved application changes',
        badges,
      };
    });
    const branch = this.#snapshot.branch ? ` · ${this.#snapshot.branch}` : '';
    const displayTruncated = VCS_LIMITS.renderedStatusEntries < merged.length;
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: 'collection',
      title: `Version Control${branch}`,
      fields: [{
        id: 'client',
        kind: 'select',
        label: 'External client',
        value: this.#selectedClient,
        options: CLIENTS.map((client) => ({ value: client, label: clientLabel(client) })),
      }],
      actions: [
        { id: 'refresh', label: 'Refresh', disabled: this.#busy },
        {
          id: 'open-external',
          label: 'Open external',
          disabled: this.#busy || 'none' === this.#snapshot.kind,
        },
      ],
      status: `${this.#status}${displayTruncated ? ' · display limited to 500 paths' : ''}`,
      busy: this.#busy,
      emptyMessage: 'No repository or unsaved document changes.',
      items,
    });
  }
}
