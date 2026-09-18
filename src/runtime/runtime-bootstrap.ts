import { migrateV0_0_5LocalStorage } from './storage-migration.js';
import type { StorageMigrationHost } from './storage-migration.js';

export type RuntimeMode = 'legacy' | 'v2';
export type RuntimeModeSource = 'environment' | 'appConfig' | 'default' | 'failSafe';

export interface RuntimeModeResolution {
  readonly mode: RuntimeMode;
  readonly source: RuntimeModeSource;
  readonly diagnostic?: string;
}

interface BrowserStorage {
  getItem(key: string): string | null;
}

interface RuntimeLoaders {
  activateLegacy(): Promise<void>;
  activateV2(): Promise<void>;
}

interface TauriCoreBridge {
  invoke<T>(command: string, args?: Record<string, unknown>): Promise<T>;
}

export const LEGACY_SCRIPT_PATHS = Object.freeze([
  'lib/latex/katex.min.js',
  'lib/sidebar.js',
  'lib/codemirror.js',
  'lib/core.js',
  'lib/markdown.js',
  'lib/hypermd.js',
  'lib/keymap.js',
  'lib/click.js',
  'lib/hide-token.js',
  'lib/fold.js',
  'lib/fold-image.js',
  'lib/fold-link.js',
  'lib/fold-code.js',
  'lib/latex/fold-math.js',
  'lib/hypermd-mermaid.js',
  'lib/table-align.js',
  'lib/autocomplete-link.js',
  'lib/show-hint.js',
  'lib/autoscroll.js',
  'lib/codemirror-go.js',
  'lib/codemirror-python.js',
  'lib/codemirror-javascript.js',
  'lib/codemirror-php.js',
  'lib/codemirror-shell.js',
  'lib/similarity.js',
  'lib/emoji.js',
  'config.js',
  'desktop-shell.js',
  'desktop-settings.js',
  'tauri-fs.js',
  'lib/fs.js',
  'lib/md.js',
  'welcome.js',
  'files.js',
  'reading-parse.js',
  'reading.js',
  'templates.js',
  'plugins/kanban/default-seeds.js',
  'project-structure.js',
  'search.js',
  'workspace-config.js',
  'plugins/chat-archive.js',
  'chat.js',
  'plugins.js',
  'vcs-repo.js',
  'vcs-menu.js',
  'vcs-dirty.js',
  'editor.js',
  'app.js',
  'modals.js',
  'legacy-bootstrap.js',
] as const);

export const V2_EDITOR_SCRIPT_PATHS = Object.freeze([
  'lib/codemirror.js',
  'lib/markdown.js',
] as const);

export const V2_STYLE_PATH = 'v2.css';

const RUNTIME_STORAGE_KEY = `${__APP_NAME__}:runtime-mode`;

function failSafe(diagnostic: string): RuntimeModeResolution {
  return { mode: 'legacy', source: 'failSafe', diagnostic };
}

function isRuntimeMode(value: unknown): value is RuntimeMode {
  return 'legacy' === value || 'v2' === value;
}

function isRuntimeModeSource(value: unknown): value is RuntimeModeSource {
  return (
    'environment' === value ||
    'appConfig' === value ||
    'default' === value ||
    'failSafe' === value
  );
}

export function parseRuntimeResolution(value: unknown): RuntimeModeResolution | null {
  if (!value || 'object' !== typeof value) { return null; }
  const record = value as Record<string, unknown>;
  if (!isRuntimeMode(record.mode) || !isRuntimeModeSource(record.source)) { return null; }
  const diagnostic = record.diagnostic;
  if (undefined !== diagnostic && 'string' !== typeof diagnostic) { return null; }
  if ('string' === typeof diagnostic) {
    return { mode: record.mode, source: record.source, diagnostic };
  }
  return { mode: record.mode, source: record.source };
}

export function resolveBrowserRuntimeMode(storage: BrowserStorage): RuntimeModeResolution {
  let encoded: string | null;
  try {
    encoded = storage.getItem(RUNTIME_STORAGE_KEY);
  } catch {
    return failSafe('Browser runtime setting is unavailable; using legacy');
  }
  if (null === encoded) { return { mode: 'legacy', source: 'default' }; }

  try {
    const parsed = JSON.parse(encoded) as Record<string, unknown>;
    if (1 !== parsed.schemaVersion || !isRuntimeMode(parsed.mode)) {
      return failSafe('Browser runtime setting is invalid; using legacy');
    }
    return { mode: parsed.mode, source: 'appConfig' };
  } catch {
    return failSafe('Browser runtime setting is invalid; using legacy');
  }
}

