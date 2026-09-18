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
mkdirSync('web/v2', { recursive: true });
mkdirSync('web/v2/plugins', { recursive: true });
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
  ['src/desktop/settings.ts', 'web/desktop-settings.js'],
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
  ['src/runtime/legacy-bootstrap.ts', 'web/legacy-bootstrap.js'],
];

async function buildOne(entry, outfile) {
  return esbuild.build({
    ...shared,
    entryPoints: [entry],
    outfile,
  });
}

const bundledEntries = [
  {
    entryPoints: ['src/runtime/runtime-bootstrap.ts'],
    outfile: 'web/runtime-bootstrap.js',
    bundle: true,
    format: 'iife',
    target: ['es2020'],
    define: shared.define,
  },
  {
    entryPoints: ['apps/desktop/src/index.ts'],
    outfile: 'web/v2/desktop.js',
    bundle: true,
    format: 'esm',
    target: ['es2022'],
  },
  {
    entryPoints: ['apps/desktop/src/diff-worker.ts'],
    outfile: 'web/v2/diff-worker.js',
    bundle: true,
    format: 'esm',
    target: ['es2022'],
  },
  {
    entryPoints: ['apps/web/src/index.ts'],
    outfile: 'web/v2/web.js',
    bundle: true,
    format: 'esm',
    target: ['es2022'],
  },
].map((options) => ({
  platform: 'browser',
  banner: { js: banner },
  logLevel: 'info',
  ...options,
}));

const officialPluginSpecs = [
  {
    source: 'plugins/official/docs/src/index.ts',
    manifest: 'plugins/official/docs/plugin.json',
    outfile: 'web/v2/plugins/docs.js',
    entry: 'docs.js',
  },
  {
    source: 'plugins/official/search/src/index.ts',
    manifest: 'plugins/official/search/plugin.json',
    outfile: 'web/v2/plugins/search.js',
    entry: 'search.js',
  },
  {
    source: 'plugins/official/templates/src/index.ts',
    manifest: 'plugins/official/templates/plugin.json',
    outfile: 'web/v2/plugins/templates.js',
    entry: 'templates.js',
  },
  {
    source: 'plugins/official/chat/src/index.ts',
    manifest: 'plugins/official/chat/plugin.json',
    outfile: 'web/v2/plugins/chat.js',
    entry: 'chat.js',
  },
  {
    source: 'plugins/official/extended-markdown/src/index.ts',
    manifest: 'plugins/official/extended-markdown/plugin.json',
    outfile: 'web/v2/plugins/extended-markdown.js',
    entry: 'extended-markdown.js',
  },
  {
    source: 'plugins/official/media/src/index.ts',
    manifest: 'plugins/official/media/plugin.json',
    outfile: 'web/v2/plugins/media.js',
    entry: 'media.js',
  },
  {
    source: 'plugins/official/kanban/src/index.ts',
    manifest: 'plugins/official/kanban/plugin.json',
    outfile: 'web/v2/plugins/kanban.js',
    entry: 'kanban.js',
  },
  {
    source: 'plugins/official/vcs/src/index.ts',
    manifest: 'plugins/official/vcs/plugin.json',
    outfile: 'web/v2/plugins/vcs.js',
    entry: 'vcs.js',
  },
];

const officialPluginBuildState = new Map();
let refreshGeneratedLaunchers = () => {};

const knownPluginPermissions = new Set([
  'commands',
  'documents.editActive',
  'documents.readActive',
  'editor.extensions',
  'extensions.consume',
  'extensions.register',
  'navigation.openMarkdown',
  'process.vcs',
  'storage.workspace',
  'ui.documentHeader',
  'ui.views',
  'workspace.readMarkdown',
  'workspace.readText',
  'workspace.modifyMarkdown',
  'workspace.modifyText',
  'workspace.writeMedia',
  'workspace.writeTextBatch',
  'workspace.writeMarkdown',
  'workspace.watchMarkdown',
]);

function readOfficialPluginManifest(spec) {
  const manifest = JSON.parse(readFileSync(spec.manifest, 'utf8'));
  const documentHeaders = manifest.contributes?.documentHeaders;
  const commands = manifest.contributes?.commands;
  const views = manifest.contributes?.views;
  if (
    1 !== manifest.schemaVersion ||
    'string' !== typeof manifest.id ||
    !/^[a-z0-9](?:[a-z0-9._-]*[a-z0-9])?$/u.test(manifest.id) ||
    'string' !== typeof manifest.name ||
    '' === manifest.name.trim() ||
    'string' !== typeof manifest.version ||
    '' === manifest.version.trim() ||
    spec.entry !== manifest.entry ||
    !Array.isArray(manifest.permissions) ||
    manifest.permissions.some((permission) => !knownPluginPermissions.has(permission)) ||
    new Set(manifest.permissions).size !== manifest.permissions.length ||
    (manifest.permissions.includes('documents.editActive') &&
      !manifest.permissions.includes('documents.readActive')) ||
    (manifest.permissions.includes('workspace.modifyMarkdown') &&
      !manifest.permissions.includes('workspace.readMarkdown')) ||
    (manifest.permissions.includes('workspace.modifyText') &&
      !manifest.permissions.includes('workspace.readText')) ||
    (undefined !== documentHeaders && (
      !Array.isArray(documentHeaders) ||
      documentHeaders.some((header) =>
        !header ||
        'object' !== typeof header ||
        'string' !== typeof header.id ||
        'string' !== typeof header.title ||
        '' === header.title.trim()
      )
    )) ||
    (Array.isArray(documentHeaders) &&
      0 < documentHeaders.length &&
      !manifest.permissions.includes('ui.documentHeader')) ||
    (undefined !== commands && (
      !Array.isArray(commands) ||
      commands.some((command) =>
        !command ||
        'object' !== typeof command ||
        'string' !== typeof command.id ||
        'string' !== typeof command.title ||
        '' === command.title.trim() ||
        (undefined !== command.defaultKeybindings && (
          !Array.isArray(command.defaultKeybindings) ||
          command.defaultKeybindings.some((keybinding) =>
            'string' !== typeof keybinding ||
            !/^(?:(?:Mod|Ctrl|Meta|Alt|Shift)\+)+(?:[A-Z0-9]|Enter|Escape)$/u.test(keybinding)
          )
        ))
      ) ||
      new Set(commands.map((command) => command.id)).size !== commands.length
    )) ||
    (Array.isArray(commands) && 0 < commands.length && !manifest.permissions.includes('commands')) ||
    (undefined !== views && (
      !Array.isArray(views) ||
      views.some((view) =>
        !view ||
        'object' !== typeof view ||
        'string' !== typeof view.id ||
        'string' !== typeof view.title ||
        '' === view.title.trim() ||
        !['sidebar', 'secondary-pane', 'editor-pane'].includes(view.location)
      ) ||
      new Set(views.map((view) => view.id)).size !== views.length
    )) ||
    (Array.isArray(views) && 0 < views.length && !manifest.permissions.includes('ui.views'))
  ) {
    throw new Error(`Invalid official plugin manifest: ${spec.manifest}`);
  }
  return manifest;
}

