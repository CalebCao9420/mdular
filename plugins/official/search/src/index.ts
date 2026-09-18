import {
  DOCUMENT_POLICY_EXTENSION_POINT,
  definePlugin,
  definePluginManifest,
  excludedDocumentPaths,
} from '@mdular/plugin-sdk';
import type {
  Disposable,
  JsonValue,
  MarkdownWorkspaceChange,
  PluginCollectionItem,
  PluginContext,
  PluginExtensionService,
  PluginManifestV1,
  PluginStorageService,
  PluginViewAction,
  PluginViewService,
  PluginWorkspaceService,
} from '@mdular/plugin-sdk';

import manifestData from '../plugin.json' with { type: 'json' };
import { SearchIndex } from './indexer.js';

const COMMAND_ID = 'mdular.search.open';
const VIEW_ID = 'search-results';
const CACHE_KEY = 'private-search-index';

export const pluginManifest = definePluginManifest(manifestData as PluginManifestV1);

function isRecord(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

function payloadString(action: PluginViewAction, key: string): string | null {
  return isRecord(action.payload) && 'string' === typeof action.payload[key]
    ? action.payload[key] as string
    : null;
}

function isSearchablePath(path: string, excluded: ReadonlySet<string>): boolean {
  const normalized = path.toLocaleLowerCase('en-US');
  return normalized.endsWith('.md') && !excluded.has(normalized);
}

class SearchController implements Disposable {
  readonly #context: PluginContext;
  readonly #workspace: Required<Pick<
    PluginWorkspaceService,
    'listMarkdown' | 'readMarkdown' | 'watchMarkdown'
  >>;
  readonly #storage: PluginStorageService;
  readonly #views: PluginViewService;
  readonly #extensions: PluginExtensionService;
  #index = new SearchIndex();
  #excludedPaths: ReadonlySet<string> = new Set();
  #query = '';
  #status = 'Loading private index…';
  #queue: Promise<void> = Promise.resolve();
  #disposed = false;

  public constructor(
    context: PluginContext,
    services: {
      readonly workspace: Required<Pick<
        PluginWorkspaceService,
        'listMarkdown' | 'readMarkdown' | 'watchMarkdown'
      >>;
      readonly storage: PluginStorageService;
      readonly views: PluginViewService;
      readonly extensions: PluginExtensionService;
    },
  ) {
    this.#context = context;
    this.#workspace = services.workspace;
    this.#storage = services.storage;
    this.#views = services.views;
    this.#extensions = services.extensions;
  }

  public start(): void {
    this.#render();
    this.#context.subscriptions.add(this.#views.onAction(VIEW_ID, (action) => {
      this.#handleAction(action);
    }));
    this.#context.subscriptions.add(this.#context.commands!.register(COMMAND_ID, async () => {
      this.#render();
      await this.#views.reveal(VIEW_ID);
      return undefined;
    }));
    this.#context.subscriptions.add(this.#workspace.watchMarkdown((change) => {
      this.#enqueue(() => this.#applyWorkspaceChange(change));
    }));
    this.#context.subscriptions.add(this.#extensions.onDidChange(
      DOCUMENT_POLICY_EXTENSION_POINT,
      () => {
        this.#enqueue(async () => {
          this.#refreshDocumentPolicies();
          await this.#rebuild();
        });
      },
    ));
    this.#enqueue(async () => {
      await this.#restoreCache();
      this.#refreshDocumentPolicies();
      await this.#rebuild();
    });
  }

  #refreshDocumentPolicies(): void {
    this.#excludedPaths = excludedDocumentPaths(this.#extensions, 'search');
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#index.clear();
    this.#views.hide(VIEW_ID);
  }

  #enqueue(task: () => Promise<void>): void {
    this.#queue = this.#queue.then(async () => {
      if (!this.#disposed) { await task(); }
    }).catch((error: unknown) => {
      if (this.#disposed) { return; }
      this.#status = 'Search index unavailable';
      this.#context.logger?.warn('Search index task failed', {
        message: error instanceof Error ? error.message : String(error),
      });
      this.#render();
    });
  }

  #handleAction(action: PluginViewAction): void {
    if ('input' === action.type) {
      const value = payloadString(action, 'value');
      if (null === value) { throw new Error('Search input action is malformed'); }
      this.#query = value;
      this.#render();
      return;
    }
    if ('activate' === action.type) {
      const path = payloadString(action, 'id');
      if (!path) { throw new Error('Search activation action is malformed'); }
      void this.#context.navigation!.openMarkdown(path).catch((error: unknown) => {
        this.#context.logger?.warn('Unable to open Search result', {
          path,
          message: error instanceof Error ? error.message : String(error),
        });
      });
    }
  }

  async #restoreCache(): Promise<void> {
    const result = await this.#storage.get(CACHE_KEY);
    if (this.#disposed) { return; }
    if (!result.ok) {
      this.#context.logger?.warn('Private Search cache could not be read', {
        kind: result.error.kind,
        message: result.error.message,
      });
      return;
    }
    if (!result.value) { return; }
    if (
      1 !== result.value.schemaVersion ||
      !this.#index.importCache(result.value.value)
    ) {
      this.#index.clear();
      await this.#storage.remove(CACHE_KEY);
      this.#context.logger?.warn('Private Search cache was corrupt and will be rebuilt');
      return;
    }
    this.#status = `${this.#index.size} cached document${1 === this.#index.size ? '' : 's'} · refreshing`;
    this.#render();
  }

  async #rebuild(): Promise<void> {
    this.#status = 'Rebuilding private Search index…';
    this.#render();
    const next = new SearchIndex();
    const paths = (await this.#workspace.listMarkdown())
      .filter((path) => isSearchablePath(path, this.#excludedPaths))
      .sort((left, right) => left.localeCompare(right));
    for (const path of paths) {
      if (this.#disposed) { return; }
      try {
        const content = await this.#workspace.readMarkdown(path);
        if (this.#disposed) { return; }
        const result = next.upsert(path, content);
        if (!result.indexed) {
          this.#context.logger?.warn('Markdown document skipped by Search index budget', {
            path,
            reason: result.reason ?? 'unknown',
          });
        }
      } catch (error) {
        this.#context.logger?.warn('Markdown document could not be indexed', {
          path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (this.#disposed) { return; }
    this.#index = next;
    this.#status = `${next.size} indexed document${1 === next.size ? '' : 's'}`;
    await this.#persistCache();
    this.#render();
  }

  async #applyWorkspaceChange(change: MarkdownWorkspaceChange): Promise<void> {
    if ('reset' === change.kind) {
      await this.#rebuild();
      return;
    }
    if ('deleted' === change.kind || !isSearchablePath(change.path, this.#excludedPaths)) {
      this.#index.remove(change.path);
    } else {
      try {
        const content = await this.#workspace.readMarkdown(change.path);
        if (this.#disposed) { return; }
        const result = this.#index.upsert(change.path, content);
        if (!result.indexed) {
          this.#context.logger?.warn('Changed Markdown document exceeds Search index budget', {
            path: change.path,
            reason: result.reason ?? 'unknown',
          });
        }
      } catch (error) {
        this.#index.remove(change.path);
        this.#context.logger?.warn('Changed Markdown document could not be indexed', {
          path: change.path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.#status = `${this.#index.size} indexed document${1 === this.#index.size ? '' : 's'}`;
    await this.#persistCache();
    this.#render();
  }

  async #persistCache(): Promise<void> {
    const result = await this.#storage.set(CACHE_KEY, {
      schemaVersion: 1,
      value: this.#index.exportCache(),
    });
    if (!result.ok) {
      this.#context.logger?.warn('Private Search cache could not be persisted', {
        kind: result.error.kind,
        message: result.error.message,
      });
    }
  }

  #render(): void {
    if (this.#disposed) { return; }
    const results = this.#index.search(this.#query);
    const items: readonly PluginCollectionItem[] = results.map((result) => ({
      id: result.path,
      title: result.title,
      description: result.description,
      ...(result.titleHighlights ? { titleHighlights: result.titleHighlights } : {}),
      ...(result.descriptionHighlights
        ? { descriptionHighlights: result.descriptionHighlights }
        : {}),
      ...(result.badges ? { badges: result.badges } : {}),
    }));
    this.#views.setState(VIEW_ID, {
      schemaVersion: 1,
      kind: 'collection',
      title: 'Search Markdown',
      input: {
        value: this.#query,
        placeholder: 'filename, body, #tag, status:draft, in:docs',
        ariaLabel: 'Search Markdown documents',
      },
      status: `${this.#status} · ${results.length} result${1 === results.length ? '' : 's'}`,
      emptyMessage: '' === this.#query ? 'No Markdown documents indexed.' : 'No matches.',
      dismissOnActivate: true,
      items,
    });
  }
}

const plugin = definePlugin({
  activate(context) {
    if (!context.commands) { throw new Error('Search requires commands'); }
    if (!context.extensions) { throw new Error('Search requires extensions.consume'); }
    if (!context.navigation) { throw new Error('Search requires navigation.openMarkdown'); }
    if (!context.storage) { throw new Error('Search requires storage.workspace'); }
    if (!context.views) { throw new Error('Search requires ui.views'); }
    if (
      !context.workspace?.listMarkdown ||
      !context.workspace.readMarkdown ||
      !context.workspace.watchMarkdown
    ) {
      throw new Error('Search requires workspace read and watch access');
    }
    const controller = new SearchController(context, {
      workspace: {
        listMarkdown: context.workspace.listMarkdown,
        readMarkdown: context.workspace.readMarkdown,
        watchMarkdown: context.workspace.watchMarkdown,
      },
      storage: context.storage,
      views: context.views,
      extensions: context.extensions,
    });
    controller.start();
    return controller;
  },
});

export default plugin;
export { SearchIndex, SEARCH_INDEX_LIMITS, parseSearchMetadata } from './indexer.js';
export { metadataMatches, parseSearchQuery } from './query.js';
