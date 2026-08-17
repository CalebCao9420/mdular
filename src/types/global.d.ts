/** Ambient declarations for lib/*.js and cross-module globals used by typed src modules. */

type CodeMirrorEditor = any;

declare var editor: CodeMirrorEditor;
declare var editor2: CodeMirrorEditor;
declare var currentEditor: CodeMirrorEditor | null;

declare var files: Record<string, any>;
declare var isChat: boolean;
declare var isMemFS: boolean;
declare var isLoadingLocalFiles: boolean;

declare function log(...args: unknown[]): void;
declare function logError(...args: unknown[]): void;

declare function parseFrontmatter(text: string): {
  meta: Record<string, string> | null;
  body: string;
};

declare function parseHeadings(text: string): Array<{ level: number; text: string; line: number }>;

declare function openFile(path: string, pushHistory?: boolean, targetEl?: string): Promise<void>;
declare function openDir(): Promise<void>;
declare function openChat(): void;
declare function closeChatModal(): void;
declare function createAutocompleteDict(): Record<string, string>;
declare function bindEditorForReading(cm: CodeMirrorEditor): void;
declare function hideReadingPanel(): void;
declare function initAutoscroll(cm: CodeMirrorEditor): void;
declare function isMediaPath(path: string): boolean;
declare function getMemFile(path: string): any;
declare function addMemFile(path: string, memFile: Record<string, unknown>): void;
declare function walk(tree: Record<string, any>, fn: (path: string, isFile: boolean) => void | false): void;
declare function toFilename(path: string): string;
declare function writeMediaFile(fileName: string, file: File): Promise<any>;
declare function getImageExtension(mime: string): string;
declare function isMetaKey(e: MouseEvent | KeyboardEvent): boolean;

declare function write(path: string, content: string): Promise<void>;
declare function exists(path: string): Promise<boolean>;
declare function loadLocalFiles(handle: any, slowMode?: boolean): Promise<Record<string, any>>;
declare function createDir(dirPath: string): Promise<void>;
declare function showToast(msg: string): void;
declare function todayIsoDate(): string;
declare function writeAtEnd(path: string, content: string): Promise<void>;
declare function getFileHandle(path: string, create?: boolean): Promise<any>;
declare function getRootDirHandle(): Promise<any>;
declare function generateSafeFilename(name: string): string;
declare function sanitizeFilename(name: string): string;

declare function addHeaderAndText(
  path: string,
  header: string,
  text: string,
  atStart?: boolean,
  withTimestamp?: boolean
): Promise<void>;
declare function extractHeaderAndBody(text: string, maxTitleLen: number): [string, string];

declare function read(path: string): Promise<string>;
declare function similarity(a: string, b: string): number;
declare function excludeDirs(excluded: string[]): string[];
declare function walkFilesExcludingSystemDirs(fn: (path: string) => void): void;
declare function trimPostfix(str: string, postfix: string): string;
declare function trimPrefix(str: string, prefix: string): string;
declare function toDirPath(path: string): string;
declare function toRootDirName(path: string): string;
declare function joinPath(...parts: string[]): string;

declare const SYSTEM_DIRS: string[];
declare const CONFIG_PATH: string;
declare const CHAT_PATH: string;

declare function performFileSearch(raw: string): Promise<Array<{ path: string; score: number }>>;

declare function closeKanban(): void;
declare function openKanban(): Promise<void>;
declare function toggleKanban(): void;
declare function refreshKanban(): Promise<void>;

declare function registerPlugin(plugin: MdToolkitPlugin): void;
declare function initPlugins(): Promise<void>;
declare function closePluginViews(): void;
declare function handlePluginEscape(): boolean;
declare function handlePluginKeyboard(event: KeyboardEvent): boolean;

interface PluginManifest {
  id: string;
  name: string;
  version?: string;
}

interface PluginToolbarButton {
  id: string;
  title: string;
  ariaLabel?: string;
  html: string;
  onClick: (event: MouseEvent) => void;
}

interface PluginKeyboardShortcut {
  id: string;
  match: (event: KeyboardEvent) => boolean;
  handler: (event: KeyboardEvent) => void;
}

interface PluginViewController {
  id: string;
  isOpen: () => boolean;
  open: () => void | Promise<void>;
  close: () => void;
}

interface ChatArchiveTarget {
  id: string;
  label: string;
  html: string;
  order?: number;
  isAvailable?: () => boolean;
  archiveOne: (text: string) => Promise<string>;
}

declare function registerChatArchiveTarget(target: ChatArchiveTarget): void;
declare function getChatArchiveTargets(): ChatArchiveTarget[];
declare function getChatArchiveTarget(id: string): ChatArchiveTarget | undefined;
declare function archiveChatMessages(
  texts: string[],
  writeOne: (text: string) => Promise<string>
): Promise<string[]>;
declare function moveFromChat(text: string, callback: (text: string) => Promise<void>): Promise<void>;
declare function renderMessages(): Promise<void>;

declare function registerKanbanChatArchive(api: PluginAPI): void;
declare function kanbanDirExists(): boolean;

interface PluginAPI {
  registerToolbarButton(button: PluginToolbarButton): void;
  registerKeyboardShortcut(shortcut: PluginKeyboardShortcut): void;
  registerView(view: PluginViewController): void;
  registerChatArchiveTarget(target: ChatArchiveTarget): void;
  getMountEl(): HTMLElement;
  loadStylesheet(href: string): void;
  onEscape(handler: () => boolean): void;
}