function tauriCoreBridge(): TauriCoreBridge | null {
  const candidate = (window as Window & {
    __TAURI__?: { core?: Partial<TauriCoreBridge> };
  }).__TAURI__?.core;
  return candidate && 'function' === typeof candidate.invoke
    ? candidate as TauriCoreBridge
    : null;
}

export async function resolveRuntimeMode(): Promise<RuntimeModeResolution> {
  const bridge = tauriCoreBridge();
  if (!bridge) {
    try {
      return resolveBrowserRuntimeMode(window.localStorage);
    } catch {
      return failSafe('Browser runtime setting is unavailable; using legacy');
    }
  }

  try {
    const result = parseRuntimeResolution(await bridge.invoke<unknown>('runtime_get_mode'));
    return result ?? failSafe('Desktop runtime setting response is invalid; using legacy');
  } catch {
    return failSafe('Desktop runtime setting could not be read; using legacy');
  }
}

export function applyV2StorageMigration(
  resolution: RuntimeModeResolution,
  storage: StorageMigrationHost,
): RuntimeModeResolution {
  if ('v2' !== resolution.mode) { return resolution; }
  const migration = migrateV0_0_5LocalStorage(storage);
  if ('complete' === migration.kind) { return resolution; }
  return failSafe(
    `V2 local storage migration could not complete (${migration.reason}); using legacy`,
  );
}

export async function activateRuntime(
  resolution: RuntimeModeResolution,
  loaders: RuntimeLoaders,
): Promise<void> {
  if ('v2' === resolution.mode) {
    await loaders.activateV2();
    return;
  }
  await loaders.activateLegacy();
}

function versioned(path: string): string {
  return `${path}${window.COMMIT_HASH ?? ''}`;
}

async function loadClassicScript(path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = versioned(path);
    script.async = false;
    script.addEventListener('load', () => resolve(), { once: true });
    script.addEventListener('error', () => reject(new Error(`Failed to load ${path}`)), {
      once: true,
    });
    document.head.append(script);
  });
}

async function loadStyleSheet(path: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = versioned(path);
    link.addEventListener('load', () => resolve(), { once: true });
    link.addEventListener('error', () => reject(new Error(`Failed to load ${path}`)), {
      once: true,
    });
    document.head.append(link);
  });
}

async function activateLegacy(): Promise<void> {
  for (const path of LEGACY_SCRIPT_PATHS) {
    await loadClassicScript(path);
  }
}

async function activateV2(): Promise<void> {
  await loadStyleSheet(V2_STYLE_PATH);
  for (const path of V2_EDITOR_SCRIPT_PATHS) {
    await loadClassicScript(path);
  }
  const entry = tauriCoreBridge() ? 'v2/desktop.js' : 'v2/web.js';
  await import(versioned(entry));
}

function renderStartupFailure(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  const panel = document.createElement('main');
  panel.id = 'runtime-startup-error';
  panel.setAttribute('role', 'alert');
  const title = document.createElement('h1');
  title.textContent = `${__APP_NAME__} could not start`;
  const detail = document.createElement('p');
  detail.textContent = `${message}. Restart with the runtime environment override set to legacy to recover.`;
  panel.append(title, detail);
  document.body.replaceChildren(panel);
}

export async function startRuntime(): Promise<void> {
  const selectedResolution = await resolveRuntimeMode();
  let resolution = selectedResolution;
  if ('v2' === selectedResolution.mode) {
    try {
      resolution = applyV2StorageMigration(selectedResolution, window.localStorage);
    } catch {
      resolution = failSafe('V2 local storage migration is unavailable; using legacy');
    }
  }
  window.__APP_RUNTIME__ = Object.freeze({ ...resolution });
  document.documentElement.dataset.runtimeMode = resolution.mode;
  document.documentElement.dataset.runtimeSource = resolution.source;
  if (resolution.diagnostic) { console.warn(resolution.diagnostic); }

  try {
    await activateRuntime(resolution, { activateLegacy, activateV2 });
  } catch (error) {
    console.error('Runtime startup failed', error);
    renderStartupFailure(error);
  }
}

if ('undefined' !== typeof window && 'undefined' !== typeof document) {
  void startRuntime();
}
