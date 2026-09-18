export { definePluginManifest } from '@mdular/plugin-manifest';

export type {
  PluginActivationEvent,
  PluginCommandContribution,
  PluginContributions,
  PluginDocumentHeaderContribution,
  PluginManifestV1,
  PluginPermission,
  PluginViewContribution,
} from '@mdular/plugin-manifest';

export type MaybePromise<T> = T | Promise<T>;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export interface Disposable {
  dispose(): MaybePromise<void>;
}

export interface SubscriptionCollection {
  add<TDisposable extends Disposable>(disposable: TDisposable): TDisposable;
}

export type PluginCommandHandler = (
  args: readonly JsonValue[],
) => MaybePromise<JsonValue | undefined>;

export interface PluginCommandService {
  register(commandId: string, handler: PluginCommandHandler): Disposable;
  execute(commandId: string, args?: readonly JsonValue[]): Promise<JsonValue | undefined>;
}

export type MarkdownWorkspaceChange =
  | { readonly path: string; readonly kind: 'created' | 'changed' | 'deleted' }
  | { readonly kind: 'reset' };

export interface MarkdownWorkspaceEntry {
  readonly path: string;
  readonly lastModifiedMs: number;
}

export interface MarkdownEditDraft {
  readonly editId: string;
  readonly path: string;
  readonly content: string;
}

export type MarkdownEditCommitResult =
  | { readonly status: 'written'; readonly path: string; readonly content: string }
  | { readonly status: 'conflict'; readonly current: MarkdownEditDraft };

export interface TextEditDraft {
  readonly editId: string;
  readonly path: string;
  readonly content: string;
}

export type TextEditCommitResult =
  | { readonly status: 'written'; readonly path: string; readonly content: string }
  | { readonly status: 'conflict'; readonly current: TextEditDraft };

export interface TextWriteOperation {
  readonly path: string;
  readonly content: string;
}

export type TextWriteConflictPolicy = 'fail-if-existing' | 'skip-existing';

export interface TextWritePlanEntry {
  readonly path: string;
  readonly bytes: number;
  readonly disposition: 'create' | 'skip' | 'conflict';
}

export interface TextWritePlan {
  readonly planId: string;
  readonly policy: TextWriteConflictPolicy;
  readonly entries: readonly TextWritePlanEntry[];
}

export interface TextWriteFailure {
  readonly index: number;
  readonly path: string;
  readonly kind: string;
  readonly message: string;
}

export type TextWriteCommitResult =
  | {
      readonly status: 'complete';
      readonly created: readonly string[];
      readonly skipped: readonly string[];
      readonly rollbackId?: string;
    }
  | {
      readonly status: 'partial';
      readonly created: readonly string[];
      readonly skipped: readonly string[];
      readonly failed: TextWriteFailure;
      readonly rollbackId?: string;
    };

export interface TextWriteRollbackFailure {
  readonly path: string;
  readonly kind: string;
  readonly message: string;
}

export interface TextWriteRollbackResult {
  readonly removed: readonly string[];
  readonly retained: readonly TextWriteRollbackFailure[];
}

/** All paths accepted or returned here are workspace-relative; native absolute paths are hidden. */
export interface PluginWorkspaceService {
  readonly readMarkdown?: (path: string) => Promise<string>;
  readonly readText?: (path: string) => Promise<string>;
  readonly writeMarkdown?: (path: string, text: string) => Promise<void>;
  readonly listMarkdown?: (directory?: string) => Promise<readonly string[]>;
  readonly listMarkdownEntries?: (
    directory?: string,
  ) => Promise<readonly MarkdownWorkspaceEntry[]>;
  readonly watchMarkdown?: (
    listener: (change: MarkdownWorkspaceChange) => void,
  ) => Disposable;
  readonly planTextWrites?: (
    operations: readonly TextWriteOperation[],
    policy: TextWriteConflictPolicy,
  ) => Promise<TextWritePlan>;
  readonly commitTextWritePlan?: (planId: string) => Promise<TextWriteCommitResult>;
  readonly rollbackTextWrites?: (rollbackId: string) => Promise<TextWriteRollbackResult>;
  readonly beginMarkdownEdit?: (path: string) => Promise<MarkdownEditDraft>;
  readonly commitMarkdownEdit?: (
    editId: string,
    content: string,
  ) => Promise<MarkdownEditCommitResult>;
  readonly beginTextEdit?: (path: string) => Promise<TextEditDraft>;
  readonly commitTextEdit?: (
    editId: string,
    content: string,
  ) => Promise<TextEditCommitResult>;
}

export interface OpenMarkdownOptions {
  readonly placement?: 'active-pane' | 'secondary-pane';
  readonly focus?: boolean;
}

