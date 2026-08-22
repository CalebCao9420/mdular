import * as esbuild from 'esbuild';
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { relative, resolve } from 'node:path';

import { loadAppMetadata } from './app-metadata.mjs';

const watch = process.argv.includes('--watch');
const banner = '// Generated from src/ — edit TypeScript and run: npm run build\n';
const appMetadata = loadAppMetadata();

mkdirSync('web', { recursive: true });
mkdirSync('web/plugins/kanban', { recursive: true });
mkdirSync('web/plugins/docs', { recursive: true });

const shared = {
  bundle: false,
  platform: 'browser',
  target: ['es2020'],
  banner: { js: banner },
  define: {
    __APP_NAME__: JSON.stringify(appMetadata.name),
    __APP_WORKSPACE_CONFIG_PATH__: JSON.stringify(appMetadata.webWorkspaceConfigPath),
  },
  logLevel: 'info',
};

/** Transpile-only: preserves classic multi-script global scope in the browser. */
const entries = [
  ['src/config.ts', 'web/config.js'],
  ['src/welcome/index.ts', 'web/welcome.js'],
  ['src/files/index.ts', 'web/files.js'],
  ['src/reading/parse.ts', 'web/reading-parse.js'],
  ['src/reading/ui.ts', 'web/reading.js'],
  ['src/templates/index.ts', 'web/templates.js'],
  ['src/templates/project-structure.ts', 'web/project-structure.js'],
  ['src/plugins/kanban/default-seeds.ts', 'web/plugins/kanban/default-seeds.js'],
  ['src/search/index.ts', 'web/search.js'],
  ['src/workspace/config.ts', 'web/workspace-config.js'],
  ['src/plugins/chat-archive.ts', 'web/plugins/chat-archive.js'],
  ['src/plugins/api.ts', 'web/plugins.js'],
  ['src/plugins/docs/chat-archive.ts', 'web/plugins/docs/chat-archive.js'],
  ['src/plugins/docs/index.ts', 'web/plugins/docs/index.js'],
  ['src/vcs/repo.ts', 'web/vcs-repo.js'],
  ['src/vcs/menu.ts', 'web/vcs-menu.js'],
  ['src/vcs/dirty.ts', 'web/vcs-dirty.js'],
  ['src/desktop/shell.ts', 'web/desktop-shell.js'],
  ['src/desktop/tauri-fs.ts', 'web/tauri-fs.js'],
  ['src/plugins/kanban/ticket-statuses.ts', 'web/plugins/kanban/ticket-statuses.js'],
  ['src/plugins/kanban/board-columns.ts', 'web/plugins/kanban/board-columns.js'],
  ['src/plugins/kanban/frontmatter.ts', 'web/plugins/kanban/frontmatter.js'],
  ['src/plugins/kanban/chat-archive.ts', 'web/plugins/kanban/chat-archive.js'],
  ['src/plugins/kanban/board.ts', 'web/plugins/kanban/board.js'],
  ['src/plugins/kanban/index.ts', 'web/plugins/kanban/index.js'],
  ['src/editor/index.ts', 'web/editor.js'],
  ['src/app/index.ts', 'web/app.js'],
  ['src/chat/index.ts', 'web/chat.js'],
  ['src/modals/index.ts', 'web/modals.js'],
];

async function buildOne(entry, outfile) {
  return esbuild.build({
    ...shared,
    entryPoints: [entry],
    outfile,
  });
}

if (watch) {
  const contexts = await Promise.all(
    entries.map(([entry, outfile]) =>
      esbuild.context({ ...shared, entryPoints: [entry], outfile })
    )
  );
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('Watching src/ …');
} else {
  await Promise.all(entries.map(([entry, outfile]) => buildOne(entry, outfile)));
}

for (const id of ['docs', 'kanban']) {
  copyFileSync(`src/plugins/${id}/scripts.json`, `web/plugins/${id}/scripts.json`);
}

function collectAssetPaths(directoryPath, results) {
  const entries = readdirSync(directoryPath, { withFileTypes: true }).sort((left, right) =>
    left.name.localeCompare(right.name)
  );
  for (const entry of entries) {
    if ('.launcher-hint.json' === entry.name || entry.isSymbolicLink()) { continue; }
    const entryPath = resolve(directoryPath, entry.name);
    if (entry.isDirectory()) {
      collectAssetPaths(entryPath, results);
    } else if (
      entry.isFile() &&
      'build-stamp.js' !== entry.name &&
      'index.html' !== entry.name
    ) {
      results.push(entryPath);
    }
  }
}

function createBuildStamp() {
  const webRoot = resolve('web');
  const assetPaths = [];
  collectAssetPaths(webRoot, assetPaths);
  const hash = createHash('sha256');
  for (const assetPath of assetPaths) {
    hash.update(relative(webRoot, assetPath).replaceAll('\\', '/'));
    hash.update('\0');
    hash.update(readFileSync(assetPath));
    hash.update('\0');
  }
  return hash.digest('hex').slice(0, 12);
}

const buildStamp = createBuildStamp();
writeFileSync(
  'web/build-stamp.js',
  `${banner}window.COMMIT_HASH='?v=${buildStamp}';\n`
);

const indexPath = 'web/index.html';
let indexHtml = readFileSync(indexPath, 'utf8');
indexHtml = indexHtml.replace(/\?v=[^"']*/g, `?v=${buildStamp}`);
writeFileSync(indexPath, indexHtml);

console.log('Build stamp:', buildStamp);