function writeOfficialPluginCatalog() {
  const catalog = officialPluginSpecs.map((spec) => officialPluginBuildState.get(spec.source));
  if (catalog.some((entry) => undefined === entry)) { return false; }
  const catalogEntries = catalog.map(({ manifest, entry, contentHash }) => `  Object.freeze({\n` +
    `    manifest: Object.freeze(${JSON.stringify(manifest)}),\n` +
    `    entry: ${JSON.stringify(entry)},\n` +
    `    contentHash: ${JSON.stringify(contentHash)},\n` +
    `    load: () => import(${JSON.stringify(`./plugins/${entry}`)}),\n` +
    '  })');
  writeFileSync(
    'web/v2/bundled-plugin-catalog.js',
    `${banner}export const bundledPluginCatalog = Object.freeze([\n` +
      `${catalogEntries.join(',\n')}\n]);\n`,
  );
  return true;
}

function emitOfficialPluginBuild(spec, result) {
  const manifest = readOfficialPluginManifest(spec);
  const output = result.outputFiles?.[0];
  if (!output) { throw new Error(`Official plugin produced no output: ${manifest.id}`); }
  const contentHash = `sha256:${createHash('sha256').update(output.contents).digest('hex')}`;
  writeFileSync(
    spec.outfile,
    `${output.text}\nexport const pluginContentHash=${JSON.stringify(contentHash)};\n`,
  );
  officialPluginBuildState.set(spec.source, { manifest, entry: spec.entry, contentHash });
  return writeOfficialPluginCatalog();
}

function officialPluginBuildOptions(spec, onWatchBuild) {
  return {
    entryPoints: [spec.source],
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['es2022'],
    write: false,
    banner: { js: banner },
    logLevel: 'info',
    ...(onWatchBuild
      ? {
          plugins: [{
            name: `mdular-official-plugin-${spec.entry}`,
            setup(build) {
              build.onEnd(async (result) => {
                if (0 < result.errors.length) { return; }
                const catalogReady = emitOfficialPluginBuild(spec, result);
                if (catalogReady) {
                  refreshGeneratedLaunchers();
                  console.log(`Official plugin rebuilt: ${spec.entry}`);
                }
              });
            },
          }],
        }
      : {}),
  };
}

async function buildOfficialPlugins() {
  officialPluginBuildState.clear();
  for (const spec of officialPluginSpecs) {
    const result = await esbuild.build(officialPluginBuildOptions(spec));
    emitOfficialPluginBuild(spec, result);
  }
}

if (watch) {
  const contexts = await Promise.all(
    [
      ...entries.map(([entry, outfile]) => ({
        ...shared,
        entryPoints: [entry],
        outfile,
      })),
      ...bundledEntries,
      ...officialPluginSpecs.map((spec) => officialPluginBuildOptions(spec, true)),
    ].map((options) => esbuild.context(options))
  );
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log('Watching src/ …');
} else {
  await Promise.all([
    ...entries.map(([entry, outfile]) => buildOne(entry, outfile)),
    ...bundledEntries.map((options) => esbuild.build(options)),
  ]);
  await buildOfficialPlugins();
}

for (const id of ['docs', 'kanban']) {
  copyFileSync(`src/plugins/${id}/scripts.json`, `web/plugins/${id}/scripts.json`);
}
copyFileSync('src/v2.css', 'web/v2.css');

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

const indexPath = 'web/index.html';
refreshGeneratedLaunchers = () => {
  const buildStamp = createBuildStamp();
  writeFileSync(
    'web/build-stamp.js',
    `${banner}window.COMMIT_HASH='?v=${buildStamp}';\n`
  );

  let indexHtml = readFileSync('src/index.html', 'utf8');
  indexHtml = indexHtml.replace(/\?v=[^"']*/g, `?v=${buildStamp}`);
  writeFileSync(indexPath, indexHtml);
  console.log('Build stamp:', buildStamp);
};

refreshGeneratedLaunchers();