export interface PluginNavigationService {
  openMarkdown(path: string, options?: OpenMarkdownOptions): Promise<void>;
}

export type PluginEditorFeature =
  | 'code-languages'
  | 'emoji'
  | 'math'
  | 'media'
  | 'mermaid'
  | 'tables'
  | 'wiki-links';

/** Declarative editor behavior; plugins never receive CodeMirror or editor DOM objects. */
export interface PluginEditorExtension {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly features: readonly PluginEditorFeature[];
}

export interface PluginEditorService {
  registerExtension(extension: PluginEditorExtension): Disposable;
}

export interface PluginViewAction {
  readonly type: string;
  readonly payload?: JsonValue;
}

export interface PluginTextHighlight {
  readonly start: number;
  readonly end: number;
}

export interface PluginCollectionItem {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly titleHighlights?: readonly PluginTextHighlight[];
  readonly descriptionHighlights?: readonly PluginTextHighlight[];
  readonly badges?: readonly string[];
  readonly selected?: boolean;
  readonly appearance?: 'default' | 'completed';
  readonly actions?: readonly PluginCollectionItemAction[];
  readonly image?: PluginWorkspaceImage;
}

export interface PluginWorkspaceImage {
  /** Workspace-relative image path. Raw URLs and absolute paths are never accepted. */
  readonly path: string;
  readonly alt: string;
  readonly presentation?: 'cover' | 'thumbnail' | 'content';
  readonly focusX?: number;
  readonly focusY?: number;
}

export interface PluginCollectionItemAction {
  readonly id: string;
  readonly label: string;
  readonly tone?: 'neutral' | 'primary' | 'danger';
  readonly disabled?: boolean;
}

export interface PluginCollectionInput {
  readonly value: string;
  readonly placeholder?: string;
  readonly ariaLabel?: string;
}

export interface PluginFormOption {
  readonly value: string;
  readonly label: string;
}

export type PluginFormField =
  | {
      readonly id: string;
      readonly kind: 'text' | 'textarea';
      readonly label: string;
      readonly value: string;
      readonly placeholder?: string;
      readonly description?: string;
      readonly rows?: number;
      readonly readOnly?: boolean;
      readonly submitActionId?: string;
    }
  | {
      readonly id: string;
      readonly kind: 'select';
      readonly label: string;
      readonly value: string;
      readonly description?: string;
      readonly options: readonly PluginFormOption[];
      readonly readOnly?: boolean;
    };

export interface PluginViewButton {
  readonly id: string;
  readonly label: string;
  readonly tone?: 'neutral' | 'primary' | 'danger';
  readonly disabled?: boolean;
}

export interface PluginBoardItem {
  readonly id: string;
  readonly title: string;
  readonly description?: string;
  readonly badges?: readonly string[];
  readonly appearance?: 'default' | 'completed';
  readonly draggable?: boolean;
  readonly fields?: readonly PluginFormField[];
  readonly actions?: readonly PluginCollectionItemAction[];
}

export interface PluginBoardColumn {
  readonly id: string;
  readonly title: string;
  readonly locked?: boolean;
  readonly items: readonly PluginBoardItem[];
}

/** Bounded declarative board UI; the host owns DOM, drag state and input handling. */
export interface PluginBoardViewState {
  readonly schemaVersion: 1;
  readonly kind: 'board';
  readonly title: string;
  readonly layout?: 'board' | 'list';
  readonly fields?: readonly PluginFormField[];
  readonly actions?: readonly PluginViewButton[];
  readonly status?: string;
  readonly busy?: boolean;
  readonly emptyMessage?: string;
  readonly columns: readonly PluginBoardColumn[];
}

/** Bounded declarative collection UI; the host owns DOM, focus and keyboard behavior. */
export interface PluginCollectionViewState {
  readonly schemaVersion: 1;
  readonly kind: 'collection';
  readonly title: string;
  readonly input?: PluginCollectionInput;
  readonly fields?: readonly PluginFormField[];
  readonly actions?: readonly PluginViewButton[];
  readonly status?: string;
  readonly busy?: boolean;
  readonly emptyMessage?: string;
  readonly dismissOnActivate?: boolean;
  readonly items: readonly PluginCollectionItem[];
}

export interface PluginReaderOutlineItem {
  readonly id: string;
  readonly label: string;
  readonly level: number;
}

export type PluginReaderBlock =
  | {
      readonly id: string;
      readonly kind: 'heading';
      readonly level: number;
      readonly text: string;
    }
  | {
      readonly id: string;
      readonly kind: 'paragraph' | 'quote' | 'code' | 'nested';
      readonly text: string;
      readonly language?: string;
    }
  | {
      readonly id: string;
      readonly kind: 'list';
      readonly items: readonly string[];
      readonly ordered?: boolean;
    }
  | {
      readonly id: string;
      readonly kind: 'image';
      readonly image: PluginWorkspaceImage;
      readonly caption?: string;
    };

