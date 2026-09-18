import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { build } from 'esbuild';

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const expectedLegacyScriptOrder = [
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
];

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

function canonicalDom(source) {
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/giu, '')
    .replace(/\?v=[A-Za-z0-9_*-]+/gu, '?v=*')
    .replace(/\s+/gu, ' ')
    .trim();
}

let runtimeModulePromise;
async function runtimeModule() {
  runtimeModulePromise ??= build({
    entryPoints: [resolve(projectRoot, 'src/runtime/runtime-bootstrap.ts')],
    absWorkingDir: projectRoot,
    bundle: true,
    define: { __APP_NAME__: JSON.stringify('mdular') },
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
  }).then((result) => {
    const source = result.outputFiles[0].text;
    return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  });
  return runtimeModulePromise;
}

function storageWith(value) {
  return { getItem: () => value };
}

function mutableStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, value); },
  };
}

async function renderAppShell(relativePath) {
  const result = await build({
    entryPoints: [resolve(projectRoot, relativePath)],
    absWorkingDir: projectRoot,
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2022',
    write: false,
  });
  const body = {
    children: [],
    replaceChildren(...children) { this.children = children; },
  };
  const document = {
    title: 'mdular',
    body,
    createElement(tagName) {
      return {
        tagName,
        id: '',
        className: '',
        dataset: {},
        attributes: {},
        children: [],
        textContent: '',
        value: '',
        disabled: false,
        setAttribute(name, value) { this.attributes[name] = value; },
        addEventListener() {},
        append(...children) { this.children.push(...children); },
        replaceChildren(...children) { this.children = children; },
      };
    },
  };
  const window = {
    addEventListener() {},
    removeEventListener() {},
    setTimeout,
    clearTimeout,
  };
  vm.runInNewContext(result.outputFiles[0].text, { document, window, setTimeout, clearTimeout });
  return body.children[0];
}

function findElementById(root, id) {
  if (root.id === id) { return root; }
  for (const child of root.children ?? []) {
    const found = findElementById(child, id);
    if (found) { return found; }
  }
  return null;
}

async function runLegacyBootstrap() {
  const result = await build({
    entryPoints: [resolve(projectRoot, 'src/runtime/legacy-bootstrap.ts')],
    absWorkingDir: projectRoot,
    bundle: false,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    write: false,
  });
  const events = [];
  const editors = [{ id: 'primary' }, { id: 'secondary' }];
  const context = {
    COMMIT_HASH: '?v=fixture',
    __TAURI__: {},
    currentEditor: null,
    document: {
      getElementById(id) {
        events.push(`element:${id}`);
        return { id };
      },
    },
    editor: null,
    editor2: null,
    getProjectScaffoldModal() { events.push('project-scaffold'); },
    init() { events.push('app'); },
    initEditor() {
      const editor = editors.shift();
      events.push(`editor:${editor.id}`);
      return editor;
    },
    initNewFileTemplates() { events.push('templates'); },
    initReading() { events.push('reading'); },
    log() { events.push('log'); },
    logError() { events.push('log-error'); },
    navigator: {},
  };
  context.window = context;
  vm.runInNewContext(result.outputFiles[0].text, context);
  return { context, events };
}

test('source HTML preserves the v0.0.5 DOM while routing before business scripts', () => {
  const source = readProjectFile('src/index.html');
  const digest = createHash('sha256').update(canonicalDom(source)).digest('hex');
  assert.equal(digest, 'd401c45dcdf2560b33d30e2d2d5c6e7484bdaf2e948ef519d3dc4a328f240aea');

  const initialScripts = Array.from(
    source.matchAll(/<script\b[^>]*\bsrc="([^"]+)"[^>]*><\/script>/gu),
    (match) => match[1],
  );
  assert.deepEqual(initialScripts, [
    'build-stamp.js?v=__BUILD_STAMP__',
    'runtime-bootstrap.js?v=__BUILD_STAMP__',
  ]);
});

test('desktop runtime mode uses a dedicated app-config command permission', () => {
  const rust = readProjectFile('src-tauri/src/lib.rs');
  const permission = readProjectFile('src-tauri/permissions/runtime-mode.toml');
  const workspacePermission = readProjectFile('src-tauri/permissions/workspace-io.toml');
  const capability = readProjectFile('src-tauri/capabilities/default.json');

  assert.match(rust, /const RUNTIME_MODE_SETTINGS_FILE: &str = "runtime-mode\.json"/u);
  assert.match(rust, /fn runtime_get_mode/u);
  assert.match(rust, /fn runtime_set_mode/u);
  assert.match(rust, /runtime_get_mode,[\s\S]*runtime_set_mode,/u);
  assert.match(permission, /identifier = "allow-runtime-mode"/u);
  assert.match(permission, /"runtime_get_mode"/u);
  assert.match(permission, /"runtime_set_mode"/u);
  assert.doesNotMatch(workspacePermission, /runtime_(?:get|set)_mode/u);
  assert.match(capability, /"allow-runtime-mode"/u);
});

