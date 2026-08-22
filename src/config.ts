// Application metadata is injected from app.manifest.json by scripts/build.mjs.

const APP_NAME = __APP_NAME__;
const WORKSPACE_CONFIG_PATH = __APP_WORKSPACE_CONFIG_PATH__;
const APP_PORT = 8765;
const STORAGE_SCHEMA_VERSION = 1;

const LEGACY_STORAGE_KEYS = ['server', 'lastServerOk', 'apiUrl'] as const;

function appStorageKey(key: string): string {
  return `${APP_NAME}:${key}`;
}

function migrateLegacyStorage(): void {
  const versionKey = appStorageKey('storage-schema-version');
  if (localStorage.getItem(versionKey) === String(STORAGE_SCHEMA_VERSION)) {
    return;
  }
  for (const key of LEGACY_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
  localStorage.setItem(versionKey, String(STORAGE_SCHEMA_VERSION));
  log('Migrated localStorage (removed legacy sync keys)');
}

function getAppHelpIntro(): string {
  return (
    `# ${APP_NAME}\n\n` +
    'Local-first markdown workspace. Your notes stay as plain `.md` files on disk.\n\n' +
    '## First steps\n\n' +
    '1. Click **Open folder** and choose your notes or project docs directory.\n\n' +
    '2. Check **Allow on every visit** (Chrome/Edge) so the app can save files.\n\n' +
    '3. Press **Ctrl+Enter** to open **Chat** — quick capture for ideas and tasks.\n\n' +
    `4. Optional: install as PWA from the browser menu (*Install ${APP_NAME}*).\n\n` +
    `5. Optional plugins: add \`${WORKSPACE_CONFIG_PATH}\` in your workspace (see below).\n\n` +
    'Without a bound folder, data may live in browser storage only (not recommended).\n\n' +
    '## Plugins\n\n' +
    `Enable plugins with \`${WORKSPACE_CONFIG_PATH}\`:\n\n` +
    '```json\n{\n  "plugins": ["docs", "kanban"]\n}\n```\n\n' +
    '### Kanban (`issues/`)\n\n' +
    '- **Ctrl+Shift+B** — open the ticket board\n' +
    '- Toolbar: scaffold project docs, board/list toggle, column & status settings\n' +
    '- Filter by assignee, tag, or priority; save named filter presets\n' +
    '- **Chat archive**: **To Issues** (ticket frontmatter + status) or **To Docs** (plain doc in `docs/`)\n' +
    '- Config files: `issues/ticket-statuses.json`, `issues/ticket-board.json`\n\n'
  );
}

Object.assign(globalThis, {
  APP_NAME,
  WORKSPACE_CONFIG_PATH,
  APP_PORT,
  STORAGE_SCHEMA_VERSION,
  appStorageKey,
  migrateLegacyStorage,
  getAppHelpIntro,
});