/** Bounded, text-safe reading UI. The host owns rendering, assets and lightbox behavior. */
export interface PluginReaderViewState {
  readonly schemaVersion: 1;
  readonly kind: 'reader';
  readonly title: string;
  readonly sourcePath: string;
  readonly status?: string;
  readonly cover?: PluginWorkspaceImage;
  readonly outline: readonly PluginReaderOutlineItem[];
  readonly blocks: readonly PluginReaderBlock[];
  readonly actions?: readonly PluginViewButton[];
}

export type PluginViewState =
  | PluginBoardViewState
  | PluginCollectionViewState
  | PluginReaderViewState;

/** Declarative state/action bridge; plugins never receive a DOM element. */
export interface PluginViewService {
  setState(viewId: string, state: PluginViewState): void;
  onAction(
    viewId: string,
    listener: (action: PluginViewAction) => MaybePromise<void>,
  ): Disposable;
  reveal(viewId: string): Promise<void>;
  revealReaderBlock(viewId: string, blockId: string): void;
  hide(viewId: string): void;
}

export interface PluginDocumentSnapshot {
  readonly path: string;
  readonly content: string;
  readonly revision: string;
  readonly bufferVersion: number;
  readonly dirty: boolean;
}

export interface PluginDocumentSaveState {
  readonly path: string;
  readonly revision: string;
  readonly bufferVersion: number;
  readonly dirty: boolean;
}

export interface PluginActiveDocumentEdit {
  readonly path: string;
  readonly expectedBufferVersion: number;
  readonly content: string;
}

export type PluginActiveDocumentEditResult =
  | { readonly status: 'applied'; readonly snapshot: PluginDocumentSnapshot }
  | { readonly status: 'stale'; readonly current: PluginDocumentSnapshot | null }
  | { readonly status: 'read-only'; readonly message: string };

export type PluginDocumentListener = (
  snapshot: PluginDocumentSnapshot,
) => MaybePromise<void>;

export interface PluginDocumentsService {
  getActiveSnapshot(): PluginDocumentSnapshot | null;
  listOpenSaveStates(): readonly PluginDocumentSaveState[];
  readonly applyActiveEdit?: (
    edit: PluginActiveDocumentEdit,
  ) => Promise<PluginActiveDocumentEditResult>;
  onDidOpen(listener: PluginDocumentListener): Disposable;
  onDidChange(listener: PluginDocumentListener): Disposable;
  onDidSave(listener: PluginDocumentListener): Disposable;
  onDidActivatePane(listener: PluginDocumentListener): Disposable;
}

export type PluginVcsRepositoryKind = 'none' | 'git' | 'svn';

export interface PluginVcsStatusEntry {
  readonly path: string;
  readonly status: string;
  readonly indexStatus: string;
  readonly workingTreeStatus: string;
}

export interface PluginVcsStatusSnapshot {
  readonly kind: PluginVcsRepositoryKind;
  readonly branch?: string;
  readonly entries: readonly PluginVcsStatusEntry[];
  readonly truncated: boolean;
}

export type PluginVcsDiffSectionKind = 'working-tree' | 'staged';

export interface PluginVcsDiffSection {
  readonly kind: PluginVcsDiffSectionKind;
  readonly text: string;
  readonly truncated: boolean;
}

export interface PluginVcsDiffResult {
  readonly kind: Exclude<PluginVcsRepositoryKind, 'none'>;
  readonly path: string;
  readonly sections: readonly PluginVcsDiffSection[];
}

export type PluginVcsExternalClient =
  | 'default'
  | 'source-git'
  | 'tortoise-git'
  | 'explorer'
  | 'finder';

/** A closed VCS broker. Plugins cannot select executables, subcommands, arguments or cwd. */
export interface PluginVcsService {
  status(): Promise<PluginVcsStatusSnapshot>;
  diff(path: string): Promise<PluginVcsDiffResult>;
  openExternal(client: PluginVcsExternalClient): Promise<{ readonly client: PluginVcsExternalClient }>;
}

export type DocumentHeaderFieldKind = 'scalar' | 'nested' | 'complex' | 'empty';

export interface DocumentHeaderBadge {
  readonly label: string;
  readonly tone?: 'neutral' | 'info' | 'success' | 'warning';
}

export interface DocumentHeaderField {
  readonly key: string;
  readonly kind: DocumentHeaderFieldKind;
  readonly value?: string;
}

export interface DocumentHeaderViewModel {
  readonly title: string;
  readonly summary: string;
  readonly expanded: boolean;
  readonly badges?: readonly DocumentHeaderBadge[];
  readonly fields?: readonly DocumentHeaderField[];
  readonly toggleAction?: string;
}

