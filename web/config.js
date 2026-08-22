// Generated from src/ — edit TypeScript and run: npm run build

const APP_NAME = "mdular";
const WORKSPACE_CONFIG_PATH = "/.mdular/config.json";
const APP_PORT = 8765;
const STORAGE_SCHEMA_VERSION = 1;
const LEGACY_STORAGE_KEYS = ["server", "lastServerOk", "apiUrl"];
function appStorageKey(key) {
  return `${APP_NAME}:${key}`;
}
function migrateLegacyStorage() {
  const versionKey = appStorageKey("storage-schema-version");
  if (localStorage.getItem(versionKey) === String(STORAGE_SCHEMA_VERSION)) {
    return;
  }
  for (const key of LEGACY_STORAGE_KEYS) {
    localStorage.removeItem(key);
  }
  localStorage.setItem(versionKey, String(STORAGE_SCHEMA_VERSION));
  log("Migrated localStorage (removed legacy sync keys)");
}
function getAppHelpIntro() {
  return `# ${APP_NAME}

Local-first markdown workspace. Your notes stay as plain \`.md\` files on disk.

## First steps

1. Click **Open folder** and choose your notes or project docs directory.

2. Check **Allow on every visit** (Chrome/Edge) so the app can save files.

3. Press **Ctrl+Enter** to open **Chat** \u2014 quick capture for ideas and tasks.

4. Optional: install as PWA from the browser menu (*Install ${APP_NAME}*).

5. Optional plugins: add \`${WORKSPACE_CONFIG_PATH}\` in your workspace (see below).

Without a bound folder, data may live in browser storage only (not recommended).

## Plugins

Enable plugins with \`${WORKSPACE_CONFIG_PATH}\`:

\`\`\`json
{
  "plugins": ["docs", "kanban"]
}
\`\`\`

### Kanban (\`issues/\`)

- **Ctrl+Shift+B** \u2014 open the ticket board
- Toolbar: scaffold project docs, board/list toggle, column & status settings
- Filter by assignee, tag, or priority; save named filter presets
- **Chat archive**: **To Issues** (ticket frontmatter + status) or **To Docs** (plain doc in \`docs/\`)
- Config files: \`issues/ticket-statuses.json\`, \`issues/ticket-board.json\`

`;
}
Object.assign(globalThis, {
  APP_NAME,
  WORKSPACE_CONFIG_PATH,
  APP_PORT,
  STORAGE_SCHEMA_VERSION,
  appStorageKey,
  migrateLegacyStorage,
  getAppHelpIntro
});