interface MdToolkitPlugin {
  manifest: PluginManifest;
  init: (api: PluginAPI) => void | Promise<void>;
  destroy?: () => void;
}

declare function initKanbanPlugin(api: PluginAPI): void;
declare function getProjectScaffoldModal(): { armOutsideClickGuard(ms?: number): void; pick(): Promise<string | null> };

declare function initDesktopShell(): Promise<boolean>;
declare function getLauncherWorkspacePath(): string;
declare function getLauncherPlugins(): string[];
declare function isTauriHost(): boolean;
declare function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
declare function isTauriWorkspaceBound(): boolean;
declare function setTauriWorkspaceBound(bound: boolean): void;
declare function relativeToAppPath(relative: string): string;
interface TauriFileHandle {
  relativePath: string;
  getFile(): Promise<File>;
  createWritable(options?: { keepExistingData?: boolean }): Promise<{
    write(data: string | Blob | ArrayBuffer | Uint8Array): Promise<void>;
    seek(position: number): Promise<void>;
    close(): Promise<void>;
  }>;
  remove(): Promise<void>;
}
declare function tauriGetFileHandle(appPath: string, create?: boolean): Promise<TauriFileHandle>;
declare function tauriListWorkspaceFiles(): Promise<
  Array<{ relative_path: string; last_modified_ms: number }>
>;
declare function tauriCreateDir(appDirPath: string): Promise<void>;
declare function tauriRemoveDir(appDirPath: string): Promise<void>;
declare function tauriPathIsDir(relativePath: string): Promise<boolean>;
declare function removeWorkspaceHintBanner(): void;
declare function applyWorkspaceDirectory(dirHandle: FileSystemDirectoryHandle): Promise<void>;

declare function markPathDirty(path: string | undefined | null): void;
declare function markPathClean(path: string | undefined | null): void;
declare function getDirtyPaths(): string[];
declare function initVcsDirty(): void;
declare function syncDirtyFromEditor(): void;
declare function hookEditorDirty(cm: CodeMirrorEditor): void;

type VcsKind = 'git' | 'svn' | 'none';
declare function detectVcsRepo(): Promise<VcsKind>;
declare function getVcsKind(): VcsKind;
declare function isGitRepo(): boolean;
declare function detectGitRepo(): Promise<boolean>;

interface MdtkWorkspaceConfig {
  plugins?: string[];
  workspacePath?: string;
  vcs?: { prefer?: 'explorer' | 'sourcegit' | 'tortoisegit' };
}
declare function loadMdtkWorkspaceConfig(forceReload?: boolean): Promise<MdtkWorkspaceConfig>;
declare function getWorkspacePath(): string;

declare function initVcsMenu(): void;
declare function openVcsMenu(): void;
declare function closeVcsMenu(): void;

declare function normalizeWorkflowStatus(raw: string | undefined | null): string;
declare function getWorkflowStatus(id: string): TicketStatusDef | undefined;

interface TicketStatusDef {
  id: string;
  label: string;
}

declare var TICKET_STATUSES_PATH: string;
declare function loadTicketStatuses(forceReload?: boolean): Promise<unknown>;
declare function ensureTicketStatusesFile(): Promise<unknown>;
declare function writeTicketStatuses(config: unknown): Promise<void>;
declare function getTicketStatuses(): TicketStatusDef[];
declare function getTicketStatus(id: string): TicketStatusDef | undefined;
declare function getDefaultTicketStatusId(): string;
declare function normalizeTicketStatus(raw: string | undefined | null): string;
declare function isConfiguredTicketStatus(statusId: string): boolean;
declare function makeStatusId(label: string, existingIds: Set<string>): string;

interface BoardColumnDef {
  id: string;
  label: string;
  statusId: string | null;
  locked: boolean;
}

declare var TICKET_BOARD_PATH: string;
declare function loadBoardColumns(forceReload?: boolean): Promise<unknown>;
declare function ensureBoardColumnsFile(): Promise<unknown>;
declare function writeBoardColumns(config: unknown): Promise<void>;
declare function getBoardColumns(): BoardColumnDef[];
declare function getBoardColumn(id: string): BoardColumnDef | undefined;
declare function getBoardColumnForStatus(statusId: string): BoardColumnDef | undefined;
declare function isStatusAssociated(statusId: string): boolean;
declare function makeColumnId(label: string, existingIds: Set<string>): string;

declare function setFrontmatterField(content: string, key: string, value: string): string;
declare function removeFrontmatterField(content: string, key: string): string;
declare function buildTaskFrontmatter(title: string, statusId: string): string;
declare function refreshChatArchiveUi(): void;

declare function buildKanbanDefaultBoardConfig(): BoardColumnConfig;
declare function getKanbanTicketStatusesSeedJson(): string;
declare function getKanbanBoardSeedJson(): string;
declare function scaffoldProjectDocs(): Promise<void>;
declare function hideEditor2(): void;
declare function toHeader(filename: string): string;

declare function renderSidebar(focusDir?: string, modifiedPaths?: string[]): void;

declare const HyperMD: any;
declare const CodeMirror: any;
declare const CompleteEmoji: any;

declare interface Window {
  COMMIT_HASH: string;
  currentEditor: CodeMirrorEditor | null;
  katex: any;
  editor?: CodeMirrorEditor;
  editor2?: CodeMirrorEditor;
}
