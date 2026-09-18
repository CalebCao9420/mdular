import {
  RecoveryCoordinator,
  SessionRegistry,
  workspacePath,
} from '@mdular/core';
import type {
  Disposable,
  DocumentSession,
  PrepareForRestartResult,
  RecoveryStore,
  RestartBlockReason,
  WorkspaceAdapter,
  WorkspaceWatchRefresh,
} from '@mdular/core';
import {
  PaneController,
  SessionEditorBinding,
} from '@mdular/editor';
import type { PaneId, PaneOpenTarget, PaneViewState } from '@mdular/editor';
import { InProcessPluginRuntime } from '@mdular/plugin-runtime';
import type { BundledPluginCatalogEntry } from '@mdular/plugin-runtime';
import type {
  PluginActiveDocumentEdit,
  PluginActiveDocumentEditResult,
  PluginStorageResult,
} from '@mdular/plugin-sdk';

import { loadDesktopBundledPluginCatalog } from './bundled-plugins.js';
import { CodeMirrorDocumentPool } from './codemirror-documents.js';
import { CodeMirrorTextEditor } from './codemirror-editor.js';
import type { EditorMediaInput } from './editor-enhancements.js';
import {
  createDesktopLineDiffRunner,
  LineDiffTaskRunner,
} from './diff-runner.js';
import type { DiffWorkerFactory } from './diff-runner.js';
import { DesktopDiffView } from './diff-view.js';
import { createDesktopLayoutPreferenceStore } from './layout-preferences.js';
import type { DesktopLayoutPreferenceStore } from './layout-preferences.js';
import {
  applyMediaMarkdownEdit,
  createMediaAssetPath,
  decodeMediaRollbackResult,
  decodeMediaWriteResult,
  encodeMediaBase64,
  markdownMediaLink,
  MEDIA_INSERT_LIMITS,
} from './media-insert.js';
import type { MediaWriteReceipt } from './media-insert.js';
import { DesktopPluginCommandHost } from './plugin-commands.js';
import { DesktopPluginAssetHost } from './plugin-assets.js';
import {
  createPluginDocumentSnapshot,
  DesktopPluginDocumentHub,
} from './plugin-documents.js';
import { DesktopPluginExtensionHost } from './plugin-extensions.js';
import { DesktopPluginEditorHost } from './plugin-editor.js';
import { DesktopDocumentHeaderHost } from './plugin-headers.js';
import { DesktopPluginHost } from './plugin-host.js';
import { DesktopPluginNavigationHost } from './plugin-navigation.js';
import {
  DesktopPluginStorageManager,
  DesktopWorkspaceIdentity,
} from './plugin-storage.js';
import type {
  PluginKeyValueStorage,
  WorkspaceIdentityProvider,
} from './plugin-storage.js';
import type { LoadedRecoveryRecord } from './recovery-store.js';
import { DesktopPluginViewHost } from './plugin-views.js';
import { DesktopPluginVcsHost } from './plugin-vcs.js';
import { DesktopPluginWorkspaceHost } from './plugin-workspace.js';
import type {
  DesktopWindowLifecycle,
  WindowCloseRequest,
} from './window-lifecycle.js';
import { installUpdaterRestartHandshake } from './updater-handshake.js';
import type { DesktopBridge } from './workspace-adapter.js';

interface ListedWorkspaceFile {
  readonly path: string;
}

export interface DesktopApplicationOptions {
  readonly bridge: DesktopBridge;
  readonly workspaceAdapter: WorkspaceAdapter;
  readonly recoveryStore: DesktopRecoveryStore;
  readonly windowLifecycle: DesktopWindowLifecycle;
  readonly diffWorkerFactory?: DiffWorkerFactory;
  readonly layoutPreferenceStore?: DesktopLayoutPreferenceStore;
  readonly bundledPluginCatalogLoader?: () => Promise<readonly BundledPluginCatalogEntry[]>;
  readonly pluginKeyValueStorage?: PluginKeyValueStorage | null;
  readonly workspaceIdentityProvider?: WorkspaceIdentityProvider;
  readonly document: Document;
  readonly window: Window;
}