export interface DocumentHeaderAction {
  readonly type: string;
}

export interface DocumentHeaderProvider {
  readonly id: string;
  provide(snapshot: PluginDocumentSnapshot): MaybePromise<DocumentHeaderViewModel | null>;
  onAction?(
    action: DocumentHeaderAction,
    snapshot: PluginDocumentSnapshot,
  ): MaybePromise<void>;
}

export interface PluginUiService {
  registerDocumentHeaderProvider(provider: DocumentHeaderProvider): Disposable;
}

export interface VersionedJsonValue {
  readonly schemaVersion: number;
  readonly value: JsonValue;
}

export type PluginStorageErrorKind =
  | 'invalid-key'
  | 'invalid-value'
  | 'serialization'
  | 'quota'
  | 'unavailable';

export interface PluginStorageError {
  readonly kind: PluginStorageErrorKind;
  readonly message: string;
}

export type PluginStorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: PluginStorageError };

export interface PluginStorageService {
  get(key: string): Promise<PluginStorageResult<VersionedJsonValue | null>>;
  set(key: string, value: VersionedJsonValue): Promise<PluginStorageResult<null>>;
  remove(key: string): Promise<PluginStorageResult<null>>;
}

export function documentStorageKey(path: string, localKey: string): string {
  if ('' === path || '' === localKey) {
    throw new Error('Document storage path and local key must not be empty');
  }
  return `document:${encodeURIComponent(path)}:${encodeURIComponent(localKey)}`;
}

export interface PluginLogger {
  debug(message: string, data?: JsonValue): void;
  info(message: string, data?: JsonValue): void;
  warn(message: string, data?: JsonValue): void;
  error(message: string, data?: JsonValue): void;
}

export interface PluginExtensionContribution {
  readonly id: string;
  readonly label: string;
  readonly order?: number;
  readonly data?: JsonValue;
  readonly execute?: (request: JsonValue) => MaybePromise<JsonValue | undefined>;
}

export interface PluginExtensionService {
  register(pointId: string, contribution: PluginExtensionContribution): Disposable;
  list(pointId: string): readonly PluginExtensionContribution[];
  onDidChange(pointId: string, listener: () => MaybePromise<void>): Disposable;
}

export const DOCUMENT_POLICY_EXTENSION_POINT = 'mdular.documents.policy';

export type DocumentPolicyCapability = 'metadata' | 'search';

function isJsonObject(value: JsonValue | undefined): value is { readonly [key: string]: JsonValue } {
  return null !== value && 'object' === typeof value && !Array.isArray(value);
}

/** Reads bounded, exact-path document exclusions from the shared policy extension point. */
export function excludedDocumentPaths(
  extensions: PluginExtensionService,
  capability: DocumentPolicyCapability,
): ReadonlySet<string> {
  const excluded = new Set<string>();
  for (const contribution of extensions.list(DOCUMENT_POLICY_EXTENSION_POINT)) {
    const data = contribution.data;
    if (
      !isJsonObject(data) ||
      1 !== data.schemaVersion ||
      'exclude' !== data[capability] ||
      !Array.isArray(data.paths) ||
      128 < data.paths.length
    ) { continue; }
    for (const value of data.paths) {
      if (
        'string' !== typeof value ||
        '' === value ||
        1024 < value.length ||
        value.startsWith('/') ||
        value.includes('\\') ||
        !value.toLocaleLowerCase('en-US').endsWith('.md')
      ) { continue; }
      const segments = value.split('/');
      if (segments.some((segment) => '' === segment || '.' === segment || '..' === segment)) {
        continue;
      }
      excluded.add(value.toLocaleLowerCase('en-US'));
    }
  }
  return excluded;
}

export interface PluginServices {
  readonly commands?: PluginCommandService;
  readonly documents?: PluginDocumentsService;
  readonly editor?: PluginEditorService;
  readonly extensions?: PluginExtensionService;
  readonly navigation?: PluginNavigationService;
  readonly vcs?: PluginVcsService;
  readonly storage?: PluginStorageService;
  readonly ui?: PluginUiService;
  readonly views?: PluginViewService;
  readonly workspace?: PluginWorkspaceService;
  readonly logger?: PluginLogger;
}

export interface PluginContext extends PluginServices {
  readonly pluginId: string;
  readonly subscriptions: SubscriptionCollection;
}

export interface PluginModule {
  activate(context: PluginContext): MaybePromise<void | Disposable>;
  deactivate?(): MaybePromise<void>;
}

export function definePlugin<const TPlugin extends PluginModule>(plugin: TPlugin): TPlugin {
  return plugin;
}