test('generated HTML is a deterministic render of the source authority', () => {
  const source = readProjectFile('src/index.html');
  const generated = readProjectFile('web/index.html');
  const buildStampSource = readProjectFile('web/build-stamp.js');
  const match = buildStampSource.match(/window\.COMMIT_HASH='\?v=([^']+)'/u);
  assert.ok(match, 'generated build stamp must expose its revision');
  const expected = source.replace(/\?v=[^"']*/gu, `?v=${match[1]}`);
  assert.equal(generated, expected);
});

test('legacy loader preserves the exact v0.0.5 script order', async () => {
  const runtime = await runtimeModule();
  assert.deepEqual([...runtime.LEGACY_SCRIPT_PATHS], expectedLegacyScriptOrder);
  assert.deepEqual([...runtime.V2_EDITOR_SCRIPT_PATHS], [
    'lib/codemirror.js',
    'lib/markdown.js',
  ]);
  assert.equal(runtime.V2_STYLE_PATH, 'v2.css');
});

test('legacy bootstrap preserves the v0.0.5 initialization order', async () => {
  const { context, events } = await runLegacyBootstrap();
  assert.deepEqual(events, [
    'log',
    'element:editor-textarea',
    'editor:primary',
    'app',
    'reading',
    'templates',
    'project-scaffold',
    'element:editor2-textarea',
    'editor:secondary',
  ]);
  assert.equal(context.currentEditor, context.editor);
});

test('browser runtime setting defaults and fails safe to legacy', async () => {
  const runtime = await runtimeModule();

  assert.deepEqual(runtime.resolveBrowserRuntimeMode(storageWith(null)), {
    mode: 'legacy',
    source: 'default',
  });
  assert.deepEqual(
    runtime.resolveBrowserRuntimeMode(storageWith('{"schemaVersion":1,"mode":"v2"}')),
    { mode: 'v2', source: 'appConfig' },
  );
  assert.deepEqual(
    runtime.resolveBrowserRuntimeMode(storageWith('{"schemaVersion":2,"mode":"v2"}')),
    {
      mode: 'legacy',
      source: 'failSafe',
      diagnostic: 'Browser runtime setting is invalid; using legacy',
    },
  );
});

test('V2 local storage migration copies legacy preferences once and fails safe', async () => {
  const runtime = await runtimeModule();
  const selected = { mode: 'v2', source: 'appConfig' };
  const storage = mutableStorage({
    'mdular:default-template': 'Meeting',
    'mdular:kanban-filter': '{"status":"open"}',
    unrelated: 'keep',
  });

  assert.deepEqual(runtime.applyV2StorageMigration(selected, storage), selected);
  assert.equal(storage.values.get('mdular:default-template'), 'Meeting');
  assert.equal(storage.values.get('unrelated'), 'keep');
  assert.deepEqual(
    JSON.parse(storage.values.get(
      'mdular:v2:legacy-import:v1:mdular%3Adefault-template',
    )),
    {
      schemaVersion: 1,
      sourceKey: 'mdular:default-template',
      value: 'Meeting',
    },
  );
  const markerBefore = storage.values.get('mdular:v2:migration:v1');
  assert.deepEqual(JSON.parse(markerBefore), {
    schemaVersion: 1,
    migration: 'v0.0.5-to-v0.1.0',
    status: 'complete',
    importedKeys: ['mdular:default-template', 'mdular:kanban-filter'],
  });

  storage.values.set('mdular:default-template', 'Changed after migration');
  assert.deepEqual(runtime.applyV2StorageMigration(selected, storage), selected);
  assert.equal(storage.values.get('mdular:v2:migration:v1'), markerBefore);
  assert.equal(
    JSON.parse(storage.values.get(
      'mdular:v2:legacy-import:v1:mdular%3Adefault-template',
    )).value,
    'Meeting',
  );

  const denied = {
    getItem: (key) => key === 'mdular:v2:migration:v1' ? null : 'legacy value',
    setItem: () => { throw new Error('denied'); },
  };
  assert.deepEqual(runtime.applyV2StorageMigration(selected, denied), {
    mode: 'legacy',
    source: 'failSafe',
    diagnostic: 'V2 local storage migration could not complete (write); using legacy',
  });

  const invalidMarker = mutableStorage({ 'mdular:v2:migration:v1': '{}' });
  assert.deepEqual(runtime.applyV2StorageMigration(selected, invalidMarker), {
    mode: 'legacy',
    source: 'failSafe',
    diagnostic: 'V2 local storage migration could not complete (invalid-marker); using legacy',
  });
});

test('one runtime resolution activates exactly one application root', async () => {
  const runtime = await runtimeModule();
  const events = [];
  const loaders = {
    activateLegacy: async () => events.push('legacy'),
    activateV2: async () => events.push('v2'),
  };

  await runtime.activateRuntime({ mode: 'legacy', source: 'default' }, loaders);
  assert.deepEqual(events, ['legacy']);

  events.length = 0;
  await runtime.activateRuntime({ mode: 'v2', source: 'environment' }, loaders);
  assert.deepEqual(events, ['v2']);
});

test('V2 desktop mounts the primary document path while browser remains a preview shell', async () => {
  const desktop = await renderAppShell('apps/desktop/src/index.ts');
  assert.equal(desktop.id, 'v2-app-root');
  assert.equal(desktop.dataset.adapter, 'tauri');
  assert.equal(findElementById(desktop, 'v2-app-title').textContent, 'mdular V2');
  assert.ok(findElementById(desktop, 'v2-file-select'));
  assert.ok(findElementById(desktop, 'v2-document-path'));
  assert.ok(findElementById(desktop, 'v2-editor-textarea') === null);
  assert.equal(findElementById(desktop, 'v2-app-root').dataset.persistence, 'durable');

  const web = await renderAppShell('apps/web/src/index.ts');
  assert.equal(web.id, 'v2-app-root');
  assert.equal(web.dataset.adapter, 'browser-preview');
  assert.deepEqual(
    web.children.map((child) => child.textContent),
    [
      'mdular V2',
      'Runtime shell active · browser preview adapter selected',
      'Browser preview is a characterization fixture, not desktop parity.',
    ],
  );
});