export interface DesktopRecoveryStore extends RecoveryStore {
  list(): Promise<readonly LoadedRecoveryRecord[]>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

function trackNativeDocument(adapter: WorkspaceAdapter, session: DocumentSession): Disposable {
  const candidate = adapter as WorkspaceAdapter & {
    readonly trackDocument?: (path: DocumentSession['state']['path']) => Disposable;
  };
  return candidate.trackDocument?.(session.state.path) ?? { dispose() {} };
}

function decodeWorkspaceFiles(value: unknown): readonly ListedWorkspaceFile[] {
  if (!Array.isArray(value)) { throw new Error('Workspace file list must be an array'); }
  const files = value.map((entry) => {
    if (!isRecord(entry) || 'string' !== typeof entry.relative_path) {
      throw new Error('Workspace file entry is malformed');
    }
    return { path: workspacePath(entry.relative_path) };
  });
  return files
    .filter(({ path }) => path.toLocaleLowerCase('en-US').endsWith('.md'))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function remapViewAfterContentReplacement(
  view: PaneViewState,
  before: string,
  after: string,
): PaneViewState {
  let prefix = 0;
  const shared = Math.min(before.length, after.length);
  while (prefix < shared && before[prefix] === after[prefix]) { prefix += 1; }
  let suffix = 0;
  while (
    suffix < shared - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  ) { suffix += 1; }
  const oldEnd = before.length - suffix;
  const newEnd = after.length - suffix;
  const mapOffset = (offset: number): number => {
    if (offset <= prefix) { return offset; }
    if (oldEnd <= offset) { return offset + (after.length - before.length); }
    return Math.min(newEnd, prefix + Math.min(offset - prefix, newEnd - prefix));
  };
  return {
    ...view,
    selectionAnchor: Math.max(0, mapOffset(view.selectionAnchor)),
    selectionHead: Math.max(0, mapOffset(view.selectionHead)),
  };
}

function element<K extends keyof HTMLElementTagNameMap>(
  document: Document,
  tagName: K,
  options: { readonly id?: string; readonly className?: string; readonly text?: string } = {},
): HTMLElementTagNameMap[K] {
  const result = document.createElement(tagName);
  if (options.id) { result.id = options.id; }
  if (options.className) { result.className = options.className; }
  if (undefined !== options.text) { result.textContent = options.text; }
  return result;
}

export class DesktopApplication implements Disposable {
  readonly #bridge: DesktopBridge;
  readonly #workspaceAdapter: WorkspaceAdapter;
  readonly #recoveryStore: DesktopRecoveryStore;
  readonly #windowLifecycle: DesktopWindowLifecycle;
  readonly #layoutPreferenceStore: DesktopLayoutPreferenceStore;
  readonly #bundledPluginCatalogLoader: () => Promise<readonly BundledPluginCatalogEntry[]>;
  readonly #document: Document;
  readonly #window: Window;
  readonly #panes: PaneController;
  readonly #codeMirrorDocuments = new CodeMirrorDocumentPool();
  readonly #recovery: RecoveryCoordinator;
  readonly #trackedSessions = new Map<DocumentSession, Disposable>();
  readonly #mediaTransactions = new Set<DocumentSession>();
  readonly #root: HTMLElement;
  readonly #runtimeStatus: HTMLParagraphElement;
  readonly #pathInput: HTMLInputElement;
  readonly #fileSelect: HTMLSelectElement;
  readonly #openButton: HTMLButtonElement;
  readonly #splitButton: HTMLButtonElement;
  readonly #recoveryPanel: HTMLElement;
  readonly #recoveryText: HTMLParagraphElement;
  readonly #restoreRecoveryButton: HTMLButtonElement;
  readonly #laterRecoveryButton: HTMLButtonElement;
  readonly #discardRecoveryButton: HTMLButtonElement;
  readonly #saveButton: HTMLButtonElement;
  readonly #diffButton: HTMLButtonElement;
  readonly #documentTitle: HTMLDivElement;
  readonly #documentStatus: HTMLParagraphElement;
  readonly #primaryPluginHeaders: HTMLElement;
  readonly #conflictPanel: HTMLElement;
  readonly #conflictText: HTMLParagraphElement;
  readonly #reloadConflictButton: HTMLButtonElement;
  readonly #keepConflictRecoveryButton: HTMLButtonElement;
  readonly #continueConflictButton: HTMLButtonElement;
  readonly #panesHost: HTMLElement;
  readonly #primaryPane: HTMLElement;
  readonly #editorHost: HTMLDivElement;
  readonly #placeholder: HTMLParagraphElement;
  readonly #diffHost: HTMLElement;
  readonly #diffView: DesktopDiffView;
  readonly #secondaryPane: HTMLElement;
  readonly #secondaryDocumentTitle: HTMLDivElement;
  readonly #secondaryDocumentStatus: HTMLParagraphElement;
  readonly #secondaryPluginHeaders: HTMLElement;
  readonly #secondarySaveButton: HTMLButtonElement;
  readonly #secondaryDiffButton: HTMLButtonElement;
  readonly #closeSecondaryButton: HTMLButtonElement;
  readonly #secondaryEditorHost: HTMLDivElement;
  readonly #secondaryPlaceholder: HTMLParagraphElement;
  readonly #secondaryDiffHost: HTMLElement;
  readonly #secondaryDiffView: DesktopDiffView;
  readonly #pluginRuntime: InProcessPluginRuntime;
  readonly #pluginAssets: DesktopPluginAssetHost;
  readonly #pluginCommands: DesktopPluginCommandHost;
  readonly #pluginDocuments: DesktopPluginDocumentHub;
  readonly #pluginEditor: DesktopPluginEditorHost;
  readonly #pluginExtensions: DesktopPluginExtensionHost;
  readonly #pluginHeaders: DesktopDocumentHeaderHost;
  readonly #pluginStorage: DesktopPluginStorageManager;
  readonly #pluginViews: DesktopPluginViewHost;
  readonly #pluginWorkspace: DesktopPluginWorkspaceHost;
  readonly #workspaceIdentity: DesktopWorkspaceIdentity | null;
  readonly #onWindowBlur = (): void => {
    void this.#recovery.flushAll('blur').then(() => this.#renderSessionState());
  };
  readonly #onWindowResize = (): void => { this.#syncSecondaryAvailability(); };
  #watchSubscription: Disposable | null = null;
  #closeSubscription: Disposable | null = null;
  #updaterHandshakeSubscription: Disposable | null = null;
  #editor: CodeMirrorTextEditor | null = null;
  #editorPluginBinding: Disposable | null = null;
  #editorSaveBinding: Disposable | null = null;
  #sessionBinding: SessionEditorBinding | null = null;
  #secondaryEditor: CodeMirrorTextEditor | null = null;
  #secondaryEditorPluginBinding: Disposable | null = null;
  #secondaryEditorSaveBinding: Disposable | null = null;
  #secondarySessionBinding: SessionEditorBinding | null = null;
  #currentSession: DocumentSession | null = null;
  #pendingRecovery: LoadedRecoveryRecord[] = [];
  #busy = false;
  #closing = false;
  #lifecycleRegistrationStarted = false;
  #updaterHandshakeRegistrationStarted = false;
  #disposed = false;

  public constructor(options: DesktopApplicationOptions) {
    this.#bridge = options.bridge;
    this.#workspaceAdapter = options.workspaceAdapter;
    this.#recoveryStore = options.recoveryStore;
    this.#windowLifecycle = options.windowLifecycle;
    this.#layoutPreferenceStore = options.layoutPreferenceStore ??
      createDesktopLayoutPreferenceStore(options.window);
    this.#bundledPluginCatalogLoader = options.bundledPluginCatalogLoader ??
      loadDesktopBundledPluginCatalog;
    this.#document = options.document;
    this.#window = options.window;
    const registry = new SessionRegistry();
    this.#panes = new PaneController(registry);
    const layoutPreference = this.#loadLayoutPreference();
    if (layoutPreference) { this.#panes.restoreLayout(layoutPreference); }
    this.#recovery = new RecoveryCoordinator({
      store: options.recoveryStore,
      scheduler: {
        schedule: (delayMs, task) => this.#window.setTimeout(task, delayMs),
        cancel: (timer) => this.#window.clearTimeout(timer as number),
      },
      clock: { now: () => Date.now() },
    });

    this.#root = element(this.#document, 'main', { id: 'v2-app-root' });
    this.#root.dataset.adapter = 'tauri';
    this.#root.dataset.persistence = this.#workspaceAdapter.capabilities.persistence;
    this.#root.dataset.recovery = options.recoveryStore.constructor.name;
    this.#root.setAttribute('aria-labelledby', 'v2-app-title');

    const header = element(this.#document, 'header', { className: 'v2-app-header' });
    const title = element(this.#document, 'h1', {
      id: 'v2-app-title',
      text: `${this.#document.title} V2`,
    });
    this.#runtimeStatus = element(this.#document, 'p', {
      id: 'v2-runtime-status',
      className: 'v2-runtime-status',
      text: 'Tauri workspace adapter · explicit save',
    });
    header.append(title, this.#runtimeStatus);

    const workspaceBar = element(this.#document, 'section', { className: 'v2-workspace-bar' });
    workspaceBar.setAttribute('aria-label', 'Workspace document controls');
    this.#fileSelect = element(this.#document, 'select', { id: 'v2-file-select' });
    this.#fileSelect.setAttribute('aria-label', 'Known Markdown files');
    this.#replaceFileOptions([]);
    this.#pathInput = element(this.#document, 'input', { id: 'v2-document-path' });
    this.#pathInput.type = 'text';
    this.#pathInput.placeholder = 'notes/example.md';
    this.#pathInput.autocomplete = 'off';
    this.#pathInput.setAttribute('aria-label', 'Workspace-relative Markdown path');
    const refreshButton = element(this.#document, 'button', { text: 'Refresh files' });
    refreshButton.type = 'button';
    const chooseButton = element(this.#document, 'button', { text: 'Open folder' });
    chooseButton.type = 'button';
    this.#openButton = element(this.#document, 'button', { text: 'Open document' });
    this.#openButton.type = 'button';
    this.#splitButton = element(this.#document, 'button', { text: 'Open in split' });
    this.#splitButton.type = 'button';
    const pluginCommands = element(this.#document, 'div', {
      id: 'v2-plugin-commands',
      className: 'v2-plugin-commands',
    });
    workspaceBar.append(
      this.#fileSelect,
      this.#pathInput,
      refreshButton,
      chooseButton,
      this.#openButton,
      this.#splitButton,
      pluginCommands,
    );

    this.#recoveryPanel = element(this.#document, 'section', {
      id: 'v2-recovery-panel',
      className: 'v2-recovery-panel',
    });
    this.#recoveryPanel.hidden = true;
    this.#recoveryPanel.setAttribute('aria-live', 'polite');
    this.#recoveryText = element(this.#document, 'p');
    const recoveryActions = element(this.#document, 'div', {
      className: 'v2-recovery-actions',
    });
    this.#restoreRecoveryButton = element(this.#document, 'button', {
      text: 'Restore recovery',
    });
    this.#restoreRecoveryButton.type = 'button';
    this.#laterRecoveryButton = element(this.#document, 'button', { text: 'Later' });
    this.#laterRecoveryButton.type = 'button';
    this.#discardRecoveryButton = element(this.#document, 'button', {
      text: 'Discard recovery',
    });
    this.#discardRecoveryButton.type = 'button';
    recoveryActions.append(
      this.#restoreRecoveryButton,
      this.#laterRecoveryButton,
      this.#discardRecoveryButton,
    );
    this.#recoveryPanel.append(this.#recoveryText, recoveryActions);

    this.#primaryPane = element(this.#document, 'section', {
      id: 'v2-primary-pane',
      className: 'v2-document-pane v2-primary-pane',
    });
    this.#primaryPane.setAttribute('aria-label', 'Primary document pane');
    const documentHeader = element(this.#document, 'header', { className: 'v2-document-header' });
    const identity = element(this.#document, 'div', { className: 'v2-document-identity' });
    this.#documentTitle = element(this.#document, 'div', {
      className: 'v2-document-title',
      text: 'No document open',
    });
    this.#documentStatus = element(this.#document, 'p', {
      id: 'v2-primary-status',
      className: 'v2-document-status',
      text: 'Choose a workspace-relative Markdown path.',
    });
    this.#documentStatus.setAttribute('role', 'status');
    this.#documentStatus.setAttribute('aria-live', 'polite');
    this.#primaryPluginHeaders = element(this.#document, 'div', {
      id: 'v2-primary-plugin-headers',
      className: 'v2-document-contributions',
    });
    this.#primaryPluginHeaders.hidden = true;
    identity.append(this.#documentTitle, this.#documentStatus, this.#primaryPluginHeaders);
    this.#saveButton = element(this.#document, 'button', { text: 'Save' });
    this.#saveButton.type = 'button';
    this.#saveButton.disabled = true;
    this.#diffButton = element(this.#document, 'button', { text: 'Diff' });
    this.#diffButton.type = 'button';
    this.#diffButton.disabled = true;
    const primaryActions = element(this.#document, 'div', { className: 'v2-pane-actions' });
    primaryActions.append(this.#diffButton, this.#saveButton);
    documentHeader.append(identity, primaryActions);

    this.#conflictPanel = element(this.#document, 'section', {
      id: 'v2-conflict-panel',
      className: 'v2-conflict-panel',
    });
    this.#conflictPanel.hidden = true;
    this.#conflictPanel.setAttribute('aria-live', 'assertive');
    this.#conflictText = element(this.#document, 'p');
    const conflictActions = element(this.#document, 'div', {
      className: 'v2-conflict-actions',
    });
    this.#reloadConflictButton = element(this.#document, 'button', { text: 'Reload disk' });
    this.#reloadConflictButton.type = 'button';
    this.#keepConflictRecoveryButton = element(this.#document, 'button', {
      text: 'Keep buffer as recovery copy',
    });
    this.#keepConflictRecoveryButton.type = 'button';
    this.#continueConflictButton = element(this.#document, 'button', {
      text: 'Continue editing',
    });
    this.#continueConflictButton.type = 'button';
    conflictActions.append(
      this.#reloadConflictButton,
      this.#keepConflictRecoveryButton,
      this.#continueConflictButton,
    );
    this.#conflictPanel.append(this.#conflictText, conflictActions);

    this.#editorHost = element(this.#document, 'div', {
      id: 'v2-primary-editor-host',
      className: 'v2-editor-host',
    });
    this.#placeholder = element(this.#document, 'p', {
      className: 'v2-editor-placeholder',
      text: 'Open a Markdown document to start editing.',
    });
    this.#editorHost.append(this.#placeholder);
    this.#diffHost = element(this.#document, 'div', {
      id: 'v2-primary-diff',
      className: 'v2-diff-host',
    });
    this.#diffView = new DesktopDiffView(
      this.#document,
      this.#diffHost,
      options.diffWorkerFactory
        ? new LineDiffTaskRunner(options.diffWorkerFactory)
        : createDesktopLineDiffRunner(this.#window),
    );
    this.#primaryPane.append(documentHeader, this.#editorHost, this.#diffHost);

    this.#secondaryPane = element(this.#document, 'section', {
      id: 'v2-secondary-pane',
      className: 'v2-document-pane v2-secondary-pane',
    });
    this.#secondaryPane.hidden = true;
    this.#secondaryPane.setAttribute('aria-label', 'Secondary document pane');
    const secondaryHeader = element(this.#document, 'header', {
      className: 'v2-document-header',
    });
    const secondaryIdentity = element(this.#document, 'div', {
      className: 'v2-document-identity',
    });
    this.#secondaryDocumentTitle = element(this.#document, 'div', {
      className: 'v2-document-title',
      text: 'No document open',
    });
    this.#secondaryDocumentStatus = element(this.#document, 'p', {
      id: 'v2-secondary-status',
      className: 'v2-document-status',
      text: 'Open a document in split view.',
    });
    this.#secondaryDocumentStatus.setAttribute('role', 'status');
    this.#secondaryDocumentStatus.setAttribute('aria-live', 'polite');
    this.#secondaryPluginHeaders = element(this.#document, 'div', {
      id: 'v2-secondary-plugin-headers',
      className: 'v2-document-contributions',
    });
    this.#secondaryPluginHeaders.hidden = true;
    secondaryIdentity.append(
      this.#secondaryDocumentTitle,
      this.#secondaryDocumentStatus,
      this.#secondaryPluginHeaders,
    );
    const secondaryActions = element(this.#document, 'div', {
      className: 'v2-pane-actions',
    });
    this.#secondarySaveButton = element(this.#document, 'button', { text: 'Save' });
    this.#secondarySaveButton.type = 'button';
    this.#secondarySaveButton.disabled = true;
    this.#secondaryDiffButton = element(this.#document, 'button', { text: 'Diff' });
    this.#secondaryDiffButton.type = 'button';
    this.#secondaryDiffButton.disabled = true;
    this.#closeSecondaryButton = element(this.#document, 'button', { text: 'Close split' });
    this.#closeSecondaryButton.type = 'button';
    secondaryActions.append(
      this.#secondaryDiffButton,
      this.#secondarySaveButton,
      this.#closeSecondaryButton,
    );
    secondaryHeader.append(secondaryIdentity, secondaryActions);
    this.#secondaryEditorHost = element(this.#document, 'div', {
      id: 'v2-secondary-editor-host',
      className: 'v2-editor-host',
    });
    this.#secondaryPlaceholder = element(this.#document, 'p', {
      className: 'v2-editor-placeholder',
      text: 'Open a document in split view.',
    });
    this.#secondaryEditorHost.append(this.#secondaryPlaceholder);
    this.#secondaryDiffHost = element(this.#document, 'div', {
      id: 'v2-secondary-diff',
      className: 'v2-diff-host',
    });
    this.#secondaryDiffView = new DesktopDiffView(
      this.#document,
      this.#secondaryDiffHost,
      options.diffWorkerFactory
        ? new LineDiffTaskRunner(options.diffWorkerFactory)
        : createDesktopLineDiffRunner(this.#window),
    );
    this.#secondaryPane.append(
      secondaryHeader,
      this.#secondaryEditorHost,
      this.#secondaryDiffHost,
    );

    this.#panesHost = element(this.#document, 'section', {
      id: 'v2-panes',
      className: 'v2-panes',
    });
    this.#panesHost.dataset.split = 'false';
    this.#panesHost.append(this.#primaryPane, this.#secondaryPane);
    this.#root.append(
      header,
      workspaceBar,
      this.#recoveryPanel,
      this.#conflictPanel,
      this.#panesHost,
    );

    let pluginRuntime: InProcessPluginRuntime | null = null;
    const onPluginFailure = (
      pluginId: string,
      phase: 'provider' | 'render',
      error: unknown,
    ): void => {
      void pluginRuntime?.reportFailure(pluginId, phase, error).finally(() => {
        if (pluginRuntime && !this.#disposed) {
          this.#root.dataset.plugins = `disabled:${pluginRuntime.listDisabledPluginIds().length}`;
        }
        this.#pluginHeaders.renderAll();
      });
    };
    this.#pluginDocuments = new DesktopPluginDocumentHub(
      onPluginFailure,
      (edit) => this.#applyPluginActiveEdit(edit),
      () => {
        const panes = this.#panes.state;
        return [panes.primary.session, panes.secondary.session]
          .filter((session): session is DocumentSession => null !== session);
      },
    );
    this.#pluginExtensions = new DesktopPluginExtensionHost(onPluginFailure);
    this.#pluginEditor = new DesktopPluginEditorHost();
    this.#pluginHeaders = new DesktopDocumentHeaderHost({
      document: this.#document,
      containers: {
        primary: this.#primaryPluginHeaders,
        secondary: this.#secondaryPluginHeaders,
      },
      getSnapshot: (paneId) => {
        const session = this.#panes.state[paneId].session;
        return session ? createPluginDocumentSnapshot(session) : null;
      },
      onFailure: onPluginFailure,
    });
    let browserStorage: PluginKeyValueStorage | null = null;
    if (undefined !== options.pluginKeyValueStorage) {
      browserStorage = options.pluginKeyValueStorage;
    } else {
      try {
        browserStorage = options.window.localStorage;
      } catch {
        browserStorage = null;
      }
    }
    if (options.workspaceIdentityProvider) {
      this.#workspaceIdentity = null;
    } else {
      let hostCrypto: Crypto | null = null;
      try {
        hostCrypto = options.window.crypto;
      } catch {
        hostCrypto = null;
      }
      this.#workspaceIdentity = new DesktopWorkspaceIdentity(this.#bridge, hostCrypto);
    }
    const workspaceIdentity = options.workspaceIdentityProvider ?? this.#workspaceIdentity?.get ??
      (async () => null);
    this.#pluginStorage = new DesktopPluginStorageManager(browserStorage, workspaceIdentity);
    this.#pluginCommands = new DesktopPluginCommandHost({
      document: this.#document,
      window: this.#window,
      container: pluginCommands,
      onFailure: onPluginFailure,
    });
    this.#pluginAssets = new DesktopPluginAssetHost({ bridge: this.#bridge });
    this.#pluginViews = new DesktopPluginViewHost({
      document: this.#document,
      container: this.#root,
      onFailure: onPluginFailure,
      imageResolver: this.#pluginAssets,
    });
    this.#pluginWorkspace = new DesktopPluginWorkspaceHost({
      bridge: this.#bridge,
      workspaceAdapter: this.#workspaceAdapter,
      window: this.#window,
      onFailure: onPluginFailure,
    });
    const pluginNavigation = new DesktopPluginNavigationHost(
      (path, navigationOptions) => this.#openMarkdownFromPlugin(path, navigationOptions),
    );
    const pluginVcs = new DesktopPluginVcsHost(this.#bridge);
    const pluginHost = new DesktopPluginHost({
      commands: this.#pluginCommands,
      documents: this.#pluginDocuments,
      editor: this.#pluginEditor,
      extensions: this.#pluginExtensions,
      headers: this.#pluginHeaders,
      navigation: pluginNavigation,
      storage: this.#pluginStorage,
      views: this.#pluginViews,
      vcs: pluginVcs,
      workspace: this.#pluginWorkspace,
    });
    pluginRuntime = new InProcessPluginRuntime(pluginHost);
    this.#pluginRuntime = pluginRuntime;

    this.#fileSelect.addEventListener('change', () => {
      if (this.#fileSelect.value) { this.#pathInput.value = this.#fileSelect.value; }
    });
    this.#pathInput.addEventListener('keydown', (event) => {
      if ('Enter' === event.key) { void this.openDocument(); }
    });
    refreshButton.addEventListener('click', () => { void this.refreshFiles(); });
    chooseButton.addEventListener('click', () => { void this.chooseWorkspace(); });
    this.#openButton.addEventListener('click', () => { void this.openDocument(); });
    this.#splitButton.addEventListener('click', () => { void this.openDocumentInSplit(); });
    this.#saveButton.addEventListener('click', () => {
      this.#activatePane('primary');
      void this.saveDocument();
    });
    this.#diffButton.addEventListener('click', () => { this.toggleDiff('primary'); });
    this.#secondarySaveButton.addEventListener('click', () => {
      this.#activatePane('secondary');
      void this.saveDocument();
    });
    this.#secondaryDiffButton.addEventListener('click', () => {
      this.toggleDiff('secondary');
    });
    this.#closeSecondaryButton.addEventListener('click', () => { this.closeSecondaryPane(); });
    this.#primaryPane.addEventListener('focusin', () => { this.#activatePane('primary'); });
    this.#primaryPane.addEventListener('pointerdown', () => { this.#activatePane('primary'); });
    this.#secondaryPane.addEventListener('focusin', () => { this.#activatePane('secondary'); });
    this.#secondaryPane.addEventListener('pointerdown', () => { this.#activatePane('secondary'); });
    this.#reloadConflictButton.addEventListener('click', () => {
      void this.reloadConflictFromDisk();
    });
    this.#keepConflictRecoveryButton.addEventListener('click', () => {
      void this.keepConflictRecovery();
    });
    this.#continueConflictButton.addEventListener('click', () => {
      this.#activeEditor()?.focus();
      this.#renderSessionState('Conflict retained · editing may continue, but save stays disabled');
    });
    this.#restoreRecoveryButton.addEventListener('click', () => {
      void this.restoreNextRecovery();
    });
    this.#laterRecoveryButton.addEventListener('click', () => {
      this.#pendingRecovery.shift();
      this.#renderRecoveryPrompt();
    });
    this.#discardRecoveryButton.addEventListener('click', () => {
      void this.discardNextRecovery();
    });
    this.#window.addEventListener('blur', this.#onWindowBlur);
    this.#window.addEventListener('resize', this.#onWindowResize);
    this.#syncSecondaryAvailability();

    if ('native-hints' === this.#workspaceAdapter.capabilities.externalWatch) {
      this.#watchSubscription = registry.bindWorkspaceWatch(
        this.#workspaceAdapter,
        (refresh) => this.#handleWorkspaceRefresh(refresh),
      );
    }
  }

  public mount(): void {
    if (this.#disposed) { throw new Error('Cannot mount a disposed desktop application'); }
    this.#document.body.replaceChildren(this.#root);
    void this.#installWindowLifecycle();
    void this.#installUpdaterHandshake();
    void this.#installBundledPlugins();
    void this.discoverRecovery();
  }

  public prepareForRestart(): Promise<PrepareForRestartResult> {
    if (this.#disposed) { throw new Error('Cannot prepare a disposed desktop application'); }
    return this.#recovery.prepareForRestart();
  }

  /** Called only after an application-owned rename succeeds; external renames never use it. */
  public migratePluginDocumentStorage(
    previousPath: string,
    nextPath: string,
  ): Promise<PluginStorageResult<null>> {
    return this.#pluginStorage.migrateDocumentPath(
      workspacePath(previousPath),
      workspacePath(nextPath),
    );
  }

  public async discoverRecovery(): Promise<void> {
    try {
      const workspacePath = await this.#bridge.invoke<unknown>('workspace_get_path', {});
      if (null === workspacePath) {
        this.#pendingRecovery = [];
        this.#renderRecoveryPrompt();
        return;
      }
      if ('string' !== typeof workspacePath || '' === workspacePath) {
        throw new Error('Workspace binding response is malformed');
      }
      this.#pendingRecovery = [...await this.#recoveryStore.list()];
      this.#renderRecoveryPrompt();
      if (0 < this.#pendingRecovery.length) {
        this.#runtimeStatus.textContent =
          `${this.#pendingRecovery.length} unresolved recovery ` +
          `cop${1 === this.#pendingRecovery.length ? 'y' : 'ies'}`;
      }
    } catch (error) {
      this.#pendingRecovery = [];
      this.#renderRecoveryPrompt();
      this.#runtimeStatus.textContent = `Recovery check error: ${messageFrom(error)}`;
    }
  }

  public async restoreNextRecovery(): Promise<void> {
    if (this.#busy) { return; }
    const loaded = this.#pendingRecovery[0];
    if (!loaded) { return; }
    if (this.#panes.registry.get(loaded.record.pathKey)) {
      this.#runtimeStatus.textContent = 'Recovery restore blocked because the document is already open';
      return;
    }
    this.#setBusy(true, 'Restoring recovery…');
    try {
      const read = await this.#workspaceAdapter.read(loaded.record.path);
      if (!read.ok) {
        this.#runtimeStatus.textContent =
          `Recovery read error: ${read.error.kind}: ${read.error.message}`;
        return;
      }
      if (read.snapshot.pathKey !== loaded.record.pathKey) {
        throw new Error('Recovery document identity no longer matches the workspace file');
      }
      const opened = this.#panes.open(read.snapshot, this.#workspaceAdapter, {
        target: 'primary',
      });
      this.#saveLayoutPreference();
      this.#untrackSession(opened.releasedSession);
      const outcome = opened.session.restoreRecovery(loaded.record);
      this.#trackSession(opened.session);
      this.#bindSession(
        opened.paneId,
        opened.session,
        'conflict' === outcome.kind
          ? 'Recovery restored with an external-change conflict'
          : 'stale' === outcome.kind
            ? 'Recovery already matches disk'
            : `Recovery restored from ${loaded.generation}`,
      );
      if ('stale' === outcome.kind) { await this.#recoveryStore.remove(loaded.record.pathKey); }
      this.#pendingRecovery.shift();
      this.#renderRecoveryPrompt();
    } catch (error) {
      this.#runtimeStatus.textContent = `Recovery restore error: ${messageFrom(error)}`;
    } finally {
      this.#setBusy(false);
    }
  }

  public async discardNextRecovery(): Promise<void> {
    if (this.#busy) { return; }
    const loaded = this.#pendingRecovery[0];
    if (!loaded) { return; }
    if (!this.#window.confirm(`Discard recovery for ${loaded.record.path}?`)) { return; }
    this.#setBusy(true, 'Discarding recovery…');
    try {
      await this.#recoveryStore.remove(loaded.record.pathKey);
      this.#pendingRecovery.shift();
      this.#renderRecoveryPrompt();
      this.#runtimeStatus.textContent = 'Recovery discarded';
    } catch (error) {
      this.#runtimeStatus.textContent = `Recovery discard error: ${messageFrom(error)}`;
    } finally {
      this.#setBusy(false);
    }
  }

  public async chooseWorkspace(): Promise<void> {
    if (this.#busy) { return; }
    if (0 < this.#pendingRecovery.length) {
      this.#runtimeStatus.textContent = 'Resolve or defer recovery prompts before changing workspace';
      return;
    }
    if (0 < this.#panes.registry.list().length) {
      this.#runtimeStatus.textContent = 'Workspace change blocked while document sessions are open';
      return;
    }
    this.#setBusy(true, 'Choosing workspace…');
    try {
      const selected = await this.#bridge.invoke<unknown>('workspace_pick_and_bind', {});
      if (null === selected) {
        this.#runtimeStatus.textContent = 'Workspace selection cancelled';
        return;
      }
      if ('string' !== typeof selected || '' === selected) {
        throw new Error('Workspace binding result is malformed');
      }
      this.#workspaceIdentity?.invalidate();
      this.#pluginWorkspace.notifyWorkspaceReset();
      this.#pluginAssets.notifyWorkspaceReset();
      this.#runtimeStatus.textContent = 'Workspace bound · choose a Markdown document';
      await this.#refreshFilesWhileBusy();
      await this.discoverRecovery();
    } catch (error) {
      this.#runtimeStatus.textContent = `Workspace error: ${messageFrom(error)}`;
    } finally {
      this.#setBusy(false);
    }
  }

  public async refreshFiles(): Promise<void> {
    if (this.#busy) { return; }
    this.#setBusy(true, 'Loading workspace files…');
    try {
      await this.#refreshFilesWhileBusy();
    } catch (error) {
      this.#runtimeStatus.textContent = `Workspace error: ${messageFrom(error)}`;
    } finally {
      this.#setBusy(false);
    }
  }

  public async openDocument(): Promise<void> {
    await this.#openDocumentAt('active');
  }

  public async openDocumentInSplit(): Promise<void> {
    await this.#openDocumentAt('secondary');
  }

  async #openMarkdownFromPlugin(
    path: string,
    options: { readonly placement?: 'active-pane' | 'secondary-pane'; readonly focus?: boolean },
  ): Promise<void> {
    await this.#openDocumentAt(
      'secondary-pane' === options.placement ? 'secondary' : 'active',
      path,
      options.focus ?? true,
    );
  }

  async #openWikiLink(paneId: PaneId, rawTarget: string): Promise<void> {
    const withoutAnchor = rawTarget.split('#', 1)[0]?.trim() ?? '';
    if (
      '' === withoutAnchor ||
      512 < withoutAnchor.length ||
      /^(?:[A-Za-z][A-Za-z0-9+.-]*:|\/|\\)/u.test(withoutAnchor) ||
      withoutAnchor.includes('\0')
    ) {
      this.#statusForPane(paneId).textContent = 'Wiki link target is invalid';
      return;
    }
    const markdownTarget = withoutAnchor.toLocaleLowerCase('en-US').endsWith('.md')
      ? withoutAnchor
      : `${withoutAnchor}.md`;
    let path = markdownTarget;
    if (!markdownTarget.includes('/')) {
      const match = [...this.#fileSelect.options].find((option) =>
        option.value.split('/').at(-1)?.toLocaleLowerCase('en-US') ===
          markdownTarget.toLocaleLowerCase('en-US'));
      path = match?.value ?? markdownTarget;
    } else {
      const currentPath = this.#panes.state[paneId].session?.state.path;
      const directory = currentPath?.split('/').slice(0, -1).join('/') ?? '';
      path = '' === directory ? markdownTarget : `${directory}/${markdownTarget}`;
    }
    try {
      path = workspacePath(path);
    } catch {
      this.#statusForPane(paneId).textContent = 'Wiki link escapes the workspace';
      return;
    }
    this.#activatePane(paneId);
    await this.#openMarkdownFromPlugin(path, {
      placement: 'secondary' === paneId ? 'secondary-pane' : 'active-pane',
      focus: true,
    });
  }

  async #applyPluginActiveEdit(
    edit: PluginActiveDocumentEdit,
  ): Promise<PluginActiveDocumentEditResult> {
    const session = this.#currentSession;
    if (
      !session ||
      session.state.path !== edit.path ||
      session.state.bufferVersion !== edit.expectedBufferVersion
    ) {
      return {
        status: 'stale',
        current: session ? createPluginDocumentSnapshot(session) : null,
      };
    }
    if ('read-only' === session.state.savedSnapshot.access.kind) {
      return {
        status: 'read-only',
        message: session.state.savedSnapshot.access.message,
      };
    }
    const before = session.state.buffer;
    const paneViews = (['primary', 'secondary'] as const).flatMap((paneId) => {
      const editor = 'primary' === paneId ? this.#editor : this.#secondaryEditor;
      return editor && this.#panes.state[paneId].session === session
        ? [{ editor, view: editor.captureView() }]
        : [];
    });
    session.edit(edit.content);
    this.#syncSessionBindings(session);
    for (const { editor, view } of paneViews) {
      editor.restoreView(remapViewAfterContentReplacement(view, before, edit.content));
    }
    this.#pluginDocuments.emit('change', session);
    this.#refreshDiffForSession(session);
    this.#renderSessionState('Metadata updated in the editor · save to persist');
    void this.#recovery.notifyChanged(session).catch((error: unknown) => {
      this.#activeDocumentStatus().textContent =
        `Metadata updated, but recovery scheduling failed: ${messageFrom(error)}`;
    });
    return { status: 'applied', snapshot: createPluginDocumentSnapshot(session) };
  }

  async #rollbackMediaAsset(receipt: MediaWriteReceipt): Promise<string | null> {
    try {
      const result = decodeMediaRollbackResult(await this.#bridge.invoke<unknown>(
        'workspace_rollback_media_asset',
        { request: { schemaVersion: 1, receipt } },
      ));
      return 'retained' === result.status
        ? `${result.kind}: ${result.message}`
        : null;
    } catch (error) {
      return messageFrom(error);
    }
  }

  async #insertMedia(paneId: PaneId, input: EditorMediaInput): Promise<void> {
    const session = this.#panes.state[paneId].session;
    if (!session) { throw new Error('No document is open in this pane'); }
    const initial = session.state;
    if ('read-only' === initial.savedSnapshot.access.kind) {
      throw new Error(initial.savedSnapshot.access.message);
    }
    if (this.#mediaTransactions.has(session)) {
      throw new Error('Another media insertion is still running for this document');
    }
    if (
      0 >= input.file.size ||
      MEDIA_INSERT_LIMITS.maxFileBytes < input.file.size
    ) { throw new Error('Media file is empty or exceeds the file limit'); }

    const originEditor = 'primary' === paneId ? this.#editor : this.#secondaryEditor;
    if (!originEditor) { throw new Error('The editor is unavailable'); }
    const paneViews = (['primary', 'secondary'] as const).flatMap((candidatePaneId) => {
      const editor = 'primary' === candidatePaneId ? this.#editor : this.#secondaryEditor;
      return editor && this.#panes.state[candidatePaneId].session === session
        ? [{ paneId: candidatePaneId, editor, view: editor.captureView() }]
        : [];
    });
    this.#mediaTransactions.add(session);
    for (const { editor } of paneViews) { editor.setReadOnly(true); }
    this.#statusForPane(paneId).textContent =
      `${'paste' === input.source ? 'Pasting' : 'Dropping'} media…`;

    let receipt: MediaWriteReceipt | null = null;
    try {
      const bytes = new Uint8Array(await input.file.arrayBuffer());
      if (bytes.byteLength !== input.file.size) {
        throw new Error('Media file changed while it was being read');
      }
      const contentBase64 = encodeMediaBase64(bytes);
      if (
        this.#panes.state[paneId].session !== session ||
        session.state.path !== initial.path ||
        session.state.bufferVersion !== initial.bufferVersion ||
        session.state.buffer !== initial.buffer
      ) { throw new Error('Document changed before media insertion'); }

      const createdAt = new Date();
      for (
        let attempt = 0;
        attempt < MEDIA_INSERT_LIMITS.maxCollisionAttempts;
        attempt += 1
      ) {
        const path = createMediaAssetPath(input.file.name, input.file.type, createdAt, attempt);
        const result = decodeMediaWriteResult(await this.#bridge.invoke<unknown>(
          'workspace_write_media_asset',
          {
            request: {
              schemaVersion: 1,
              path,
              mimeType: input.file.type.toLocaleLowerCase('en-US'),
              contentBase64,
            },
          },
        ));
        if ('written' === result.status) {
          receipt = result.receipt;
          break;
        }
        if ('already-exists' !== result.kind) {
          throw new Error(`${result.kind}: ${result.message}`);
        }
      }
      if (!receipt) { throw new Error('Unable to allocate a unique media filename'); }

      if (
        this.#panes.state[paneId].session !== session ||
        session.state.path !== initial.path ||
        session.state.bufferVersion !== initial.bufferVersion ||
        session.state.buffer !== initial.buffer
      ) { throw new Error('Document changed while the media asset was being written'); }

      const edit = applyMediaMarkdownEdit(
        initial.buffer,
        input.selectionAnchor,
        input.selectionHead,
        markdownMediaLink(receipt.path, input.file.name),
      );
      session.edit(edit.content);
      const insertedVersion = session.state.bufferVersion;
      this.#syncSessionBindings(session);
      for (const { editor } of paneViews) { editor.setReadOnly(true); }
      for (const { paneId: candidatePaneId, editor, view } of paneViews) {
        editor.restoreView(candidatePaneId === paneId
          ? {
              ...view,
              selectionAnchor: edit.cursor,
              selectionHead: edit.cursor,
              focused: true,
            }
          : remapViewAfterContentReplacement(view, initial.buffer, edit.content));
      }
      this.#pluginDocuments.emit('change', session);
      this.#refreshDiffForSession(session);

      let recoveryError: string | null = null;
      try {
        const outcome = await this.#recovery.flush(session, 'manual');
        if ('persisted' !== outcome.kind) {
          recoveryError = 'error' === outcome.kind
            ? outcome.message
            : 'superseded' === outcome.kind
              ? 'the document changed during recovery persistence'
              : 'the media link did not require a recovery record';
        }
      } catch (error) {
        recoveryError = messageFrom(error);
      }

      if (recoveryError) {
        const current = session.state;
        if (current.bufferVersion === insertedVersion && current.buffer === edit.content) {
          session.edit(initial.buffer);
          this.#syncSessionBindings(session);
          for (const { editor } of paneViews) { editor.setReadOnly(true); }
          for (const { editor, view } of paneViews) { editor.restoreView(view); }
          this.#pluginDocuments.emit('change', session);
          this.#refreshDiffForSession(session);
          try {
            await this.#recovery.flush(session, 'manual');
          } catch {
            // The prior buffer remains authoritative in memory and on disk; rollback is still safe.
          }
          const rollbackError = await this.#rollbackMediaAsset(receipt);
          receipt = null;
          throw new Error(
            `Recovery persistence failed: ${recoveryError}` +
            (rollbackError ? `; media rollback was retained: ${rollbackError}` : ''),
          );
        }
        receipt = null;
        throw new Error(
          `Recovery persistence did not complete after a concurrent edit: ${recoveryError}; ` +
          'the media asset was retained',
        );
      }

      receipt = null;
      this.#renderSessionState('Media inserted · recovery copy updated · save to persist');
    } catch (error) {
      if (receipt) {
        const rollbackError = await this.#rollbackMediaAsset(receipt);
        receipt = null;
        if (rollbackError) {
          throw new Error(`${messageFrom(error)}; media rollback was retained: ${rollbackError}`);
        }
      }
      throw error;
    } finally {
      this.#mediaTransactions.delete(session);
      this.#syncSessionBindings(session);
    }
  }

  async #openDocumentAt(
    target: PaneOpenTarget,
    requestedPath?: string,
    focus = true,
  ): Promise<void> {
    if (this.#busy) { return; }
    this.#setBusy(true, 'secondary' === target ? 'Opening split document…' : 'Opening document…');
    try {
      const path = workspacePath(requestedPath ?? this.#pathInput.value.trim());
      this.#pathInput.value = path;
      const result = await this.#workspaceAdapter.read(path);
      if (!result.ok) {
        this.#activeDocumentStatus().textContent =
          `${result.error.kind}: ${result.error.message}`;
        return;
      }
      const resolvedTarget = 'active' === target ? this.#panes.state.activePane : target;
      this.#closeDiff(resolvedTarget);
      this.#capturePaneView(resolvedTarget);
      const opened = this.#panes.open(result.snapshot, this.#workspaceAdapter, {
        target,
      });
      this.#saveLayoutPreference();
      this.#untrackSession(opened.releasedSession);
      this.#trackSession(opened.session);
      this.#bindSession(
        opened.paneId,
        opened.session,
        opened.fellBackToPrimary
          ? 'Split is unavailable at this width · opened in primary'
          : opened.reusedSession
            ? 'Open session reused'
            : 'Document opened',
        focus,
      );
    } catch (error) {
      this.#activeDocumentStatus().textContent = `Open error: ${messageFrom(error)}`;
    } finally {
      this.#setBusy(false);
    }
  }

  public async saveDocument(): Promise<void> {
    if (this.#busy || !this.#currentSession) { return; }
    const session = this.#currentSession;
    this.#setBusy(true, 'Saving…');
    try {
      const outcome = await session.save();
      await this.#recovery.notifyChanged(session);
      this.#syncSessionBindings(session);
      if ('conflict' === outcome.kind) {
        this.#closeDiffForSession(session);
      } else {
        this.#refreshDiffForSession(session);
      }
      if ('saved' === outcome.kind || 'still-dirty' === outcome.kind) {
        this.#pluginDocuments.emit('save', session);
      }
      if ('saved' === outcome.kind) {
        this.#renderSessionState('Saved');
      } else if ('still-dirty' === outcome.kind) {
        this.#renderSessionState('Saved one revision; newer edits remain');
      } else if ('conflict' === outcome.kind) {
        this.#renderSessionState('Save blocked by an external change');
      } else if ('error' === outcome.kind) {
        this.#renderSessionState(`Save error: ${outcome.message}`);
      } else {
        this.#renderSessionState('No changes to save');
      }
    } catch (error) {
      this.#activeDocumentStatus().textContent = `Save error: ${messageFrom(error)}`;
    } finally {
      this.#setBusy(false);
    }
  }

  public async reloadConflictFromDisk(): Promise<void> {
    if (this.#busy || !this.#currentSession?.state.conflict) { return; }
    const session = this.#currentSession;
    if (!this.#window.confirm(
      `Reload ${session.state.path} from disk and discard the current editor buffer?`,
    )) { return; }
    this.#setBusy(true, 'Reloading disk after conflict…');
    try {
      const result = await this.#workspaceAdapter.read(session.state.path);
      if (!result.ok) {
        this.#renderSessionState(
          `Reload blocked: ${result.error.kind}: ${result.error.message}`,
        );
        return;
      }
      if (result.snapshot.pathKey !== session.state.pathKey) {
        throw new Error('Reloaded document identity no longer matches the open session');
      }
      session.reloadFromDisk(result.snapshot);
      const recovery = await this.#recovery.notifyChanged(session);
      this.#syncSessionBindings(session);
      this.#pluginDocuments.emit('change', session);
      this.#refreshDiffForSession(session);
      this.#renderSessionState(
        'error' === recovery?.kind
          ? `Disk reloaded, but recovery cleanup failed: ${recovery.message}`
          : 'Disk reloaded · previous editor buffer discarded',
      );
    } catch (error) {
      this.#renderSessionState(`Reload error: ${messageFrom(error)}`);
    } finally {
      this.#setBusy(false);
    }
  }

  public async keepConflictRecovery(): Promise<void> {
    if (this.#busy || !this.#currentSession?.state.conflict) { return; }
    const session = this.#currentSession;
    this.#setBusy(true, 'Writing recovery copy…');
    try {
      const outcome = await this.#recovery.flush(session, 'manual');
      if ('persisted' === outcome.kind) {
        this.#renderSessionState('Recovery copy updated · conflict remains unresolved');
      } else if ('superseded' === outcome.kind) {
        this.#renderSessionState('Buffer changed during recovery write · write recovery again');
      } else if ('error' === outcome.kind) {
        this.#renderSessionState(`Recovery error: ${outcome.message}`);
      } else {
        this.#renderSessionState('No recovery copy was required');
      }
    } catch (error) {
      this.#renderSessionState(`Recovery error: ${messageFrom(error)}`);
    } finally {
      this.#setBusy(false);
    }
  }

  public toggleDiff(paneId: PaneId = this.#panes.state.activePane): void {
    if (this.#busy) { return; }
    const session = this.#panes.state[paneId].session;
    if (!session) { return; }
    this.#activatePane(paneId);
    const view = this.#diffForPane(paneId);
    if (view.isOpen) {
      this.#closeDiff(paneId);
      this.#renderSessionState('Diff closed · editor view restored');
      return;
    }
    const state = session.state;
    if (state.conflict) {
      this.#renderSessionState('Diff unavailable while the document has a conflict');
      return;
    }
    if ('saving' === state.saveState.kind) {
      this.#renderSessionState('Diff unavailable while the document is saving');
      return;
    }
    if ('error' === state.saveState.kind) {
      this.#renderSessionState('Diff unavailable while the document has a save error');
      return;
    }
    this.#capturePaneView(paneId);
    this.#editorHostForPane(paneId).hidden = true;
    view.open(session);
    this.#renderSessionState('Read-only diff · saved snapshot vs current buffer');
  }

  public closeSecondaryPane(): void {
    if (this.#busy || !this.#panes.state.secondaryVisible) { return; }
    this.#closeDiff('secondary', false);
    this.#capturePaneView('secondary');
    this.#disposePaneBinding('secondary');
    if (this.#secondaryEditor) {
      this.#codeMirrorDocuments.detach('secondary', this.#secondaryEditor);
    }
    const closed = this.#panes.closeSecondary();
    this.#saveLayoutPreference();
    if (closed?.released) { this.#untrackSession(closed.session); }
    const primary = this.#panes.state.primary.session;
    this.#currentSession = primary;
    if (primary) { this.#pathInput.value = primary.state.path; }
    this.#renderSessionState('Split closed');
  }

  public dispose(): void {
    if (this.#disposed) { return; }
    this.#disposed = true;
    this.#window.removeEventListener('blur', this.#onWindowBlur);
    this.#window.removeEventListener('resize', this.#onWindowResize);
    void this.#closeSubscription?.dispose();
    this.#closeSubscription = null;
    void this.#updaterHandshakeSubscription?.dispose();
    this.#updaterHandshakeSubscription = null;
    void this.#watchSubscription?.dispose();
    this.#watchSubscription = null;
    this.#sessionBinding?.dispose();
    this.#sessionBinding = null;
    this.#secondarySessionBinding?.dispose();
    this.#secondarySessionBinding = null;
    this.#editorSaveBinding?.dispose();
    this.#editorSaveBinding = null;
    this.#editorPluginBinding?.dispose();
    this.#editorPluginBinding = null;
    this.#secondaryEditorSaveBinding?.dispose();
    this.#secondaryEditorSaveBinding = null;
    this.#secondaryEditorPluginBinding?.dispose();
    this.#secondaryEditorPluginBinding = null;
    this.#diffView.dispose();
    this.#secondaryDiffView.dispose();
    void this.#pluginRuntime.deactivateAll().catch(() => {});
    this.#pluginCommands.dispose();
    this.#pluginViews.dispose();
    this.#pluginAssets.dispose();
    this.#pluginWorkspace.dispose();
    this.#pluginEditor.dispose();
    this.#pluginExtensions.dispose();
    this.#pluginHeaders.dispose();
    this.#codeMirrorDocuments.dispose();
    this.#editor?.dispose();
    this.#editor = null;
    this.#secondaryEditor?.dispose();
    this.#secondaryEditor = null;
    for (const tracked of this.#trackedSessions.values()) { tracked.dispose(); }
    this.#trackedSessions.clear();
    this.#recovery.dispose();
    this.#panes.dispose();
  }

  async #installBundledPlugins(): Promise<void> {
    try {
      const catalog = await this.#bundledPluginCatalogLoader();
      if (this.#disposed) { return; }
      const results = await this.#pluginRuntime.activateBundledCatalog(catalog);
      if (this.#disposed) {
        await this.#pluginRuntime.deactivateAll();
        return;
      }
      const disabled = results.filter((result) => 'disabled' === result.kind).length;
      this.#root.dataset.plugins = 0 === disabled ? 'ready' : `disabled:${disabled}`;
      this.#pluginHeaders.renderAll();
    } catch {
      if (!this.#disposed) { this.#root.dataset.plugins = 'catalog-error'; }
    }
  }

  async #installWindowLifecycle(): Promise<void> {
    if (this.#lifecycleRegistrationStarted) { return; }
    this.#lifecycleRegistrationStarted = true;
    try {
      const subscription = await this.#windowLifecycle.onCloseRequested(
        (event) => this.#handleCloseRequested(event),
      );
      if (this.#disposed) {
        await subscription.dispose();
        return;
      }
      this.#closeSubscription = subscription;
    } catch (error) {
      if (!this.#disposed) {
        this.#runtimeStatus.textContent = `Close protection error: ${messageFrom(error)}`;
      }
    }
  }

  async #installUpdaterHandshake(): Promise<void> {
    if (this.#updaterHandshakeRegistrationStarted) { return; }
    this.#updaterHandshakeRegistrationStarted = true;
    try {
      const subscription = await installUpdaterRestartHandshake(
        this.#bridge,
        () => this.prepareForRestart(),
      );
      if (this.#disposed) {
        await subscription.dispose();
        return;
      }
      this.#updaterHandshakeSubscription = subscription;
    } catch (error) {
      if (!this.#disposed) {
        this.#runtimeStatus.textContent =
          `Updater restart protection unavailable: ${messageFrom(error)}`;
      }
    }
  }

  async #handleCloseRequested(event: WindowCloseRequest): Promise<void> {
    event.preventDefault();
    if (this.#disposed || this.#closing) { return; }
    this.#closing = true;
    this.#setBusy(true, 'Preparing recovery before close…');
    try {
      const result = await this.prepareForRestart();
      if ('blocked' === result.kind) {
        this.#runtimeStatus.textContent =
          `Close blocked: ${result.reasons.map((reason) => this.#describeRestartBlocker(reason)).join('; ')}`;
        return;
      }
      await this.#windowLifecycle.destroy();
      this.dispose();
    } catch (error) {
      this.#runtimeStatus.textContent = `Close blocked: ${messageFrom(error)}`;
    } finally {
      this.#closing = false;
      if (!this.#disposed) { this.#setBusy(false); }
    }
  }

  #describeRestartBlocker(reason: RestartBlockReason): string {
    const session = [...this.#trackedSessions.keys()].find(
      (candidate) => candidate.state.pathKey === reason.pathKey,
    );
    const path = session?.state.path ?? 'unknown document';
    switch (reason.kind) {
      case 'conflict': return `${path} has an unresolved conflict`;
      case 'save-in-progress': return `${path} is still saving`;
      case 'save-error': return `${path} has a save error: ${reason.message}`;
      case 'recovery-error': return `${path} has a recovery error: ${reason.message}`;
      case 'recovery-not-current': return `${path} recovery is not current`;
    }
  }

  async #refreshFilesWhileBusy(): Promise<void> {
    const files = decodeWorkspaceFiles(
      await this.#bridge.invoke<unknown>('workspace_list_files', {}),
    );
    this.#replaceFileOptions(files);
    this.#runtimeStatus.textContent = `${files.length} Markdown document${1 === files.length ? '' : 's'}`;
  }

  #replaceFileOptions(files: readonly ListedWorkspaceFile[]): void {
    const placeholder = element(this.#document, 'option', { text: 'Choose a Markdown file…' });
    placeholder.value = '';
    const options = files.map(({ path }) => {
      const option = element(this.#document, 'option', { text: path });
      option.value = path;
      return option;
    });
    this.#fileSelect.replaceChildren(placeholder, ...options);
  }

  #ensureEditor(paneId: PaneId): CodeMirrorTextEditor {
    if ('primary' === paneId) {
      if (this.#editor) { return this.#editor; }
      const textarea = element(this.#document, 'textarea', { id: 'v2-editor-textarea' });
      textarea.setAttribute('aria-label', 'Primary Markdown editor');
      this.#editorHost.replaceChildren(textarea);
      this.#editor = new CodeMirrorTextEditor(textarea, {
        onOpenWikiLink: (target) => { void this.#openWikiLink('primary', target); },
        onInsertMedia: (input) => this.#insertMedia('primary', input),
        resolveMedia: (path) => this.#pluginAssets.resolveMedia(path),
        onDiagnostic: (message) => { this.#documentStatus.textContent = message; },
      });
      this.#editorPluginBinding = this.#pluginEditor.attach(this.#editor);
      this.#editorSaveBinding = this.#editor.bindSave(() => {
        this.#activatePane('primary');
        void this.saveDocument();
      });
      return this.#editor;
    }
    if (this.#secondaryEditor) { return this.#secondaryEditor; }
    const textarea = element(this.#document, 'textarea', {
      id: 'v2-secondary-editor-textarea',
    });
    textarea.setAttribute('aria-label', 'Secondary Markdown editor');
    this.#secondaryEditorHost.replaceChildren(textarea);
    this.#secondaryEditor = new CodeMirrorTextEditor(textarea, {
      onOpenWikiLink: (target) => { void this.#openWikiLink('secondary', target); },
      onInsertMedia: (input) => this.#insertMedia('secondary', input),
      resolveMedia: (path) => this.#pluginAssets.resolveMedia(path),
      onDiagnostic: (message) => { this.#secondaryDocumentStatus.textContent = message; },
    });
    this.#secondaryEditorPluginBinding = this.#pluginEditor.attach(this.#secondaryEditor);
    this.#secondaryEditorSaveBinding = this.#secondaryEditor.bindSave(() => {
      this.#activatePane('secondary');
      void this.saveDocument();
    });
    return this.#secondaryEditor;
  }

  #trackSession(session: DocumentSession): void {
    if (this.#trackedSessions.has(session)) { return; }
    const recovery = this.#recovery.track(session);
    const nativeWatch = trackNativeDocument(this.#workspaceAdapter, session);
    this.#trackedSessions.set(session, {
      dispose: async () => {
        recovery.dispose();
        await nativeWatch.dispose();
      },
    });
  }

  #untrackSession(session: DocumentSession | null): void {
    if (!session) { return; }
    this.#trackedSessions.get(session)?.dispose();
    this.#trackedSessions.delete(session);
    this.#codeMirrorDocuments.release(session);
  }

  #bindSession(
    paneId: PaneId,
    session: DocumentSession,
    message: string,
    focus = true,
  ): void {
    this.#closeDiff(paneId, false);
    this.#currentSession = session;
    this.#pathInput.value = session.state.path;
    const editor = this.#ensureEditor(paneId);
    this.#disposePaneBinding(paneId);
    this.#codeMirrorDocuments.attach(paneId, editor, session);
    const binding = new SessionEditorBinding(session, editor, {
      onEdited: (edited) => {
        void this.#recovery.notifyChanged(edited).catch((error: unknown) => {
          this.#statusForPane(paneId).textContent = `Recovery error: ${messageFrom(error)}`;
        });
        this.#syncSessionBindings(edited);
        this.#pluginDocuments.emit('change', edited);
        this.#refreshDiffForSession(edited);
        this.#renderSessionState();
      },
      onReadOnlyEdit: (error) => {
        this.#statusForPane(paneId).textContent = error.message;
      },
    });
    if ('primary' === paneId) {
      this.#sessionBinding = binding;
    } else {
      this.#secondarySessionBinding = binding;
    }
    editor.restoreView(this.#panes.state[paneId].view);
    if (focus) { editor.focus(); }
    this.#pluginDocuments.emit('open', session);
    this.#renderSessionState(message);
  }

  #disposePaneBinding(paneId: PaneId): void {
    if ('primary' === paneId) {
      this.#sessionBinding?.dispose();
      this.#sessionBinding = null;
      return;
    }
    this.#secondarySessionBinding?.dispose();
    this.#secondarySessionBinding = null;
  }

  #capturePaneView(paneId: PaneId): void {
    const state = this.#panes.state[paneId];
    const editor = 'primary' === paneId ? this.#editor : this.#secondaryEditor;
    if (!state.session || !editor) { return; }
    this.#panes.updateView(paneId, editor.captureView());
  }

  #syncSessionBindings(session: DocumentSession): void {
    if (this.#sessionBinding?.session === session) { this.#sessionBinding.syncFromSession(); }
    if (this.#secondarySessionBinding?.session === session) {
      this.#secondarySessionBinding.syncFromSession();
    }
  }

  #diffForPane(paneId: PaneId): DesktopDiffView {
    return 'primary' === paneId ? this.#diffView : this.#secondaryDiffView;
  }

  #editorHostForPane(paneId: PaneId): HTMLElement {
    return 'primary' === paneId ? this.#editorHost : this.#secondaryEditorHost;
  }

  #closeDiff(paneId: PaneId, restoreView = true): void {
    const view = this.#diffForPane(paneId);
    if (!view.isOpen) { return; }
    view.close();
    this.#editorHostForPane(paneId).hidden = false;
    if (!restoreView) { return; }
    const editor = 'primary' === paneId ? this.#editor : this.#secondaryEditor;
    if (editor) { editor.restoreView(this.#panes.state[paneId].view); }
  }

  #refreshDiffForSession(session: DocumentSession): void {
    for (const paneId of ['primary', 'secondary'] as const) {
      const view = this.#diffForPane(paneId);
      if (view.isOpen && view.session === session) { view.refresh(session); }
    }
  }

  #closeDiffForSession(session: DocumentSession): void {
    for (const paneId of ['primary', 'secondary'] as const) {
      const view = this.#diffForPane(paneId);
      if (view.isOpen && view.session === session) { this.#closeDiff(paneId); }
    }
  }

  #activeEditor(): CodeMirrorTextEditor | null {
    return 'primary' === this.#panes.state.activePane ? this.#editor : this.#secondaryEditor;
  }

  #activeDocumentStatus(): HTMLParagraphElement {
    return this.#statusForPane(this.#panes.state.activePane);
  }

  #statusForPane(paneId: PaneId): HTMLParagraphElement {
    return 'primary' === paneId ? this.#documentStatus : this.#secondaryDocumentStatus;
  }

  #activatePane(paneId: PaneId): void {
    const session = this.#panes.state[paneId].session;
    if (
      'secondary' === paneId &&
      (!this.#panes.state.secondaryAvailable || !this.#panes.state.secondaryVisible)
    ) { return; }
    const previousPane = this.#panes.state.activePane;
    if (previousPane !== paneId) { this.#capturePaneView(previousPane); }
    this.#panes.activate(paneId);
    this.#currentSession = session;
    if (session) { this.#pathInput.value = session.state.path; }
    if (session) { this.#pluginDocuments.emit('activatePane', session); }
    this.#saveLayoutPreference();
    this.#renderSessionState();
  }

  #loadLayoutPreference(): ReturnType<DesktopLayoutPreferenceStore['load']> {
    try {
      return this.#layoutPreferenceStore.load();
    } catch {
      return null;
    }
  }

  #saveLayoutPreference(): void {
    try {
      this.#layoutPreferenceStore.save(this.#panes.layoutPreference);
    } catch {
      // Injected stores follow the same optional, fail-closed contract as localStorage.
    }
  }

  #syncSecondaryAvailability(): void {
    const width = this.#window.innerWidth;
    const available = !Number.isFinite(width) || 670 < width;
    const wasActive = this.#panes.state.activePane;
    if (!available && 'secondary' === wasActive) { this.#capturePaneView('secondary'); }
    if (!available) { this.#closeDiff('secondary', false); }
    this.#panes.setSecondaryAvailable(available);
    const activePane = this.#panes.state.activePane;
    this.#currentSession = this.#panes.state[activePane].session;
    if (this.#currentSession) { this.#pathInput.value = this.#currentSession.state.path; }
    if (this.#currentSession && wasActive !== activePane) {
      this.#pluginDocuments.emit('activatePane', this.#currentSession);
    }
    this.#renderSessionState();
  }

  #renderRecoveryPrompt(): void {
    const loaded = this.#pendingRecovery[0];
    this.#recoveryPanel.hidden = !loaded;
    if (!loaded) {
      this.#recoveryText.textContent = '';
      return;
    }
    const remaining = this.#pendingRecovery.length;
    const captured = new Date(loaded.record.capturedAt).toLocaleString();
    this.#recoveryText.textContent =
      `Unsaved recovery for ${loaded.record.path} (${loaded.generation}, ${captured}). ` +
      `${remaining} unresolved cop${1 === remaining ? 'y' : 'ies'} in this workspace.`;
  }

  #handleWorkspaceRefresh(refresh: WorkspaceWatchRefresh): void {
    const paneState = this.#panes.state;
    const isAttached =
      paneState.primary.session === refresh.session || paneState.secondary.session === refresh.session;
    if (!isAttached) { return; }
    if ('reloaded' === refresh.outcome.kind) {
      this.#syncSessionBindings(refresh.session);
      this.#pluginDocuments.emit('change', refresh.session);
    }
    if ('conflict' === refresh.outcome.kind || 'missing' === refresh.outcome.kind) {
      this.#closeDiffForSession(refresh.session);
    } else if ('reloaded' === refresh.outcome.kind) {
      this.#refreshDiffForSession(refresh.session);
    }
    this.#renderSessionState(
      refresh.session !== this.#currentSession
        ? undefined
        : 'reloaded' === refresh.outcome.kind
        ? 'Reloaded external change'
        : 'conflict' === refresh.outcome.kind || 'missing' === refresh.outcome.kind
          ? 'External change requires attention'
          : undefined,
    );
  }

  #renderSessionState(message?: string): void {
    const panes = this.#panes.state;
    this.#secondaryPane.hidden = !panes.secondaryVisible;
    this.#panesHost.dataset.split = String(panes.secondaryVisible);
    this.#root.dataset.activePane = panes.activePane;
    this.#primaryPane.dataset.active = String('primary' === panes.activePane);
    this.#secondaryPane.dataset.active = String('secondary' === panes.activePane);
    this.#renderPaneState('primary', 'primary' === panes.activePane ? message : undefined);
    this.#renderPaneState('secondary', 'secondary' === panes.activePane ? message : undefined);

    const session = panes[panes.activePane].session;
    this.#currentSession = session;
    this.#pluginDocuments.setActive(session);
    if (session) { this.#pathInput.value = session.state.path; }
    const state = session?.state;
    this.#root.dataset.dirty = String(state?.dirty ?? false);
    this.#root.dataset.conflict = state?.conflict?.kind ?? 'none';
    this.#conflictPanel.hidden = !state?.conflict;
    if (state?.conflict) {
      this.#conflictText.textContent = 'missing' === state.conflict.kind
        ? 'The document is missing on disk. Saving to the old path is disabled.'
        : 'The document changed on disk. Saving is disabled until the conflict is resolved.';
    } else {
      this.#conflictText.textContent = '';
    }
    this.#pluginHeaders.renderAll();
  }

  #renderPaneState(paneId: PaneId, message?: string): void {
    const session = this.#panes.state[paneId].session;
    const title = 'primary' === paneId ? this.#documentTitle : this.#secondaryDocumentTitle;
    const status = this.#statusForPane(paneId);
    const saveButton = 'primary' === paneId ? this.#saveButton : this.#secondarySaveButton;
    const diffButton = 'primary' === paneId ? this.#diffButton : this.#secondaryDiffButton;
    const diffView = this.#diffForPane(paneId);
    if (!session) {
      title.textContent = 'No document open';
      status.textContent = 'primary' === paneId
        ? 'Choose a workspace-relative Markdown path.'
        : 'Open a document in split view.';
      saveButton.disabled = true;
      diffButton.disabled = true;
      diffButton.textContent = 'Diff';
      return;
    }
    const state = session.state;
    title.textContent = `${state.path}${state.dirty ? ' *' : ''}`;
    saveButton.disabled = this.#busy || !state.dirty || null !== state.conflict;
    diffButton.textContent = diffView.isOpen ? 'Close diff' : 'Diff';
    diffButton.disabled = this.#busy || (
      !diffView.isOpen &&
      (null !== state.conflict || 'idle' !== state.saveState.kind)
    );
    if (message) {
      status.textContent = message;
      return;
    }
    if (diffView.isOpen) {
      status.textContent = 'Read-only diff · saved snapshot vs current buffer';
      return;
    }
    if ('read-only' === state.savedSnapshot.access.kind) {
      status.textContent = state.savedSnapshot.access.message;
    } else if (state.conflict) {
      status.textContent = 'External change conflict · saving is disabled';
    } else if ('error' === state.saveState.kind) {
      status.textContent = `Save error: ${state.saveState.message}`;
    } else if ('error' === state.recoveryState.kind) {
      status.textContent = `Recovery error: ${state.recoveryState.message}`;
    } else if (state.dirty) {
      status.textContent = 'Unsaved changes · recovery pending';
    } else {
      status.textContent = 'Saved';
    }
  }

  #setBusy(busy: boolean, message?: string): void {
    this.#busy = busy;
    this.#openButton.disabled = busy;
    this.#splitButton.disabled = busy;
    this.#restoreRecoveryButton.disabled = busy;
    this.#laterRecoveryButton.disabled = busy;
    this.#discardRecoveryButton.disabled = busy;
    this.#reloadConflictButton.disabled = busy;
    this.#keepConflictRecoveryButton.disabled = busy;
    this.#continueConflictButton.disabled = busy;
    this.#closeSecondaryButton.disabled = busy;
    if (message) { this.#runtimeStatus.textContent = message; }
    const primary = this.#panes.state.primary.session?.state;
    const secondary = this.#panes.state.secondary.session?.state;
    this.#saveButton.disabled = busy || !primary || !primary.dirty || null !== primary.conflict;
    this.#secondarySaveButton.disabled =
      busy || !secondary || !secondary.dirty || null !== secondary.conflict;
    this.#diffButton.disabled = busy || !primary || (
      !this.#diffView.isOpen && (null !== primary.conflict || 'idle' !== primary.saveState.kind)
    );
    this.#secondaryDiffButton.disabled = busy || !secondary || (
      !this.#secondaryDiffView.isOpen &&
      (null !== secondary.conflict || 'idle' !== secondary.saveState.kind)
    );
  }
}
