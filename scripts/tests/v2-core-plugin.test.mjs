import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const packageEntries = {
  '@mdular/platform': resolve(projectRoot, 'packages/platform/src/index.ts'),
  '@mdular/core': resolve(projectRoot, 'packages/core/src/index.ts'),
  '@mdular/editor': resolve(projectRoot, 'packages/editor/src/index.ts'),
  '@mdular/desktop-workspace-adapter': resolve(
    projectRoot,
    'apps/desktop/src/workspace-adapter.ts',
  ),
  '@mdular/desktop-application': resolve(
    projectRoot,
    'apps/desktop/src/desktop-application.ts',
  ),
  '@mdular/desktop-diff-runner': resolve(projectRoot, 'apps/desktop/src/diff-runner.ts'),
  '@mdular/desktop-layout-preferences': resolve(
    projectRoot,
    'apps/desktop/src/layout-preferences.ts',
  ),
  '@mdular/desktop-plugin-documents': resolve(
    projectRoot,
    'apps/desktop/src/plugin-documents.ts',
  ),
  '@mdular/desktop-plugin-assets': resolve(
    projectRoot,
    'apps/desktop/src/plugin-assets.ts',
  ),
  '@mdular/desktop-plugin-extensions': resolve(
    projectRoot,
    'apps/desktop/src/plugin-extensions.ts',
  ),
  '@mdular/desktop-plugin-editor': resolve(
    projectRoot,
    'apps/desktop/src/plugin-editor.ts',
  ),
  '@mdular/desktop-editor-enhancements': resolve(
    projectRoot,
    'apps/desktop/src/editor-enhancements.ts',
  ),
  '@mdular/desktop-media-insert': resolve(
    projectRoot,
    'apps/desktop/src/media-insert.ts',
  ),
  '@mdular/desktop-plugin-commands': resolve(
    projectRoot,
    'apps/desktop/src/plugin-commands.ts',
  ),
  '@mdular/desktop-plugin-headers': resolve(
    projectRoot,
    'apps/desktop/src/plugin-headers.ts',
  ),
  '@mdular/desktop-plugin-host': resolve(projectRoot, 'apps/desktop/src/plugin-host.ts'),
  '@mdular/desktop-plugin-navigation': resolve(
    projectRoot,
    'apps/desktop/src/plugin-navigation.ts',
  ),
  '@mdular/desktop-plugin-storage': resolve(
    projectRoot,
    'apps/desktop/src/plugin-storage.ts',
  ),
  '@mdular/desktop-plugin-views': resolve(projectRoot, 'apps/desktop/src/plugin-views.ts'),
  '@mdular/desktop-plugin-workspace': resolve(
    projectRoot,
    'apps/desktop/src/plugin-workspace.ts',
  ),
  '@mdular/desktop-plugin-vcs': resolve(
    projectRoot,
    'apps/desktop/src/plugin-vcs.ts',
  ),
  '@mdular/tauri-desktop-bridge': resolve(projectRoot, 'apps/desktop/src/tauri-bridge.ts'),
  '@mdular/tauri-recovery-store': resolve(projectRoot, 'apps/desktop/src/recovery-store.ts'),
  '@mdular/desktop-updater-handshake': resolve(
    projectRoot,
    'apps/desktop/src/updater-handshake.ts',
  ),
  '@mdular/web-preview-adapter': resolve(projectRoot, 'apps/web/src/workspace-adapter.ts'),
  '@mdular/plugin-manifest': resolve(projectRoot, 'packages/plugin-manifest/src/index.ts'),
  '@mdular/plugin-sdk': resolve(projectRoot, 'packages/plugin-sdk/src/index.ts'),
  '@mdular/plugin-runtime': resolve(projectRoot, 'packages/plugin-runtime/src/index.ts'),
  '@mdular/plugin-docs': resolve(projectRoot, 'plugins/official/docs/src/index.ts'),
  '@mdular/plugin-search': resolve(projectRoot, 'plugins/official/search/src/index.ts'),
  '@mdular/plugin-templates': resolve(projectRoot, 'plugins/official/templates/src/index.ts'),
  '@mdular/plugin-chat': resolve(projectRoot, 'plugins/official/chat/src/index.ts'),
  '@mdular/plugin-extended-markdown': resolve(
    projectRoot,
    'plugins/official/extended-markdown/src/index.ts',
  ),
  '@mdular/plugin-media': resolve(projectRoot, 'plugins/official/media/src/index.ts'),
  '@mdular/plugin-kanban': resolve(projectRoot, 'plugins/official/kanban/src/index.ts'),
  '@mdular/plugin-vcs': resolve(projectRoot, 'plugins/official/vcs/src/index.ts'),
};

function createSnapshot(core, {
  path = 'notes/example.md',
  pathKey = 'workspace:notes/example.md',
  content = 'saved\n',
  revision = 'revision-1',
  access = { kind: 'read-write' },
} = {}) {
  return {
    path: core.workspacePath(path),
    pathKey: core.workspacePathKeyFromHost(pathKey),
    content,
    revision: core.opaqueRevisionFromHost(revision),
    byteHash: core.byteHashFromHost(`hash:${revision}`),
    format: { bom: 'none', mainEol: 'lf', trailingNewline: content.endsWith('\n') },
    access,
    capturedAt: 1,
  };
}

function createWireSnapshot({
  path = 'notes/example.md',
  pathKey = 'workspace:notes/example.md',
  content = 'saved\n',
  revision = 'revision-1',
  access = { kind: 'read-write' },
} = {}) {
  return {
    path,
    pathKey,
    content,
    revision,
    byteHash: `hash:${revision}`,
    format: { bom: 'none', mainEol: 'lf', trailingNewline: content.endsWith('\n') },
    access,
    capturedAt: 1,
  };
}

function createAdapter(write) {
  return {
    capabilities: {
      persistence: 'durable',
      atomicReplace: 'host-guaranteed',
      externalWatch: 'native-hints',
    },
    read: async () => ({ ok: false, error: { kind: 'not-found', message: 'fixture' } }),
    write,
    stat: async () => ({
      ok: false,
      error: { kind: 'not-found', message: 'fixture' },
    }),
    watch: () => ({ dispose() {} }),
  };
}

function createWatchedAdapter({ read, write }) {
  let watchListener = null;
  const adapter = {
    ...createAdapter(write),
    read,
    watch: (listener) => {
      watchListener = listener;
      return { dispose: () => { watchListener = null; } };
    },
  };
  return {
    adapter,
    emit(hint) {
      assert.ok(watchListener, 'workspace watch must be bound before emitting a hint');
      watchListener(hint);
    },
  };
}

class ManualRecoveryTime {
  nowValue = 0;
  nextId = 1;
  tasks = new Map();

  clock = {
    now: () => this.nowValue,
  };

  scheduler = {
    schedule: (delayMs, task) => {
      const token = { id: this.nextId };
      this.nextId += 1;
      this.tasks.set(token, { at: this.nowValue + delayMs, task });
      return token;
    },
    cancel: (token) => {
      this.tasks.delete(token);
    },
  };

  advance(milliseconds) {
    const target = this.nowValue + milliseconds;
    while (true) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0].id - right[0].id)[0];
      if (!due) { break; }
      this.tasks.delete(due[0]);
      this.nowValue = due[1].at;
      due[1].task();
    }
    this.nowValue = target;
  }
}

async function settleAsyncWork() {
  await new Promise((resolveTick) => setImmediate(resolveTick));
}

function createFakeElement(tagName) {
  const listeners = new Map();
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
    hidden: false,
    parentElement: null,
    setAttribute(name, value) { this.attributes[name] = value; },
    addEventListener(name, listener) {
      const registered = listeners.get(name) ?? [];
      registered.push(listener);
      listeners.set(name, registered);
    },
    removeEventListener(name, listener) {
      const registered = listeners.get(name) ?? [];
      listeners.set(name, registered.filter((candidate) => candidate !== listener));
    },
    append(...children) {
      for (const child of children) { child.parentElement = this; }
      this.children.push(...children);
    },
    replaceChildren(...children) {
      for (const child of this.children) { child.parentElement = null; }
      for (const child of children) { child.parentElement = this; }
      this.children = children;
    },
    remove() {
      if (!this.parentElement) { return; }
      this.parentElement.children = this.parentElement.children.filter((child) => child !== this);
      this.parentElement = null;
    },
    focus() {},
    scrollIntoView() {},
    dispatch(name, event = {}) {
      for (const listener of listeners.get(name) ?? []) { listener(event); }
    },
  };
}

function findFakeElement(root, id) {
  if (root.id === id) { return root; }
  for (const child of root.children ?? []) {
    const found = findFakeElement(child, id);
    if (found) { return found; }
  }
  return null;
}

function findFakeElementByClass(root, className) {
  if (root.className?.split(/\s+/u).includes(className)) { return root; }
  for (const child of root.children ?? []) {
    const found = findFakeElementByClass(child, className);
    if (found) { return found; }
  }
  return null;
}

function findFakeElementByTag(root, tagName) {
  if (root.tagName === tagName) { return root; }
  for (const child of root.children ?? []) {
    const found = findFakeElementByTag(child, tagName);
    if (found) { return found; }
  }
  return null;
}

function createFakeStorage() {
  const values = new Map();
  return {
    get length() { return values.size; },
    key(index) { return [...values.keys()][index] ?? null; },
    getItem(key) { return values.get(key) ?? null; },
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
    values,
  };
}

function createFakeCodeMirror() {
  const editors = [];

  class FakeDoc {
    constructor(value = '', modeOrSharedGroup = null) {
      const sharedGroup = modeOrSharedGroup && 'object' === typeof modeOrSharedGroup
        ? modeOrSharedGroup
        : null;
      this.group = sharedGroup ?? { value, documents: new Set() };
      this.group.documents.add(this);
      this.anchor = 0;
      this.head = 0;
      this.editor = null;
    }

    getValue() { return this.group.value; }

    linkedDoc() { return new FakeDoc('', this.group); }

    unlinkDoc(document) {
      if (document.group !== this.group) { return; }
      this.group.documents.delete(document);
      document.group = { value: this.group.value, documents: new Set([document]) };
    }

    setValue(next) {
      this.group.value = next;
      const attached = new Set(
        [...this.group.documents].map((document) => document.editor).filter(Boolean),
      );
      for (const editor of attached) { editor.emitChange(); }
    }
  }

  function createEditor() {
    const changeListeners = new Set();
    let document = new FakeDoc('');
    let readOnly = false;
    let scrollLeft = 0;
    let scrollTop = 0;
    let focused = false;
    const wrapper = createFakeElement('div');
    const editor = {
      addLineWidget(_line, node) {
        wrapper.append(node);
        return { clear: () => node.remove() };
      },
      addKeyMap() {},
      coordsChar: ({ left }) => ({ line: 0, ch: Math.max(0, Math.trunc(left)) }),
      removeKeyMap() {},
      focus() {
        for (const candidate of editors) { candidate.setFixtureFocus(false); }
        focused = true;
      },
      getCursor(which) {
        return { line: 0, ch: 'anchor' === which ? document.anchor : document.head };
      },
      getDoc: () => document,
      getScrollInfo: () => ({ left: scrollLeft, top: scrollTop }),
      getLine: (line) => document.getValue().split('\n')[line] ?? '',
      getWrapperElement: () => wrapper,
      getValue: () => document.getValue(),
      hasFocus: () => focused,
      indexFromPos: (position) => position.ch,
      off(_event, listener) { changeListeners.delete(listener); },
      on(_event, listener) { changeListeners.add(listener); },
      posFromIndex: (index) => ({ line: 0, ch: index }),
      refresh() {},
      scrollTo(left, top) {
        scrollLeft = left;
        scrollTop = top;
      },
      setFixtureFocus(next) { focused = next; },
      setOption(name, next) {
        if ('readOnly' === name) { readOnly = next; }
      },
      setSelection(anchor, head) {
        document.anchor = anchor.ch;
        document.head = head.ch;
      },
      setSize() {},
      setValue(next) { document.setValue(next); },
      swapDoc(next) {
        const previous = document;
        previous.editor = null;
        document = next;
        document.editor = editor;
        return previous;
      },
      emitChange() {
        for (const listener of changeListeners) { listener(editor); }
      },
      userEdit(next) {
        assert.equal(readOnly, false, 'fixture attempted to edit a read-only CodeMirror');
        this.setValue(next);
      },
      wrapper,
    };
    document.editor = editor;
    editors.push(editor);
    return editor;
  }

  return {
    static: {
      Doc: FakeDoc,
      fromTextArea: () => createEditor(),
    },
    editors,
    get editor() { return editors[0]; },
  };
}

function createFakeWindowLifecycle() {
  let closeHandler = null;
  let destroyCount = 0;
  let disposeCount = 0;
  return {
    lifecycle: {
      async onCloseRequested(handler) {
        closeHandler = handler;
        return {
          dispose() {
            if (closeHandler === handler) { closeHandler = null; }
            disposeCount += 1;
          },
        };
      },
      async destroy() { destroyCount += 1; },
    },
    async requestClose() {
      assert.ok(closeHandler, 'close handler must be installed');
      let prevented = false;
      const completion = closeHandler({ preventDefault() { prevented = true; } });
      assert.equal(prevented, true, 'close must be prevented before asynchronous recovery');
      await completion;
      return { prevented };
    },
    get destroyCount() { return destroyCount; },
    get disposeCount() { return disposeCount; },
  };
}

async function importBundledPackage(packageName) {
  const result = await build({
    entryPoints: [packageEntries[packageName]],
    absWorkingDir: projectRoot,
    alias: packageEntries,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
  });
  const source = result.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

test('core accepts only canonical workspace-relative paths', async () => {
  const core = await importBundledPackage('@mdular/core');

  assert.equal(core.workspacePath('docs/design/介绍.md'), 'docs/design/介绍.md');
  for (const [value, expectedCode] of [
    ['', 'empty'],
    ['/docs/readme.md', 'absolute'],
    ['C:/docs/readme.md', 'absolute'],
    ['docs\\readme.md', 'backslash'],
    ['docs//readme.md', 'empty-segment'],
    ['docs/../readme.md', 'traversal'],
    ['docs/./readme.md', 'traversal'],
    ['docs/\0readme.md', 'null-byte'],
  ]) {
    assert.throws(
      () => core.workspacePath(value),
      (error) => error instanceof core.WorkspacePathError && expectedCode === error.code,
    );
  }
});

test('pane controller shares sessions, isolates view state and releases clean documents', async () => {
  const core = await importBundledPackage('@mdular/core');
  const editor = await importBundledPackage('@mdular/editor');
  const adapter = createAdapter(async () => { throw new Error('not used'); });
  const registry = new core.SessionRegistry();
  const panes = new editor.PaneController(registry);
  const firstSnapshot = createSnapshot(core);

  const primary = panes.open(firstSnapshot, adapter, { target: 'primary' });
  const secondary = panes.open(firstSnapshot, adapter, { target: 'secondary' });

  assert.equal(primary.reusedSession, false);
  assert.equal(secondary.reusedSession, true);
  assert.equal(secondary.session, primary.session);
  assert.deepEqual(primary.session.state.paneIds, ['primary', 'secondary']);
  panes.updateView('primary', {
    selectionAnchor: 2,
    selectionHead: 4,
    scrollLeft: 0,
    scrollTop: 30,
    focused: false,
  });
  panes.updateView('secondary', {
    selectionAnchor: 8,
    selectionHead: 8,
    scrollLeft: 10,
    scrollTop: 90,
    focused: true,
  });
  assert.equal(panes.state.primary.view.scrollTop, 30);
  assert.equal(panes.state.secondary.view.scrollTop, 90);

  panes.closeSecondary();
  assert.deepEqual(primary.session.state.paneIds, ['primary']);
  const secondSnapshot = createSnapshot(core, {
    path: 'notes/second.md',
    pathKey: 'workspace:notes/second.md',
    revision: 'revision-second',
  });
  const replaced = panes.open(secondSnapshot, adapter, { target: 'primary' });
  assert.equal(replaced.releasedSession, primary.session);
  assert.equal(registry.get(firstSnapshot.pathKey), undefined);
  assert.equal(registry.get(secondSnapshot.pathKey)?.state.path, secondSnapshot.path);
});

test('pane controller falls back to primary on narrow layouts and retains dirty sessions', async () => {
  const core = await importBundledPackage('@mdular/core');
  const editor = await importBundledPackage('@mdular/editor');
  const adapter = createAdapter(async () => { throw new Error('not used'); });
  const registry = new core.SessionRegistry();
  const panes = new editor.PaneController(registry);
  panes.setSecondaryAvailable(false);
  const firstSnapshot = createSnapshot(core);

  const opened = panes.open(firstSnapshot, adapter, { target: 'secondary' });
  assert.equal(opened.paneId, 'primary');
  assert.equal(opened.fellBackToPrimary, true);
  assert.equal(panes.state.secondaryVisible, false);
  opened.session.edit('unsaved\n');

  panes.open(createSnapshot(core, {
    path: 'notes/other.md',
    pathKey: 'workspace:notes/other.md',
  }), adapter, { target: 'primary' });
  assert.equal(registry.get(firstSnapshot.pathKey), opened.session);
  assert.deepEqual(opened.session.state.paneIds, []);
  assert.equal(opened.session.state.dirty, true);
});

test('pane layout preference restores an empty split across temporary narrow fallback', async () => {
  const editor = await importBundledPackage('@mdular/editor');
  const panes = new editor.PaneController();

  panes.restoreLayout({ secondaryVisible: true, activePane: 'secondary' });
  assert.equal(panes.state.secondaryVisible, true);
  assert.equal(panes.state.activePane, 'secondary');
  assert.equal(panes.state.secondary.session, null);

  panes.setSecondaryAvailable(false);
  assert.equal(panes.state.secondaryVisible, false);
  assert.equal(panes.state.activePane, 'primary');
  assert.deepEqual(panes.layoutPreference, {
    secondaryVisible: true,
    activePane: 'secondary',
  });

  panes.setSecondaryAvailable(true);
  assert.equal(panes.state.secondaryVisible, true);
  assert.equal(panes.state.activePane, 'secondary');
  panes.activate('primary');
  assert.deepEqual(panes.layoutPreference, {
    secondaryVisible: true,
    activePane: 'primary',
  });
  assert.equal(panes.closeSecondary(), null);
  assert.deepEqual(panes.layoutPreference, {
    secondaryVisible: false,
    activePane: 'primary',
  });
});

test('desktop layout storage rejects malformed data and writes only layout fields', async () => {
  const layout = await importBundledPackage('@mdular/desktop-layout-preferences');
  let stored = '{malformed';
  let writes = 0;
  const storage = {
    getItem(key) {
      assert.equal(key, layout.DESKTOP_LAYOUT_PREFERENCE_KEY);
      return stored;
    },
    setItem(key, value) {
      assert.equal(key, layout.DESKTOP_LAYOUT_PREFERENCE_KEY);
      writes += 1;
      stored = value;
    },
  };
  const preferences = new layout.LocalDesktopLayoutPreferenceStore(storage);
  assert.equal(preferences.load(), null);
  assert.equal(writes, 0, 'malformed preferences must not be rewritten during load');

  stored = JSON.stringify({
    schemaVersion: 1,
    secondaryVisible: false,
    activePane: 'secondary',
  });
  assert.equal(preferences.load(), null);
  assert.equal(writes, 0, 'contradictory preferences must fail closed without a rewrite');

  preferences.save({ secondaryVisible: true, activePane: 'secondary' });
  assert.deepEqual(JSON.parse(stored), {
    schemaVersion: 1,
    secondaryVisible: true,
    activePane: 'secondary',
  });
  assert.deepEqual(preferences.load(), {
    secondaryVisible: true,
    activePane: 'secondary',
  });

  const denied = new layout.LocalDesktopLayoutPreferenceStore({
    getItem() { throw new Error('storage denied'); },
    setItem() { throw new Error('storage denied'); },
  });
  assert.equal(denied.load(), null);
  assert.doesNotThrow(() => denied.save({ secondaryVisible: false, activePane: 'primary' }));
});

test('workspace plugin storage is versioned, bounded, isolated and migrates explicit renames', async () => {
  const sdk = await importBundledPackage('@mdular/plugin-sdk');
  const storageApi = await importBundledPackage('@mdular/desktop-plugin-storage');
  const storage = createFakeStorage();
  let workspaceIdentity = `workspace-sha256:${'a'.repeat(64)}`;
  const manager = new storageApi.DesktopPluginStorageManager(
    storage,
    async () => workspaceIdentity,
  );
  const service = manager.createService('mdular.docs');
  const oldKey = sdk.documentStorageKey('notes/旧 文档.md', 'metadata-expanded');
  const newKey = sdk.documentStorageKey('notes/new.md', 'metadata-expanded');

  assert.deepEqual(await service.set(oldKey, { schemaVersion: 1, value: true }), {
    ok: true,
    value: null,
  });
  assert.deepEqual(await service.get(oldKey), {
    ok: true,
    value: { schemaVersion: 1, value: true },
  });
  const persistedKey = [...storage.values.keys()][0];
  assert.doesNotMatch(persistedKey, /旧 文档/u, 'document paths must be encoded in storage keys');

  assert.deepEqual(await manager.migrateDocumentPath('notes/旧 文档.md', 'notes/new.md'), {
    ok: true,
    value: null,
  });
  assert.deepEqual(await service.get(oldKey), { ok: true, value: null });
  assert.deepEqual(await service.get(newKey), {
    ok: true,
    value: { schemaVersion: 1, value: true },
  });

  workspaceIdentity = `workspace-sha256:${'b'.repeat(64)}`;
  assert.deepEqual(await service.get(newKey), { ok: true, value: null });
  assert.equal((await service.set('', { schemaVersion: 1, value: true })).error.kind, 'invalid-key');
  assert.equal((await service.set('large', {
    schemaVersion: 1,
    value: 'x'.repeat(storageApi.PLUGIN_STORAGE_LIMITS.maxValueBytes),
  })).error.kind, 'quota');
  const unserializable = { schemaVersion: 1 };
  Object.defineProperty(unserializable, 'value', {
    enumerable: true,
    get() { throw new Error('serialization getter failed'); },
  });
  assert.equal((await service.set('unserializable', unserializable)).error.kind, 'serialization');

  workspaceIdentity = `workspace-sha256:${'a'.repeat(64)}`;
  const migratedStorageKey = [...storage.values.keys()].find((key) =>
    key.includes(encodeURIComponent(newKey))
  );
  storage.values.set(migratedStorageKey, '{broken');
  assert.equal((await service.get(newKey)).error.kind, 'invalid-value');

  const unavailable = new storageApi.DesktopPluginStorageManager(
    storage,
    async () => { throw new Error('identity unavailable'); },
  ).createService('mdular.docs');
  assert.equal((await unavailable.get('key')).error.kind, 'unavailable');
});

test('plugin document events expose immutable active snapshots and dispose listeners', async () => {
  const core = await importBundledPackage('@mdular/core');
  const documentsApi = await importBundledPackage('@mdular/desktop-plugin-documents');
  const session = new core.DocumentSession(
    createSnapshot(core),
    createAdapter(async () => { throw new Error('not used'); }),
  );
  const failures = [];
  const hub = new documentsApi.DesktopPluginDocumentHub(
    (pluginId, phase, error) => failures.push([pluginId, phase, error.message]),
  );
  const service = hub.createService('test.documents');
  const versions = [];
  const subscription = service.onDidChange((snapshot) => {
    versions.push(snapshot.bufferVersion);
    assert.equal(Object.isFrozen(snapshot), true);
  });
  service.onDidSave(() => { throw new Error('listener failed'); });

  hub.setActive(session);
  assert.equal(service.getActiveSnapshot().content, 'saved\n');
  session.edit('changed\n');
  hub.emit('change', session);
  hub.emit('save', session);
  await settleAsyncWork();
  assert.deepEqual(versions, [1]);
  assert.deepEqual(failures, [['test.documents', 'provider', 'listener failed']]);
  subscription.dispose();
  subscription.dispose();
  assert.equal(hub.listenerCount('test.documents'), 1);
});

test('active document plugin edits are permission-gated and reject stale buffers', async () => {
  const core = await importBundledPackage('@mdular/core');
  const documentsApi = await importBundledPackage('@mdular/desktop-plugin-documents');
  const session = new core.DocumentSession(
    createSnapshot(core, { content: '---\ntitle: Old\n---\nBody\n' }),
    createAdapter(async () => { throw new Error('not used'); }),
  );
  let hub;
  hub = new documentsApi.DesktopPluginDocumentHub(
    () => {},
    async (edit) => {
      if (
        session.state.path !== edit.path ||
        session.state.bufferVersion !== edit.expectedBufferVersion
      ) {
        return { status: 'stale', current: documentsApi.createPluginDocumentSnapshot(session) };
      }
      session.edit(edit.content);
      hub.emit('change', session);
      return {
        status: 'applied',
        snapshot: documentsApi.createPluginDocumentSnapshot(session),
      };
    },
  );
  hub.setActive(session);
  assert.equal(hub.createService('test.read-only').applyActiveEdit, undefined);
  const service = hub.createService('test.editor', { editActive: true });
  const applied = await service.applyActiveEdit({
    path: session.state.path,
    expectedBufferVersion: 0,
    content: '---\ntitle: New\n---\nBody\n',
  });
  assert.equal(applied.status, 'applied');
  assert.equal(applied.snapshot.bufferVersion, 1);
  assert.equal(service.getActiveSnapshot().content.includes('title: New'), true);
  const stale = await service.applyActiveEdit({
    path: session.state.path,
    expectedBufferVersion: 0,
    content: 'must not win',
  });
  assert.equal(stale.status, 'stale');
  assert.equal(session.state.buffer.includes('title: New'), true);
  await assert.rejects(
    service.applyActiveEdit({
      path: session.state.path,
      expectedBufferVersion: 1,
      content: 'x'.repeat(2 * 1024 * 1024 + 1),
    }),
    /content limit/u,
  );
});

test('document header provider failures remove only the failed contribution', async () => {
  const headersApi = await importBundledPackage('@mdular/desktop-plugin-headers');
  const primary = createFakeElement('div');
  const secondary = createFakeElement('div');
  const failures = [];
  const snapshot = {
    path: 'notes/example.md',
    content: '---\nstatus: ready\n---\n',
    revision: 'revision-1',
    bufferVersion: 0,
    dirty: false,
  };
  const host = new headersApi.DesktopDocumentHeaderHost({
    document: { createElement: (tagName) => createFakeElement(tagName) },
    containers: { primary, secondary },
    getSnapshot: () => snapshot,
    onFailure: (pluginId, phase, error) => failures.push([pluginId, phase, error.message]),
  });
  host.createService('test.failed').registerDocumentHeaderProvider({
    id: 'failed',
    provide: () => { throw new Error('provider failed'); },
  });
  await settleAsyncWork();
  assert.deepEqual(failures, [['test.failed', 'provider', 'provider failed']]);
  assert.equal(host.providerCount('test.failed'), 0);
  failures.length = 0;
  const malformedViewModel = { summary: 'broken', expanded: false };
  Object.defineProperty(malformedViewModel, 'title', {
    enumerable: true,
    get() { throw new Error('render failed'); },
  });
  host.createService('test.render-failed').registerDocumentHeaderProvider({
    id: 'render-failed',
    provide: () => malformedViewModel,
  });
  await settleAsyncWork();
  assert.ok(1 <= failures.length);
  assert.ok(failures.every(([pluginId, phase, message]) =>
    'test.render-failed' === pluginId && 'render' === phase && 'render failed' === message
  ));
  assert.equal(host.providerCount('test.render-failed'), 0);
  host.createService('test.healthy').registerDocumentHeaderProvider({
    id: 'healthy',
    provide: () => ({ title: 'Safe', summary: '1 field', expanded: false }),
  });
  await settleAsyncWork();
  assert.equal(host.providerCount('test.healthy'), 1);
  assert.equal(primary.hidden, false);
  assert.equal(
    findFakeElementByClass(primary, 'v2-document-contribution-title').textContent,
    'Safe · 1 field',
  );
  host.dispose();
  host.dispose();
  assert.equal(primary.hidden, true);
  assert.equal(secondary.hidden, true);
});

test('Docs Metadata parser is bounded, lexical and preserves safe scalar text', async () => {
  const docs = await importBundledPackage('@mdular/plugin-docs');
  assert.deepEqual(docs.parseDocumentMetadata('title\n---\nstatus: wrong place\n---'), {
    kind: 'none',
  });
  assert.deepEqual(docs.parseDocumentMetadata(' ---\nstatus: wrong opener\n---'), {
    kind: 'none',
  });

  const parsed = docs.parseDocumentMetadata(
    '\uFEFF---\r\n' +
    'status: "ready: now"\r\n' +
    'updated: 2026-09-18\r\n' +
    'title: <img src=x onerror=alert(1)>\r\n' +
    'nested:\r\n' +
    '  child: ignored\r\n' +
    'list:\r\n' +
    '- ignored\r\n' +
    'block: |\r\n' +
    '  ignored block\r\n' +
    'collection: [one, two]\r\n' +
    'empty:\r\n' +
    '# comment\r\n' +
    '---\r\nbody',
  );
  assert.equal(parsed.kind, 'metadata');
  assert.equal(parsed.status, 'ready: now');
  assert.equal(parsed.updated, '2026-09-18');
  assert.deepEqual(parsed.fields, [
    { key: 'status', kind: 'scalar', value: 'ready: now' },
    { key: 'updated', kind: 'scalar', value: '2026-09-18' },
    { key: 'title', kind: 'scalar', value: '<img src=x onerror=alert(1)>' },
    { key: 'nested', kind: 'nested' },
    { key: 'list', kind: 'nested' },
    { key: 'block', kind: 'complex' },
    { key: 'collection', kind: 'complex' },
    { key: 'empty', kind: 'empty' },
  ]);

  assert.deepEqual(docs.parseDocumentMetadata('---\nstatus: one\nstatus: two\n---'), {
    kind: 'invalid',
    reason: 'duplicate-key',
    duplicateKey: 'status',
  });
  assert.deepEqual(docs.parseDocumentMetadata('---\nstatus: open'), {
    kind: 'invalid',
    reason: 'missing-close',
  });
  assert.equal(
    docs.parseDocumentMetadata(`---\n${'# ignored\n'.repeat(512)}---`).reason,
    'line-limit',
  );
  assert.equal(
    docs.parseDocumentMetadata(`---\ntitle: ${'x'.repeat(65 * 1024)}\n---`).reason,
    'byte-limit',
  );
});

test('Docs frontmatter round-trip preserves unknown YAML, comments, order, delimiters and body', async () => {
  const docs = await importBundledPackage('@mdular/plugin-docs');
  const source =
    '\uFEFF---\r\n' +
    '# retained comment\r\n' +
    'title: "Old title"  # retained inline comment\r\n' +
    'custom: [one, two]\r\n' +
    'nested:\r\n' +
    '  child: retained\r\n' +
    'cover_focus: 20, 30\r\n' +
    '---\r\n' +
    '# Body\r\n' +
    'Body text.\r\n';
  const parsed = docs.parseRoundTripFrontmatter(source);
  assert.equal(parsed.kind, 'frontmatter');
  assert.deepEqual(parsed.fields, [
    { key: 'title', editable: true, value: 'Old title' },
    { key: 'custom', editable: false },
    { key: 'nested', editable: false },
    { key: 'cover_focus', editable: true, value: '20, 30' },
  ]);

  const updated = docs.updateRoundTripFrontmatter(source, {
    title: 'New title',
    cover_focus: '75 25',
    status: 'ready',
  });
  assert.equal(updated.ok, true);
  assert.equal(updated.changed, true);
  assert.equal(
    updated.content,
    '\uFEFF---\r\n' +
      '# retained comment\r\n' +
      'title: New title  # retained inline comment\r\n' +
      'custom: [one, two]\r\n' +
      'nested:\r\n' +
      '  child: retained\r\n' +
      'cover_focus: 75 25\r\n' +
      'status: ready\r\n' +
      '---\r\n' +
      '# Body\r\n' +
      'Body text.\r\n',
  );
  assert.deepEqual(docs.updateRoundTripFrontmatter(source, { custom: 'unsafe rewrite' }), {
    ok: false,
    reason: 'Frontmatter field is complex and cannot be edited: custom',
  });
  assert.equal(docs.updateRoundTripFrontmatter('# Plain\n', { title: 'No' }).ok, false);
  assert.equal(
    docs.updateRoundTripFrontmatter(source, {}).content,
    source,
    'a no-op round trip must be byte-for-byte identical',
  );
});

test('Docs reader builds bounded safe blocks, local cover paths and nested outlines', async () => {
  const docs = await importBundledPackage('@mdular/plugin-docs');
  const root = [
    '---',
    'title: Root document',
    'cover: ../assets/cover.png',
    'cover_alt: Cover alt',
    'cover_focus: 25 75',
    '---',
    '# Root',
    'Paragraph with <script>alert(1)</script>.',
    '```md',
    '## Hidden heading',
    '```',
    '![Diagram](images/diagram.webp "Diagram caption")',
    '![[nested/child]]',
  ].join('\n');
  const reads = [];
  const reader = await docs.buildDocsReaderDocument('docs/root.md', root, async (path) => {
    reads.push(path);
    if ('docs/nested/child.md' !== path) { throw new Error('missing'); }
    return '# Child\n\n- one\n- two\n';
  });
  assert.deepEqual(reader.cover, {
    path: 'assets/cover.png',
    alt: 'Cover alt',
    presentation: 'cover',
    focusX: 25,
    focusY: 75,
  });
  assert.deepEqual(reads, ['docs/nested/child.md']);
  assert.deepEqual(reader.outline.map(({ label, level }) => [label, level]), [
    ['Root', 1],
    ['Child', 1],
  ]);
  assert.equal(reader.outline.some(({ label }) => label.includes('Hidden')), false);
  assert.ok(reader.blocks.some((block) =>
    'paragraph' === block.kind && block.text.includes('<script>alert(1)</script>')
  ));
  assert.ok(reader.blocks.some((block) =>
    'image' === block.kind && 'docs/images/diagram.webp' === block.image.path
  ));
  assert.ok(reader.blocks.some((block) =>
    'nested' === block.kind && block.text.includes('docs/nested/child.md')
  ));

  const escaped = docs.summarizeDocsDocument(
    'docs/deep/note.md',
    '---\ntitle: Safe\ncover: ../../../../outside.png\n---\n',
  );
  assert.equal(escaped.cover, undefined);
});

test('bounded line diff emits safe unified hunks and normalizes BOM and EOL', async () => {
  const editor = await importBundledPackage('@mdular/editor');
  assert.deepEqual(
    editor.computeLineDiff('\uFEFFone\r\ntwo\r\n', 'one\ntwo\n'),
    { kind: 'identical' },
  );

  const result = editor.computeLineDiff(
    'alpha\n<script>alert(1)</script>\nomega\n',
    'alpha\n<strong>safe text</strong>\nomega\n',
  );
  assert.equal(result.kind, 'hunks');
  assert.equal(result.hunks.length, 1);
  assert.deepEqual(
    result.hunks[0].lines.map(({ kind, text }) => [kind, text]),
    [
      ['unchanged', 'alpha'],
      ['delete', '<script>alert(1)</script>'],
      ['add', '<strong>safe text</strong>'],
      ['unchanged', 'omega'],
      ['unchanged', ''],
    ],
  );
  assert.deepEqual(
    result.hunks[0].lines.map(({ oldLine, newLine }) => [oldLine, newLine]),
    [[1, 1], [2, null], [null, 2], [3, 3], [4, 4]],
  );
});

test('bounded line diff fails closed to one changed block for every hard budget', async () => {
  const editor = await importBundledPackage('@mdular/editor');
  const inputBytes = editor.computeLineDiff('saved', 'buffer', {
    limits: { maxInputBytes: 2 },
  });
  assert.deepEqual(inputBytes, {
    kind: 'changed-block',
    reason: 'input-bytes',
    oldStart: 1,
    oldLines: 1,
    newStart: 1,
    newLines: 1,
  });

  const middleLines = editor.computeLineDiff('a\nb\nc', 'x\ny\nz', {
    limits: { maxMiddleLines: 2 },
  });
  assert.equal(middleLines.kind, 'changed-block');
  assert.equal(middleLines.reason, 'middle-lines');

  const editDistance = editor.computeLineDiff('a', 'b', {
    limits: { maxEditDistance: 1 },
  });
  assert.equal(editDistance.kind, 'changed-block');
  assert.equal(editDistance.reason, 'edit-distance');

  let tick = 0;
  const timed = editor.computeLineDiff('a', 'b', {
    now: () => {
      const current = tick;
      tick += 300;
      return current;
    },
  });
  assert.equal(timed.kind, 'changed-block');
  assert.equal(timed.reason, 'time');
});

test('bounded Myers line diff reconstructs small insertion and deletion combinations', async () => {
  const editor = await importBundledPackage('@mdular/editor');
  const sequences = [[], ['a'], ['b'], ['a', 'b'], ['b', 'a'], ['a', 'a', 'b']];
  for (const savedLines of sequences) {
    for (const currentLines of sequences) {
      const saved = savedLines.join('\n');
      const current = currentLines.join('\n');
      const result = editor.computeLineDiff(saved, current, {
        limits: { contextLines: 100 },
      });
      if (saved === current) {
        assert.equal(result.kind, 'identical');
        continue;
      }
      assert.equal(result.kind, 'hunks');
      const lines = result.hunks.flatMap((hunk) => hunk.lines);
      assert.deepEqual(
        lines.filter((line) => 'add' !== line.kind).map((line) => line.text),
        savedLines,
      );
      assert.deepEqual(
        lines.filter((line) => 'delete' !== line.kind).map((line) => line.text),
        currentLines,
      );
    }
  }
});

test('desktop diff runner cancels stale workers and fails closed when workers are unavailable', async () => {
  const { LineDiffTaskRunner } = await importBundledPackage('@mdular/desktop-diff-runner');
  const workers = [];
  class FakeWorker {
    onmessage = null;
    onerror = null;
    posted = null;
    terminated = false;

    postMessage(message) { this.posted = message; }
    terminate() { this.terminated = true; }
    respond(response) { this.onmessage?.({ data: response }); }
  }
  const runner = new LineDiffTaskRunner(() => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
  });
  const completed = [];
  runner.request('saved', 'first', 1, (result) => completed.push(result));
  runner.request('saved', 'second', 2, (result) => completed.push(result));
  assert.equal(workers[0].terminated, true);
  workers[0].respond({
    requestId: workers[0].posted.requestId,
    bufferVersion: 1,
    result: { kind: 'identical' },
  });
  assert.equal(completed.length, 0);

  workers[1].respond({
    requestId: workers[1].posted.requestId,
    bufferVersion: 1,
    result: { kind: 'identical' },
  });
  assert.equal(completed.length, 0);
  workers[1].respond({
    requestId: workers[1].posted.requestId,
    bufferVersion: 2,
    result: { kind: 'hunks', hunks: [] },
  });
  assert.deepEqual(completed, [{
    bufferVersion: 2,
    result: { kind: 'hunks', hunks: [] },
  }]);
  assert.equal(workers[1].terminated, true);
  runner.dispose();

  const fallback = new LineDiffTaskRunner(() => { throw new Error('Worker unavailable'); });
  const fallbackResults = [];
  fallback.request('saved', 'buffer', 3, (result) => fallbackResults.push(result));
  assert.equal(fallbackResults[0].result.kind, 'changed-block');
  assert.equal(fallbackResults[0].result.reason, 'worker-unavailable');
  fallback.dispose();
});

test('session editor binding moves edits into Core and suppresses programmatic feedback', async () => {
  const core = await importBundledPackage('@mdular/core');
  const editor = await importBundledPackage('@mdular/editor');
  const adapter = createAdapter(async () => { throw new Error('not used'); });
  const session = new core.DocumentSession(createSnapshot(core), adapter);
  const listeners = new Set();
  const port = {
    content: 'stale',
    readOnly: false,
    getValue() { return this.content; },
    setValue(content) {
      this.content = content;
      for (const listener of listeners) { listener(); }
    },
    setReadOnly(readOnly) { this.readOnly = readOnly; },
    subscribe(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
  const editedVersions = [];
  const binding = new editor.SessionEditorBinding(session, port, {
    onEdited: (edited) => editedVersions.push(edited.state.bufferVersion),
  });
  assert.equal(port.content, 'saved\n');
  assert.equal(port.readOnly, false);

  port.setValue('local\n');
  assert.equal(session.state.buffer, 'local\n');
  assert.deepEqual(editedVersions, [1]);

  session.reloadFromDisk(createSnapshot(core, {
    content: 'external\n',
    revision: 'revision-2',
  }));
  binding.syncFromSession();
  assert.equal(port.content, 'external\n');
  assert.deepEqual(editedVersions, [1]);
  binding.dispose();
  port.setValue('ignored after dispose\n');
  assert.equal(session.state.buffer, 'external\n');
});

test('session editor binding fails read-only edits closed and restores the preview', async () => {
  const core = await importBundledPackage('@mdular/core');
  const editor = await importBundledPackage('@mdular/editor');
  const session = new core.DocumentSession(
    createSnapshot(core, {
      content: '\ufffd preview',
      access: {
        kind: 'read-only',
        reason: 'unsupported-encoding',
        message: 'invalid UTF-8',
      },
    }),
    createAdapter(async () => { throw new Error('must not write'); }),
  );
  const listeners = new Set();
  const port = {
    content: '',
    readOnly: false,
    getValue() { return this.content; },
    setValue(content) {
      this.content = content;
      for (const listener of listeners) { listener(); }
    },
    setReadOnly(readOnly) { this.readOnly = readOnly; },
    subscribe(listener) {
      listeners.add(listener);
      return { dispose: () => listeners.delete(listener) };
    },
  };
  const errors = [];
  new editor.SessionEditorBinding(session, port, {
    onReadOnlyEdit: (error) => errors.push(error.reason),
  });
  assert.equal(port.readOnly, true);
  port.setValue('must not persist');
  assert.equal(port.content, '\ufffd preview');
  assert.equal(session.state.buffer, '\ufffd preview');
  assert.deepEqual(errors, ['unsupported-encoding']);
});

test('desktop primary pane carries a user edit through Core save and recovery cleanup', async () => {
  const core = await importBundledPackage('@mdular/core');
  const desktop = await importBundledPackage('@mdular/desktop-application');
  const initial = createSnapshot(core);
  const writes = [];
  const recoveryRemovals = [];
  const watchedPaths = [];
  const unwatchedPaths = [];
  const adapter = {
    ...createAdapter(async (request) => {
      writes.push(request);
      return {
        ok: true,
        snapshot: createSnapshot(core, {
          content: request.content,
          revision: 'revision-2',
        }),
      };
    }),
    read: async (path) => ({
      ok: true,
      snapshot: { ...initial, path },
    }),
    trackDocument(path) {
      watchedPaths.push(path);
      return { dispose: () => { unwatchedPaths.push(path); } };
    },
    capabilities: {
      persistence: 'durable',
      atomicReplace: 'host-guaranteed',
      externalWatch: 'native-hints',
    },
  };
  const bridge = {
    invoke: async (command) => {
      if ('workspace_get_path' === command) { return '/fixture/workspace'; }
      if ('workspace_list_files' === command) { return []; }
      throw new Error(`unexpected command: ${command}`);
    },
    listen: async () => () => {},
  };
  const recoveryStore = {
    write: async () => {},
    remove: async (pathKey) => recoveryRemovals.push(pathKey),
    list: async () => [],
  };
  const body = createFakeElement('body');
  const document = {
    title: 'mdular',
    body,
    createElement: (tagName) => createFakeElement(tagName),
  };
  const codeMirror = createFakeCodeMirror();
  let nextTimer = 1;
  const window = {
    CodeMirror: codeMirror.static,
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => nextTimer++,
    clearTimeout() {},
    confirm: () => true,
  };
  const previousWindow = globalThis.window;
  const windowLifecycle = createFakeWindowLifecycle();
  globalThis.window = window;
  try {
    const application = new desktop.DesktopApplication({
      bridge,
      workspaceAdapter: adapter,
      recoveryStore,
      windowLifecycle: windowLifecycle.lifecycle,
      bundledPluginCatalogLoader: async () => { throw new Error('catalog unavailable'); },
      document,
      window,
    });
    application.mount();
    await settleAsyncWork();
    const root = body.children[0];
    assert.equal(root.dataset.plugins, 'catalog-error');
    const pathInput = findFakeElement(root, 'v2-document-path');
    pathInput.value = initial.path;

    await application.openDocument();
    assert.deepEqual(watchedPaths, [initial.path]);
    assert.equal(codeMirror.editor.getValue(), 'saved\n');
    codeMirror.editor.userEdit('edited in primary\n');
    await Promise.resolve();
    assert.equal(root.dataset.dirty, 'true');

    await application.saveDocument();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].expectedRevision, initial.revision);
    assert.equal(writes[0].content, 'edited in primary\n');
    assert.deepEqual(recoveryRemovals, [initial.pathKey]);
    assert.equal(root.dataset.dirty, 'false');
    assert.equal(findFakeElement(root, 'v2-document-path').value, initial.path);
    application.dispose();
    assert.deepEqual(unwatchedPaths, [initial.path]);
  } finally {
    if (undefined === previousWindow) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('desktop media insertion persists recovery and rolls back native assets on failures', async () => {
  const core = await importBundledPackage('@mdular/core');
  const desktop = await importBundledPackage('@mdular/desktop-application');
  const contentHash = `sha256:${'b'.repeat(64)}`;
  const manifest = {
    schemaVersion: 1,
    id: 'mdular.media',
    name: 'Media',
    version: '0.1.0',
    entry: 'media.js',
    activationEvents: ['onStartup'],
    permissions: ['editor.extensions', 'workspace.writeMedia'],
  };
  const catalog = [{
    manifest,
    entry: 'media.js',
    contentHash,
    load: async () => ({
      pluginManifest: manifest,
      pluginContentHash: contentHash,
      default: {
        activate(context) {
          context.subscriptions.add(context.editor.registerExtension({
            schemaVersion: 1,
            id: 'mdular.media.editor',
            features: ['media'],
          }));
        },
      },
    }),
  }];

  async function runCase({ writeFailure = false, recoveryFailure = false } = {}) {
    const initial = createSnapshot(core, { content: 'saved\n' });
    const adapter = {
      ...createAdapter(async () => { throw new Error('document save is not used'); }),
      read: async () => ({ ok: true, snapshot: initial }),
      capabilities: {
        persistence: 'durable',
        atomicReplace: 'host-guaranteed',
        externalWatch: 'unavailable',
      },
    };
    const nativeCalls = [];
    const revision = `sha256:${'c'.repeat(64)}`;
    const bridge = {
      async invoke(command, args) {
        nativeCalls.push({ command, args });
        if ('workspace_get_path' === command) { return '/fixture/workspace'; }
        if ('workspace_list_files' === command) { return []; }
        if ('workspace_write_media_asset' === command) {
          if (writeFailure) {
            return { status: 'failed', kind: 'io-error', message: 'fixture write failure' };
          }
          return {
            status: 'written',
            receipt: {
              path: args.request.path,
              revision,
              bytes: 3,
            },
          };
        }
        if ('workspace_rollback_media_asset' === command) {
          return { status: 'removed', path: args.request.receipt.path };
        }
        throw new Error(`unexpected command: ${command}`);
      },
      listen: async () => () => {},
    };
    const recoveryWrites = [];
    const recoveryRemovals = [];
    const recoveryStore = {
      async write(record) {
        recoveryWrites.push(record);
        if (recoveryFailure) { throw new Error('fixture recovery failure'); }
      },
      async remove(pathKey) { recoveryRemovals.push(pathKey); },
      list: async () => [],
    };
    const body = createFakeElement('body');
    const head = createFakeElement('head');
    const documentListeners = new Map();
    const document = {
      title: 'mdular',
      body,
      head,
      defaultView: null,
      createElement(tagName) {
        const created = createFakeElement(tagName);
        created.ownerDocument = document;
        return created;
      },
      addEventListener(name, listener) { documentListeners.set(name, listener); },
      removeEventListener(name, listener) {
        if (documentListeners.get(name) === listener) { documentListeners.delete(name); }
      },
    };
    const codeMirror = createFakeCodeMirror();
    let nextTimer = 1;
    const window = {
      CodeMirror: codeMirror.static,
      addEventListener() {},
      removeEventListener() {},
      setTimeout: () => nextTimer++,
      clearTimeout() {},
      confirm: () => true,
    };
    document.defaultView = window;
    const previousWindow = globalThis.window;
    globalThis.window = window;
    const application = new desktop.DesktopApplication({
      bridge,
      workspaceAdapter: adapter,
      recoveryStore,
      windowLifecycle: createFakeWindowLifecycle().lifecycle,
      bundledPluginCatalogLoader: async () => catalog,
      document,
      window,
    });
    try {
      application.mount();
      await settleAsyncWork();
      await settleAsyncWork();
      const pathInput = findFakeElement(body, 'v2-document-path');
      pathInput.value = initial.path;
      await application.openDocument();
      codeMirror.editor.setSelection({ line: 0, ch: 6 }, { line: 0, ch: 6 });
      let prevented = false;
      codeMirror.editor.wrapper.dispatch('paste', {
        clipboardData: {
          files: [{
            name: 'Moon.png',
            type: 'image/png',
            size: 3,
            arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer,
          }],
        },
        preventDefault() { prevented = true; },
      });
      for (let index = 0; index < 5; index += 1) { await settleAsyncWork(); }
      return {
        prevented,
        value: codeMirror.editor.getValue(),
        status: findFakeElement(body, 'v2-primary-status').textContent,
        nativeCalls,
        recoveryWrites,
        recoveryRemovals,
      };
    } finally {
      application.dispose();
      if (undefined === previousWindow) {
        delete globalThis.window;
      } else {
        globalThis.window = previousWindow;
      }
    }
  }

  const successful = await runCase();
  assert.equal(successful.prevented, true);
  assert.match(successful.value, /^saved\n!\[Moon\]\(media\/[^)]+\.png\)$/u);
  assert.equal(successful.recoveryWrites.length, 1);
  assert.equal(successful.recoveryWrites[0].buffer, successful.value);
  assert.match(successful.status, /recovery copy updated/u);
  assert.equal(
    successful.nativeCalls.some(({ command }) => 'workspace_rollback_media_asset' === command),
    false,
  );

  const writeFailed = await runCase({ writeFailure: true });
  assert.equal(writeFailed.value, 'saved\n');
  assert.equal(writeFailed.recoveryWrites.length, 0);
  assert.match(writeFailed.status, /fixture write failure/u);
  assert.equal(
    writeFailed.nativeCalls.some(({ command }) => 'workspace_rollback_media_asset' === command),
    false,
  );

  const recoveryFailed = await runCase({ recoveryFailure: true });
  assert.equal(recoveryFailed.value, 'saved\n');
  assert.equal(recoveryFailed.recoveryWrites.length, 1);
  assert.ok(recoveryFailed.recoveryRemovals.length >= 1);
  assert.equal(
    recoveryFailed.nativeCalls.filter(
      ({ command }) => 'workspace_rollback_media_asset' === command,
    ).length,
    1,
  );
  assert.match(recoveryFailed.status, /Recovery persistence failed/u);
});

test('desktop restores an empty active split without persisting document identity', async () => {
  const core = await importBundledPackage('@mdular/core');
  const desktop = await importBundledPackage('@mdular/desktop-application');
  const initial = createSnapshot(core);
  const adapter = {
    ...createAdapter(async () => { throw new Error('not used'); }),
    read: async () => ({ ok: true, snapshot: initial }),
    capabilities: {
      persistence: 'durable',
      atomicReplace: 'host-guaranteed',
      externalWatch: 'unavailable',
    },
  };
  const bridge = {
    invoke: async (command) => {
      if ('workspace_get_path' === command) { return '/fixture/workspace'; }
      throw new Error(`unexpected command: ${command}`);
    },
    listen: async () => () => {},
  };
  const recoveryStore = {
    write: async () => {},
    remove: async () => {},
    list: async () => [],
  };
  const savedPreferences = [];
  const layoutPreferenceStore = {
    load: () => ({ secondaryVisible: true, activePane: 'secondary' }),
    save: (preference) => savedPreferences.push({ ...preference }),
  };
  const body = createFakeElement('body');
  const document = {
    title: 'mdular',
    body,
    createElement: (tagName) => createFakeElement(tagName),
  };
  const codeMirror = createFakeCodeMirror();
  const window = {
    CodeMirror: codeMirror.static,
    innerWidth: 1200,
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => 1,
    clearTimeout() {},
    confirm: () => true,
  };
  const windowLifecycle = createFakeWindowLifecycle();
  const previousWindow = globalThis.window;
  globalThis.window = window;
  try {
    const application = new desktop.DesktopApplication({
      bridge,
      workspaceAdapter: adapter,
      recoveryStore,
      windowLifecycle: windowLifecycle.lifecycle,
      layoutPreferenceStore,
      document,
      window,
    });
    application.mount();
    await settleAsyncWork();
    const root = body.children[0];
    assert.equal(root.dataset.activePane, 'secondary');
    assert.equal(findFakeElement(root, 'v2-secondary-pane').hidden, false);
    assert.equal(findFakeElement(root, 'v2-panes').dataset.split, 'true');

    findFakeElement(root, 'v2-document-path').value = initial.path;
    await application.openDocument();
    assert.equal(findFakeElement(root, 'v2-editor-textarea'), null);
    assert.ok(findFakeElement(root, 'v2-secondary-editor-textarea'));
    assert.equal(codeMirror.editors[0].getValue(), initial.content);
    assert.deepEqual(savedPreferences.at(-1), {
      secondaryVisible: true,
      activePane: 'secondary',
    });
    assert.deepEqual(Object.keys(savedPreferences.at(-1)).sort(), [
      'activePane',
      'secondaryVisible',
    ]);

    application.closeSecondaryPane();
    assert.equal(findFakeElement(root, 'v2-secondary-pane').hidden, true);
    assert.deepEqual(savedPreferences.at(-1), {
      secondaryVisible: false,
      activePane: 'primary',
    });
    application.dispose();
  } finally {
    if (undefined === previousWindow) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('official Docs Metadata renders declaratively, persists collapse state and hides without frontmatter', async () => {
  const core = await importBundledPackage('@mdular/core');
  const desktop = await importBundledPackage('@mdular/desktop-application');
  const docs = await importBundledPackage('@mdular/plugin-docs');
  const metadata = createSnapshot(core, {
    content:
      '---\n' +
      'status: ready\n' +
      'updated: 2026-09-18\n' +
      'title: <img src=x onerror=alert(1)>\n' +
      '---\n' +
      '# Body\n',
  });
  const plain = createSnapshot(core, {
    path: 'notes/plain.md',
    pathKey: 'workspace:notes/plain.md',
    content: '# No frontmatter\n',
    revision: 'revision-plain',
  });
  const chat = createSnapshot(core, {
    path: 'Chat.md',
    pathKey: 'workspace:Chat.md',
    content: '---\nstatus: hidden\n---\n',
    revision: 'revision-chat',
  });
  const invalid = createSnapshot(core, {
    path: 'notes/invalid.md',
    pathKey: 'workspace:notes/invalid.md',
    content: '---\nstatus: never closed\n',
    revision: 'revision-invalid',
  });
  const adapter = {
    ...createAdapter(async () => { throw new Error('not used'); }),
    read: async (path) => ({
      ok: true,
      snapshot: path === plain.path
        ? plain
        : path === chat.path
          ? chat
          : path === invalid.path
            ? invalid
            : metadata,
    }),
    capabilities: {
      persistence: 'durable',
      atomicReplace: 'host-guaranteed',
      externalWatch: 'unavailable',
    },
  };
  const bridge = {
    invoke: async (command) => {
      if ('workspace_get_path' === command) { return '/fixture/workspace'; }
      throw new Error(`unexpected command: ${command}`);
    },
    listen: async () => () => {},
  };
  const recoveryStore = {
    write: async () => {},
    remove: async () => {},
    list: async () => [],
  };
  const hash = `sha256:${'c'.repeat(64)}`;
  const policyHash = `sha256:${'b'.repeat(64)}`;
  const policyManifest = {
    schemaVersion: 1,
    id: 'fixture.chat-policy',
    name: 'Fixture Chat Policy',
    version: '0.0.0',
    entry: 'chat-policy.js',
    activationEvents: ['onStartup'],
    permissions: ['extensions.register'],
  };
  const policyPlugin = {
    activate(context) {
      context.subscriptions.add(context.extensions.register('mdular.documents.policy', {
        id: 'fixture.chat-policy',
        label: 'Fixture Chat document policy',
        data: {
          schemaVersion: 1,
          paths: ['Chat.md'],
          metadata: 'exclude',
          search: 'exclude',
        },
      }));
    },
  };
  const catalog = [
    {
      manifest: policyManifest,
      entry: policyManifest.entry,
      contentHash: policyHash,
      load: async () => ({
        default: policyPlugin,
        pluginManifest: policyManifest,
        pluginContentHash: policyHash,
      }),
    },
    {
      manifest: docs.pluginManifest,
      entry: docs.pluginManifest.entry,
      contentHash: hash,
      load: async () => ({
        default: docs.default,
        pluginManifest: docs.pluginManifest,
        pluginContentHash: hash,
      }),
    },
  ];
  const pluginStorage = createFakeStorage();
  const body = createFakeElement('body');
  const document = {
    title: 'mdular',
    body,
    createElement: (tagName) => createFakeElement(tagName),
  };
  const codeMirror = createFakeCodeMirror();
  const window = {
    CodeMirror: codeMirror.static,
    innerWidth: 1200,
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => 1,
    clearTimeout() {},
    confirm: () => true,
  };
  const previousWindow = globalThis.window;
  globalThis.window = window;
  try {
    const application = new desktop.DesktopApplication({
      bridge,
      workspaceAdapter: adapter,
      recoveryStore,
      windowLifecycle: createFakeWindowLifecycle().lifecycle,
      bundledPluginCatalogLoader: async () => catalog,
      pluginKeyValueStorage: pluginStorage,
      workspaceIdentityProvider: async () => `workspace-sha256:${'d'.repeat(64)}`,
      document,
      window,
    });
    application.mount();
    await settleAsyncWork();
    const root = body.children[0];
    assert.equal(root.dataset.plugins, 'ready');
    findFakeElement(root, 'v2-document-path').value = metadata.path;
    await application.openDocument();
    await settleAsyncWork();

    const primaryHeaders = findFakeElement(root, 'v2-primary-plugin-headers');
    assert.equal(primaryHeaders.hidden, false);
    assert.equal(
      findFakeElementByClass(primaryHeaders, 'v2-document-contribution-title').textContent,
      'Metadata · 3 fields',
    );
    assert.equal(
      findFakeElementByClass(primaryHeaders, 'v2-document-contribution-summary')
        .attributes['aria-expanded'],
      'false',
    );

    findFakeElementByClass(primaryHeaders, 'v2-document-contribution-summary').dispatch('click');
    await settleAsyncWork();
    await settleAsyncWork();
    assert.equal(
      findFakeElementByClass(primaryHeaders, 'v2-document-contribution-summary')
        .attributes['aria-expanded'],
      'true',
    );
    const fields = findFakeElementByClass(primaryHeaders, 'v2-document-contribution-fields');
    assert.ok(fields.children.some((child) =>
      '<img src=x onerror=alert(1)>' === child.textContent
    ));
    assert.equal(findFakeElementByTag(primaryHeaders, 'img'), null);

    findFakeElement(root, 'v2-document-path').value = metadata.path;
    await application.openDocumentInSplit();
    await settleAsyncWork();
    const secondaryHeaders = findFakeElement(root, 'v2-secondary-plugin-headers');
    assert.equal(secondaryHeaders.hidden, false);
    assert.equal(
      findFakeElementByClass(secondaryHeaders, 'v2-document-contribution-summary')
        .attributes['aria-expanded'],
      'true',
    );

    findFakeElement(root, 'v2-document-path').value = plain.path;
    await application.openDocument();
    await settleAsyncWork();
    assert.equal(secondaryHeaders.hidden, true);
    assert.equal(primaryHeaders.hidden, false, 'the other pane keeps its own contribution');

    findFakeElement(root, 'v2-document-path').value = invalid.path;
    await application.openDocument();
    await settleAsyncWork();
    assert.equal(
      findFakeElementByClass(secondaryHeaders, 'v2-document-contribution-title').textContent,
      'Metadata · invalid',
    );

    findFakeElement(root, 'v2-document-path').value = chat.path;
    await application.openDocument();
    await settleAsyncWork();
    assert.equal(secondaryHeaders.hidden, true, 'Chat documents never receive Metadata UI');
    application.dispose();
    assert.equal(primaryHeaders.hidden, true);
    assert.equal(primaryHeaders.children.length, 0);
  } finally {
    if (undefined === previousWindow) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('desktop split links one session across two CodeMirror views and one save queue', async () => {
  const core = await importBundledPackage('@mdular/core');
  const desktop = await importBundledPackage('@mdular/desktop-application');
  const initial = createSnapshot(core);
  const writes = [];
  const adapter = {
    ...createAdapter(async (request) => {
      writes.push(request);
      return {
        ok: true,
        snapshot: createSnapshot(core, {
          content: request.content,
          revision: 'revision-2',
        }),
      };
    }),
    read: async () => ({ ok: true, snapshot: initial }),
    capabilities: {
      persistence: 'durable',
      atomicReplace: 'host-guaranteed',
      externalWatch: 'unavailable',
    },
  };
  const bridge = {
    invoke: async (command) => {
      if ('workspace_get_path' === command) { return '/fixture/workspace'; }
      throw new Error(`unexpected command: ${command}`);
    },
    listen: async () => () => {},
  };
  const recoveryStore = {
    write: async () => {},
    remove: async () => {},
    list: async () => [],
  };
  const body = createFakeElement('body');
  const document = {
    title: 'mdular',
    body,
    createElement: (tagName) => createFakeElement(tagName),
  };
  const codeMirror = createFakeCodeMirror();
  const window = {
    CodeMirror: codeMirror.static,
    innerWidth: 1200,
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => 1,
    clearTimeout() {},
    confirm: () => true,
  };
  const windowLifecycle = createFakeWindowLifecycle();
  const previousWindow = globalThis.window;
  globalThis.window = window;
  try {
    const application = new desktop.DesktopApplication({
      bridge,
      workspaceAdapter: adapter,
      recoveryStore,
      windowLifecycle: windowLifecycle.lifecycle,
      document,
      window,
    });
    application.mount();
    await settleAsyncWork();
    const root = body.children[0];
    findFakeElement(root, 'v2-document-path').value = initial.path;
    await application.openDocument();
    await application.openDocumentInSplit();

    assert.equal(codeMirror.editors.length, 2);
    assert.equal(findFakeElement(root, 'v2-panes').dataset.split, 'true');
    assert.equal(findFakeElement(root, 'v2-secondary-pane').hidden, false);
    codeMirror.editors[0].userEdit('shared split edit\n');
    assert.equal(codeMirror.editors[1].getValue(), 'shared split edit\n');
    assert.equal(root.dataset.dirty, 'true');

    await application.saveDocument();
    assert.equal(writes.length, 1);
    assert.equal(writes[0].content, 'shared split edit\n');
    assert.equal(codeMirror.editors[0].getValue(), 'shared split edit\n');
    assert.equal(codeMirror.editors[1].getValue(), 'shared split edit\n');

    application.closeSecondaryPane();
    assert.equal(findFakeElement(root, 'v2-panes').dataset.split, 'false');
    assert.equal(findFakeElement(root, 'v2-secondary-pane').hidden, true);
    application.dispose();
  } finally {
    if (undefined === previousWindow) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('desktop split isolates different sessions and falls back to primary on narrow layouts', async () => {
  const core = await importBundledPackage('@mdular/core');
  const desktop = await importBundledPackage('@mdular/desktop-application');
  const first = createSnapshot(core);
  const second = createSnapshot(core, {
    path: 'notes/second.md',
    pathKey: 'workspace:notes/second.md',
    content: 'second\n',
    revision: 'revision-second',
  });
  const adapter = {
    ...createAdapter(async () => { throw new Error('not used'); }),
    read: async (path) => ({
      ok: true,
      snapshot: path === second.path ? second : first,
    }),
    capabilities: {
      persistence: 'durable',
      atomicReplace: 'host-guaranteed',
      externalWatch: 'unavailable',
    },
  };
  const bridge = {
    invoke: async (command) => {
      if ('workspace_get_path' === command) { return '/fixture/workspace'; }
      throw new Error(`unexpected command: ${command}`);
    },
    listen: async () => () => {},
  };
  const recoveryStore = {
    write: async () => {},
    remove: async () => {},
    list: async () => [],
  };
  const createHarness = (innerWidth) => {
    const body = createFakeElement('body');
    const document = {
      title: 'mdular',
      body,
      createElement: (tagName) => createFakeElement(tagName),
    };
    const codeMirror = createFakeCodeMirror();
    const window = {
      CodeMirror: codeMirror.static,
      innerWidth,
      addEventListener() {},
      removeEventListener() {},
      setTimeout: () => 1,
      clearTimeout() {},
      confirm: () => true,
    };
    return { body, codeMirror, document, window };
  };
  const previousWindow = globalThis.window;
  try {
    const wide = createHarness(1200);
    globalThis.window = wide.window;
    const wideLifecycle = createFakeWindowLifecycle();
    const wideApplication = new desktop.DesktopApplication({
      bridge,
      workspaceAdapter: adapter,
      recoveryStore,
      windowLifecycle: wideLifecycle.lifecycle,
      document: wide.document,
      window: wide.window,
    });
    wideApplication.mount();
    await settleAsyncWork();
    const wideRoot = wide.body.children[0];
    findFakeElement(wideRoot, 'v2-document-path').value = first.path;
    await wideApplication.openDocument();
    findFakeElement(wideRoot, 'v2-document-path').value = second.path;
    await wideApplication.openDocumentInSplit();
    assert.equal(wide.codeMirror.editors[0].getValue(), 'saved\n');
    assert.equal(wide.codeMirror.editors[1].getValue(), 'second\n');
    wide.codeMirror.editors[1].userEdit('secondary only\n');
    assert.equal(wide.codeMirror.editors[0].getValue(), 'saved\n');
    wideApplication.dispose();

    const narrow = createHarness(600);
    globalThis.window = narrow.window;
    const narrowLifecycle = createFakeWindowLifecycle();
    const narrowApplication = new desktop.DesktopApplication({
      bridge,
      workspaceAdapter: adapter,
      recoveryStore,
      windowLifecycle: narrowLifecycle.lifecycle,
      document: narrow.document,
      window: narrow.window,
    });
    narrowApplication.mount();
    await settleAsyncWork();
    const narrowRoot = narrow.body.children[0];
    findFakeElement(narrowRoot, 'v2-document-path').value = second.path;
    await narrowApplication.openDocumentInSplit();
    assert.equal(findFakeElement(narrowRoot, 'v2-panes').dataset.split, 'false');
    assert.equal(narrow.codeMirror.editors.length, 1);
    assert.match(
      findFakeElement(narrowRoot, 'v2-primary-status').textContent,
      /Split is unavailable/u,
    );
    narrowApplication.dispose();
  } finally {
    if (undefined === previousWindow) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('desktop diff fallback is explicit, read-only and restores the editor view', async () => {
  const core = await importBundledPackage('@mdular/core');
  const desktop = await importBundledPackage('@mdular/desktop-application');
  const initial = createSnapshot(core);
  const adapter = {
    ...createAdapter(async () => { throw new Error('diff must not write the workspace'); }),
    read: async () => ({ ok: true, snapshot: initial }),
    capabilities: {
      persistence: 'durable',
      atomicReplace: 'host-guaranteed',
      externalWatch: 'unavailable',
    },
  };
  const bridge = {
    invoke: async (command) => {
      if ('workspace_get_path' === command) { return '/fixture/workspace'; }
      throw new Error(`unexpected command: ${command}`);
    },
    listen: async () => () => {},
  };
  const recoveryStore = {
    write: async () => {},
    remove: async () => {},
    list: async () => [],
  };
  const body = createFakeElement('body');
  const document = {
    title: 'mdular',
    body,
    createElement: (tagName) => createFakeElement(tagName),
  };
  const codeMirror = createFakeCodeMirror();
  const window = {
    CodeMirror: codeMirror.static,
    innerWidth: 1200,
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => 1,
    clearTimeout() {},
    confirm: () => true,
  };
  const windowLifecycle = createFakeWindowLifecycle();
  const previousWindow = globalThis.window;
  globalThis.window = window;
  try {
    const application = new desktop.DesktopApplication({
      bridge,
      workspaceAdapter: adapter,
      recoveryStore,
      windowLifecycle: windowLifecycle.lifecycle,
      document,
      window,
    });
    application.mount();
    await settleAsyncWork();
    const root = body.children[0];
    findFakeElement(root, 'v2-document-path').value = initial.path;
    await application.openDocument();
    codeMirror.editor.userEdit('dirty diff buffer\n');
    codeMirror.editor.setSelection({ line: 0, ch: 2 }, { line: 0, ch: 5 });
    codeMirror.editor.scrollTo(11, 47);

    application.toggleDiff('primary');
    assert.equal(findFakeElement(root, 'v2-primary-diff').hidden, false);
    assert.equal(findFakeElement(root, 'v2-primary-diff').dataset.state, 'changed-block');
    assert.equal(findFakeElement(root, 'v2-primary-editor-host').hidden, true);
    assert.equal(root.dataset.dirty, 'true');

    codeMirror.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 0 });
    codeMirror.editor.scrollTo(0, 0);
    application.toggleDiff('primary');
    assert.equal(findFakeElement(root, 'v2-primary-diff').hidden, true);
    assert.deepEqual(codeMirror.editor.getCursor('anchor'), { line: 0, ch: 2 });
    assert.deepEqual(codeMirror.editor.getCursor('head'), { line: 0, ch: 5 });
    assert.deepEqual(codeMirror.editor.getScrollInfo(), { left: 11, top: 47 });
    assert.equal(codeMirror.editor.getValue(), 'dirty diff buffer\n');
    application.dispose();
  } finally {
    if (undefined === previousWindow) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('desktop diff cancels stale work and renders worker text without interpreting markup', async () => {
  const core = await importBundledPackage('@mdular/core');
  const desktop = await importBundledPackage('@mdular/desktop-application');
  const initial = createSnapshot(core);
  const workers = [];
  class FakeDiffWorker {
    onmessage = null;
    onerror = null;
    posted = null;
    terminated = false;

    postMessage(message) { this.posted = message; }
    terminate() { this.terminated = true; }
    respond(result) {
      this.onmessage?.({
        data: {
          requestId: this.posted.requestId,
          bufferVersion: this.posted.bufferVersion,
          result,
        },
      });
    }
  }
  const adapter = {
    ...createAdapter(async () => { throw new Error('not used'); }),
    read: async () => ({ ok: true, snapshot: initial }),
    capabilities: {
      persistence: 'durable',
      atomicReplace: 'host-guaranteed',
      externalWatch: 'unavailable',
    },
  };
  const bridge = {
    invoke: async (command) => {
      if ('workspace_get_path' === command) { return '/fixture/workspace'; }
      throw new Error(`unexpected command: ${command}`);
    },
    listen: async () => () => {},
  };
  const recoveryStore = {
    write: async () => {},
    remove: async () => {},
    list: async () => [],
  };
  const body = createFakeElement('body');
  const document = {
    title: 'mdular',
    body,
    createElement: (tagName) => createFakeElement(tagName),
  };
  const codeMirror = createFakeCodeMirror();
  const window = {
    CodeMirror: codeMirror.static,
    innerWidth: 1200,
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => 1,
    clearTimeout() {},
    confirm: () => true,
  };
  const windowLifecycle = createFakeWindowLifecycle();
  const previousWindow = globalThis.window;
  globalThis.window = window;
  try {
    const application = new desktop.DesktopApplication({
      bridge,
      workspaceAdapter: adapter,
      recoveryStore,
      windowLifecycle: windowLifecycle.lifecycle,
      diffWorkerFactory: () => {
        const worker = new FakeDiffWorker();
        workers.push(worker);
        return worker;
      },
      document,
      window,
    });
    application.mount();
    await settleAsyncWork();
    const root = body.children[0];
    findFakeElement(root, 'v2-document-path').value = initial.path;
    await application.openDocument();
    codeMirror.editor.userEdit('first buffer\n');
    application.toggleDiff('primary');
    assert.equal(workers.length, 1);
    assert.equal(findFakeElement(root, 'v2-primary-diff').dataset.state, 'pending');

    codeMirror.editor.userEdit('second buffer\n');
    assert.equal(workers[0].terminated, true);
    assert.equal(workers.length, 2);
    workers[0].respond({ kind: 'identical' });
    assert.equal(findFakeElement(root, 'v2-primary-diff').dataset.state, 'pending');

    workers[1].respond({
      kind: 'hunks',
      hunks: [{
        oldStart: 1,
        oldLines: 0,
        newStart: 1,
        newLines: 1,
        lines: [{
          kind: 'add',
          text: '<img src=x onerror=alert(1)>',
          oldLine: null,
          newLine: 1,
        }],
      }],
    });
    const renderedLine = findFakeElementByClass(root, 'v2-diff-add');
    assert.equal(renderedLine.textContent, '+<img src=x onerror=alert(1)>');
    assert.equal(renderedLine.children.length, 0);
    assert.equal(findFakeElement(root, 'v2-primary-diff').dataset.state, 'hunks');
    application.dispose();
  } finally {
    if (undefined === previousWindow) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('desktop recovery prompt restores a persisted buffer through the primary session', async () => {
  const core = await importBundledPackage('@mdular/core');
  const desktop = await importBundledPackage('@mdular/desktop-application');
  const initial = createSnapshot(core);
  const loaded = {
    generation: 'current',
    record: {
      schemaVersion: 1,
      path: initial.path,
      pathKey: initial.pathKey,
      savedRevision: initial.revision,
      buffer: 'restored from recovery\n',
      bufferVersion: 4,
      capturedAt: 100,
    },
  };
  const adapter = {
    ...createAdapter(async () => { throw new Error('not used'); }),
    read: async () => ({ ok: true, snapshot: initial }),
    capabilities: {
      persistence: 'durable',
      atomicReplace: 'host-guaranteed',
      externalWatch: 'unavailable',
    },
  };
  const bridge = {
    invoke: async (command) => {
      if ('workspace_get_path' === command) { return '/fixture/workspace'; }
      throw new Error(`unexpected command: ${command}`);
    },
    listen: async () => () => {},
  };
  const recoveryStore = {
    write: async () => {},
    remove: async () => {},
    list: async () => [loaded],
  };
  const body = createFakeElement('body');
  const document = {
    title: 'mdular',
    body,
    createElement: (tagName) => createFakeElement(tagName),
  };
  const codeMirror = createFakeCodeMirror();
  let nextTimer = 1;
  const window = {
    CodeMirror: codeMirror.static,
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => nextTimer++,
    clearTimeout() {},
    confirm: () => true,
  };
  const previousWindow = globalThis.window;
  const windowLifecycle = createFakeWindowLifecycle();
  globalThis.window = window;
  try {
    const application = new desktop.DesktopApplication({
      bridge,
      workspaceAdapter: adapter,
      recoveryStore,
      windowLifecycle: windowLifecycle.lifecycle,
      document,
      window,
    });
    application.mount();
    await application.discoverRecovery();
    const root = body.children[0];
    assert.equal(findFakeElement(root, 'v2-recovery-panel').hidden, false);

    await application.restoreNextRecovery();
    assert.equal(codeMirror.editor.getValue(), 'restored from recovery\n');
    assert.equal(root.dataset.dirty, 'true');
    assert.equal(root.dataset.conflict, 'none');
    assert.equal(findFakeElement(root, 'v2-recovery-panel').hidden, true);
    application.dispose();
  } finally {
    if (undefined === previousWindow) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('desktop close gate flushes current recovery before destroying the window', async () => {
  const core = await importBundledPackage('@mdular/core');
  const desktop = await importBundledPackage('@mdular/desktop-application');
  const initial = createSnapshot(core);
  const written = [];
  const adapter = {
    ...createAdapter(async () => { throw new Error('not used'); }),
    read: async () => ({ ok: true, snapshot: initial }),
    capabilities: {
      persistence: 'durable',
      atomicReplace: 'host-guaranteed',
      externalWatch: 'unavailable',
    },
  };
  const bridge = {
    invoke: async (command) => {
      if ('workspace_get_path' === command) { return '/fixture/workspace'; }
      throw new Error(`unexpected command: ${command}`);
    },
    listen: async () => () => {},
  };
  const recoveryStore = {
    write: async (record) => { written.push(record); },
    remove: async () => {},
    list: async () => [],
  };
  const body = createFakeElement('body');
  const document = {
    title: 'mdular',
    body,
    createElement: (tagName) => createFakeElement(tagName),
  };
  const codeMirror = createFakeCodeMirror();
  const window = {
    CodeMirror: codeMirror.static,
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => 1,
    clearTimeout() {},
    confirm: () => true,
  };
  const windowLifecycle = createFakeWindowLifecycle();
  const previousWindow = globalThis.window;
  globalThis.window = window;
  try {
    const application = new desktop.DesktopApplication({
      bridge,
      workspaceAdapter: adapter,
      recoveryStore,
      windowLifecycle: windowLifecycle.lifecycle,
      document,
      window,
    });
    application.mount();
    await settleAsyncWork();
    const root = body.children[0];
    findFakeElement(root, 'v2-document-path').value = initial.path;
    await application.openDocument();
    codeMirror.editor.userEdit('recover before close\n');

    await windowLifecycle.requestClose();

    assert.equal(written.at(-1).buffer, 'recover before close\n');
    assert.equal(windowLifecycle.destroyCount, 1);
    assert.equal(windowLifecycle.disposeCount, 1);
  } finally {
    if (undefined === previousWindow) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('desktop close gate remains open when recovery persistence fails', async () => {
  const core = await importBundledPackage('@mdular/core');
  const desktop = await importBundledPackage('@mdular/desktop-application');
  const initial = createSnapshot(core);
  const adapter = {
    ...createAdapter(async () => { throw new Error('not used'); }),
    read: async () => ({ ok: true, snapshot: initial }),
    capabilities: {
      persistence: 'durable',
      atomicReplace: 'host-guaranteed',
      externalWatch: 'unavailable',
    },
  };
  const bridge = {
    invoke: async (command) => {
      if ('workspace_get_path' === command) { return '/fixture/workspace'; }
      throw new Error(`unexpected command: ${command}`);
    },
    listen: async () => () => {},
  };
  const recoveryStore = {
    write: async () => { throw new Error('disk full'); },
    remove: async () => {},
    list: async () => [],
  };
  const body = createFakeElement('body');
  const document = {
    title: 'mdular',
    body,
    createElement: (tagName) => createFakeElement(tagName),
  };
  const codeMirror = createFakeCodeMirror();
  const window = {
    CodeMirror: codeMirror.static,
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => 1,
    clearTimeout() {},
    confirm: () => true,
  };
  const windowLifecycle = createFakeWindowLifecycle();
  const previousWindow = globalThis.window;
  globalThis.window = window;
  try {
    const application = new desktop.DesktopApplication({
      bridge,
      workspaceAdapter: adapter,
      recoveryStore,
      windowLifecycle: windowLifecycle.lifecycle,
      document,
      window,
    });
    application.mount();
    await settleAsyncWork();
    const root = body.children[0];
    findFakeElement(root, 'v2-document-path').value = initial.path;
    await application.openDocument();
    codeMirror.editor.userEdit('cannot recover\n');

    await windowLifecycle.requestClose();

    assert.equal(windowLifecycle.destroyCount, 0);
    assert.match(findFakeElement(root, 'v2-runtime-status').textContent, /recovery error: disk full/u);
    application.dispose();
  } finally {
    if (undefined === previousWindow) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('desktop conflict actions preserve a recovery copy and reload fresh host truth', async () => {
  const core = await importBundledPackage('@mdular/core');
  const desktop = await importBundledPackage('@mdular/desktop-application');
  const initial = createSnapshot(core);
  const conflictSnapshot = createSnapshot(core, {
    content: 'disk conflict\n',
    revision: 'revision-2',
  });
  const latestSnapshot = createSnapshot(core, {
    content: 'latest disk truth\n',
    revision: 'revision-3',
  });
  let reads = 0;
  const writtenRecovery = [];
  const removedRecovery = [];
  const adapter = {
    ...createAdapter(async () => ({
      ok: false,
      kind: 'conflict',
      message: 'fixture external change',
      current: conflictSnapshot,
    })),
    read: async () => {
      reads += 1;
      return { ok: true, snapshot: 1 === reads ? initial : latestSnapshot };
    },
    capabilities: {
      persistence: 'durable',
      atomicReplace: 'host-guaranteed',
      externalWatch: 'unavailable',
    },
  };
  const bridge = {
    invoke: async (command) => {
      if ('workspace_get_path' === command) { return '/fixture/workspace'; }
      throw new Error(`unexpected command: ${command}`);
    },
    listen: async () => () => {},
  };
  const recoveryStore = {
    write: async (record) => { writtenRecovery.push(record); },
    remove: async (pathKey) => { removedRecovery.push(pathKey); },
    list: async () => [],
  };
  const body = createFakeElement('body');
  const document = {
    title: 'mdular',
    body,
    createElement: (tagName) => createFakeElement(tagName),
  };
  const codeMirror = createFakeCodeMirror();
  const window = {
    CodeMirror: codeMirror.static,
    addEventListener() {},
    removeEventListener() {},
    setTimeout: () => 1,
    clearTimeout() {},
    confirm: () => true,
  };
  const windowLifecycle = createFakeWindowLifecycle();
  const previousWindow = globalThis.window;
  globalThis.window = window;
  try {
    const application = new desktop.DesktopApplication({
      bridge,
      workspaceAdapter: adapter,
      recoveryStore,
      windowLifecycle: windowLifecycle.lifecycle,
      document,
      window,
    });
    application.mount();
    await settleAsyncWork();
    const root = body.children[0];
    findFakeElement(root, 'v2-document-path').value = initial.path;
    await application.openDocument();
    codeMirror.editor.userEdit('keep my buffer\n');
    await application.saveDocument();

    assert.equal(root.dataset.conflict, 'external-change');
    assert.equal(findFakeElement(root, 'v2-conflict-panel').hidden, false);
    await application.keepConflictRecovery();
    assert.equal(writtenRecovery.at(-1).buffer, 'keep my buffer\n');
    assert.equal(root.dataset.conflict, 'external-change');

    await application.reloadConflictFromDisk();
    assert.equal(reads, 2, 'reload must re-read instead of trusting the earlier conflict snapshot');
    assert.equal(codeMirror.editor.getValue(), 'latest disk truth\n');
    assert.equal(root.dataset.dirty, 'false');
    assert.equal(root.dataset.conflict, 'none');
    assert.equal(findFakeElement(root, 'v2-conflict-panel').hidden, true);
    assert.deepEqual(removedRecovery, [initial.pathKey]);
    application.dispose();
  } finally {
    if (undefined === previousWindow) {
      delete globalThis.window;
    } else {
      globalThis.window = previousWindow;
    }
  }
});

test('session registry trusts host keys for case and Unicode alias identity', async () => {
  const core = await importBundledPackage('@mdular/core');
  const adapter = createAdapter(async () => { throw new Error('not used'); });
  const registry = new core.SessionRegistry();
  const canonicalKey = 'host:file-identity-1';
  const first = registry.open(createSnapshot(core, {
    path: 'Notes/Caf\u00e9.md',
    pathKey: canonicalKey,
  }), adapter);
  const alias = registry.open(createSnapshot(core, {
    path: 'notes/Cafe\u0301.md',
    pathKey: canonicalKey,
  }), adapter);

  assert.equal(alias, first);
  assert.equal(registry.list().length, 1);
  assert.equal(first.state.path, core.workspacePath('Notes/Caf\u00e9.md'));
});

test('document session saves against the opaque revision and adopts the returned snapshot', async () => {
  const core = await importBundledPackage('@mdular/core');
  const initial = createSnapshot(core);
  const writes = [];
  const adapter = createAdapter(async (request) => {
    writes.push(request);
    return {
      ok: true,
      snapshot: createSnapshot(core, {
        content: request.content,
        revision: 'revision-2',
      }),
    };
  });
  const session = new core.DocumentSession(initial, adapter);

  session.edit('edited\n');
  assert.equal(session.state.dirty, true);
  assert.equal(session.state.recoveryState.kind, 'pending');

  const outcome = await session.save();

  assert.equal(outcome.kind, 'saved');
  assert.equal(writes.length, 1);
  assert.equal(writes[0].expectedRevision, initial.revision);
  assert.equal(writes[0].content, 'edited\n');
  assert.equal(session.state.savedSnapshot.revision, outcome.snapshot.revision);
  assert.equal(session.state.buffer, 'edited\n');
  assert.equal(session.state.dirty, false);
  assert.equal(session.state.recoveryState.kind, 'clean');
});

test('save queue does not lose an edit or a second save request during an in-flight write', async () => {
  const core = await importBundledPackage('@mdular/core');
  const pending = [];
  const adapter = createAdapter((request) => new Promise((resolveWrite) => {
    pending.push({ request, resolveWrite });
  }));
  const session = new core.DocumentSession(createSnapshot(core), adapter);

  session.edit('first edit\n');
  const firstSave = session.save();
  await Promise.resolve();
  assert.equal(pending.length, 1);

  session.edit('second edit\n');
  const secondSave = session.save();
  pending[0].resolveWrite({
    ok: true,
    snapshot: createSnapshot(core, { content: 'first edit\n', revision: 'revision-2' }),
  });
  await new Promise((resolveTick) => setImmediate(resolveTick));
  assert.equal(pending.length, 2);
  assert.equal(pending[1].request.expectedRevision, core.opaqueRevisionFromHost('revision-2'));
  assert.equal(pending[1].request.content, 'second edit\n');
  pending[1].resolveWrite({
    ok: true,
    snapshot: createSnapshot(core, { content: 'second edit\n', revision: 'revision-3' }),
  });

  assert.equal((await firstSave).kind, 'saved');
  assert.equal((await secondSave).kind, 'saved');
  assert.equal(session.state.buffer, 'second edit\n');
  assert.equal(session.state.dirty, false);
});

test('write conflict preserves the buffer and blocks overwrite until reload', async () => {
  const core = await importBundledPackage('@mdular/core');
  const disk = createSnapshot(core, { content: 'external\n', revision: 'revision-2' });
  const adapter = createAdapter(async () => ({ ok: false, kind: 'conflict', current: disk }));
  const session = new core.DocumentSession(createSnapshot(core), adapter);
  session.edit('local\n');

  const outcome = await session.save();

  assert.equal(outcome.kind, 'conflict');
  assert.equal(session.state.conflict.kind, 'external-change');
  assert.equal(session.state.buffer, 'local\n');
  assert.equal((await session.save()).kind, 'conflict');

  session.reloadFromDisk(disk);
  assert.equal(session.state.conflict, null);
  assert.equal(session.state.buffer, 'external\n');
  assert.equal(session.state.dirty, false);
});

test('typed write failures preserve the saved snapshot, buffer and recovery obligation', async () => {
  const core = await importBundledPackage('@mdular/core');
  for (const kind of ['permission-denied', 'metadata-not-preserved', 'io-error']) {
    const initial = createSnapshot(core);
    const session = new core.DocumentSession(
      initial,
      createAdapter(async () => ({ ok: false, kind, message: `fixture:${kind}` })),
    );
    session.edit(`local:${kind}\n`);

    const outcome = await session.save();

    assert.deepEqual(outcome, { kind: 'error', message: `fixture:${kind}` });
    assert.equal(session.state.savedSnapshot, initial);
    assert.equal(session.state.buffer, `local:${kind}\n`);
    assert.equal(session.state.dirty, true);
    assert.equal(session.state.saveState.kind, 'error');
    assert.equal(session.state.recoveryState.kind, 'pending');
    session.edit(`retry:${kind}\n`);
    assert.equal(session.state.saveState.kind, 'idle');
  }
});

test('external snapshots reload clean sessions but conflict with dirty or missing sessions', async () => {
  const core = await importBundledPackage('@mdular/core');
  const adapter = createAdapter(async () => {
    throw new Error('not used');
  });
  const session = new core.DocumentSession(createSnapshot(core), adapter);
  const external = createSnapshot(core, { content: 'external\n', revision: 'revision-2' });

  session.applyExternalSnapshot(external);
  assert.equal(session.state.buffer, 'external\n');
  assert.equal(session.state.dirty, false);

  session.edit('local\n');
  session.applyExternalSnapshot(
    createSnapshot(core, { content: 'newer external\n', revision: 'revision-3' }),
  );
  assert.equal(session.state.conflict.kind, 'external-change');
  assert.equal(session.state.buffer, 'local\n');

  session.markMissing();
  assert.equal(session.state.conflict.kind, 'missing');
});

test('workspace watch hints re-read host truth and coalesce overlapping refreshes', async () => {
  const core = await importBundledPackage('@mdular/core');
  const initial = createSnapshot(core);
  const second = createSnapshot(core, { content: 'second\n', revision: 'revision-2' });
  const third = createSnapshot(core, { content: 'third\n', revision: 'revision-3' });
  let finishFirstRead;
  let readCount = 0;
  const watched = createWatchedAdapter({
    read: () => {
      readCount += 1;
      if (1 === readCount) {
        return new Promise((resolveRead) => { finishFirstRead = resolveRead; });
      }
      return Promise.resolve({ ok: true, snapshot: third });
    },
    write: async () => { throw new Error('not used'); },
  });
  const registry = new core.SessionRegistry();
  const session = registry.open(initial, watched.adapter);
  const refreshes = [];
  registry.bindWorkspaceWatch(watched.adapter, (refresh) => refreshes.push(refresh));
  const hint = { path: initial.path, pathKey: initial.pathKey, kind: 'deleted' };

  watched.emit(hint);
  watched.emit(hint);
  assert.equal(readCount, 1);
  finishFirstRead({ ok: true, snapshot: second });
  await settleAsyncWork();

  assert.equal(readCount, 2);
  assert.equal(session.state.buffer, 'third\n');
  assert.equal(session.state.savedSnapshot.revision, third.revision);
  assert.equal(session.state.conflict, null);
  assert.equal(refreshes.length, 2);
  assert.deepEqual(refreshes.map((refresh) => refresh.outcome.kind), ['reloaded', 'reloaded']);
});

test('workspace refresh preserves dirty buffers and confirms deletion by re-reading', async () => {
  const core = await importBundledPackage('@mdular/core');
  const initial = createSnapshot(core);
  const external = createSnapshot(core, { content: 'external\n', revision: 'revision-2' });
  let readResult = { ok: true, snapshot: external };
  const watched = createWatchedAdapter({
    read: async () => readResult,
    write: async () => { throw new Error('not used'); },
  });
  const registry = new core.SessionRegistry();
  const session = registry.open(initial, watched.adapter);
  registry.bindWorkspaceWatch(watched.adapter);
  session.edit('local\n');

  watched.emit({ path: initial.path, kind: 'changed' });
  await settleAsyncWork();
  assert.equal(session.state.buffer, 'local\n');
  assert.equal(session.state.conflict.kind, 'external-change');
  assert.equal(session.state.conflict.diskSnapshot.revision, external.revision);

  readResult = { ok: false, error: { kind: 'not-found', message: 'deleted' } };
  watched.emit({ path: initial.path, kind: 'changed' });
  await settleAsyncWork();
  assert.equal(session.state.conflict.kind, 'missing');
  assert.equal(session.state.buffer, 'local\n');
});

test('a watcher refresh waits for an in-flight app save and does not self-conflict', async () => {
  const core = await importBundledPackage('@mdular/core');
  const initial = createSnapshot(core);
  const saved = createSnapshot(core, { content: 'app save\n', revision: 'revision-2' });
  let finishWrite;
  let readCount = 0;
  const watched = createWatchedAdapter({
    read: async () => {
      readCount += 1;
      return { ok: true, snapshot: saved };
    },
    write: () => new Promise((resolveWrite) => { finishWrite = resolveWrite; }),
  });
  const registry = new core.SessionRegistry();
  const session = registry.open(initial, watched.adapter);
  const outcomes = [];
  registry.bindWorkspaceWatch(watched.adapter, ({ outcome }) => outcomes.push(outcome.kind));
  session.edit('app save\n');
  const save = session.save();
  await Promise.resolve();

  watched.emit({ path: initial.path, pathKey: initial.pathKey, kind: 'changed' });
  assert.equal(readCount, 0);
  finishWrite({ ok: true, snapshot: saved });
  assert.equal((await save).kind, 'saved');
  await settleAsyncWork();

  assert.equal(readCount, 1);
  assert.deepEqual(outcomes, ['unchanged']);
  assert.equal(session.state.conflict, null);
  assert.equal(session.state.dirty, false);
});

test('recovery writes never mark a newer buffer version as persisted', async () => {
  const core = await importBundledPackage('@mdular/core');
  const adapter = createAdapter(async () => {
    throw new Error('not used');
  });
  const session = new core.DocumentSession(createSnapshot(core), adapter);
  let finishWrite;
  const records = [];
  const store = {
    write: (record) => new Promise((resolveWrite) => {
      records.push(record);
      finishWrite = resolveWrite;
    }),
    remove: async () => {},
  };

  session.edit('first\n');
  const firstRecovery = session.persistRecovery(store);
  session.edit('second\n');
  finishWrite();
  await firstRecovery;

  assert.equal(records[0].buffer, 'first\n');
  assert.equal(session.state.recoveryState.kind, 'pending');
  assert.equal(session.state.recoveryState.bufferVersion, 2);
});

test('recovery restore preserves persisted buffer state and detects disk divergence', async () => {
  const core = await importBundledPackage('@mdular/core');
  const adapter = createAdapter(async () => { throw new Error('not used'); });
  const initial = createSnapshot(core);
  const record = {
    schemaVersion: 1,
    path: initial.path,
    pathKey: initial.pathKey,
    savedRevision: initial.revision,
    buffer: 'recovered edit\n',
    bufferVersion: 7,
    capturedAt: 42,
  };
  const restored = new core.DocumentSession(initial, adapter);

  assert.deepEqual(restored.restoreRecovery(record), { kind: 'restored' });
  assert.equal(restored.state.buffer, 'recovered edit\n');
  assert.equal(restored.state.bufferVersion, 7);
  assert.equal(restored.state.dirty, true);
  assert.deepEqual(restored.state.recoveryState, {
    kind: 'persisted',
    bufferVersion: 7,
    capturedAt: 42,
  });

  const changedDisk = createSnapshot(core, {
    content: 'external\n',
    revision: 'revision-2',
  });
  const conflicted = new core.DocumentSession(changedDisk, adapter);
  const conflict = conflicted.restoreRecovery(record);
  assert.equal(conflict.kind, 'conflict');
  assert.equal(conflicted.state.buffer, 'recovered edit\n');
  assert.equal(conflicted.state.conflict.diskSnapshot, changedDisk);

  const stale = new core.DocumentSession(initial, adapter);
  assert.deepEqual(stale.restoreRecovery({ ...record, buffer: initial.content }), { kind: 'stale' });
  assert.equal(stale.state.dirty, false);
  assert.equal(stale.state.recoveryState.kind, 'clean');
  assert.throws(
    () => restored.restoreRecovery({
      ...record,
      path: core.workspacePath('notes/other.md'),
    }),
    /different document/u,
  );
});

test('recovery writes are serialized and coalesce a requested newer buffer', async () => {
  const core = await importBundledPackage('@mdular/core');
  const session = new core.DocumentSession(
    createSnapshot(core),
    createAdapter(async () => { throw new Error('not used'); }),
  );
  const pending = [];
  const records = [];
  const store = {
    write: (record) => new Promise((resolveWrite) => {
      records.push(record);
      pending.push(resolveWrite);
    }),
    remove: async () => {},
  };

  session.edit('first\n');
  const first = session.persistRecovery(store, () => 10);
  await Promise.resolve();
  session.edit('second\n');
  const second = session.persistRecovery(store, () => 20);
  assert.equal(records.length, 1);

  pending.shift()();
  await settleAsyncWork();
  assert.equal(records.length, 2);
  assert.equal(records[1].buffer, 'second\n');
  assert.equal(records[1].schemaVersion, 1);
  assert.equal(records[1].capturedAt, 20);
  pending.shift()();

  assert.deepEqual(await first, { kind: 'persisted', bufferVersion: 2, capturedAt: 20 });
  assert.deepEqual(await second, { kind: 'persisted', bufferVersion: 2, capturedAt: 20 });
  assert.equal(session.state.recoveryState.kind, 'persisted');
  assert.equal(session.state.recoveryState.bufferVersion, 2);
});

test('a save completing during recovery removes the stale record in the same queue', async () => {
  const core = await importBundledPackage('@mdular/core');
  const writes = [];
  const adapter = createAdapter(async (request) => ({
    ok: true,
    snapshot: createSnapshot(core, { content: request.content, revision: 'revision-2' }),
  }));
  const session = new core.DocumentSession(createSnapshot(core), adapter);
  let finishRecovery;
  const store = {
    write: (record) => new Promise((resolveWrite) => {
      writes.push(record);
      finishRecovery = resolveWrite;
    }),
    remove: async (pathKey) => writes.push({ removed: pathKey }),
  };

  session.edit('saved while recovery is writing\n');
  const recovery = session.persistRecovery(store, () => 50);
  await Promise.resolve();
  assert.equal((await session.save()).kind, 'saved');
  finishRecovery();

  assert.deepEqual(await recovery, { kind: 'clean' });
  assert.equal(writes.length, 2);
  assert.equal(writes[1].removed, session.state.pathKey);
  assert.equal(session.state.recoveryState.kind, 'clean');
});

test('recovery coordinator debounces edits, performs periodic writes and flushes for restart', async () => {
  const core = await importBundledPackage('@mdular/core');
  const time = new ManualRecoveryTime();
  const records = [];
  const store = {
    write: async (record) => records.push(record),
    remove: async () => {},
  };
  const session = new core.DocumentSession(
    createSnapshot(core),
    createAdapter(async () => { throw new Error('not used'); }),
  );
  const recovery = new core.RecoveryCoordinator({
    store,
    scheduler: time.scheduler,
    clock: time.clock,
  });
  recovery.track(session);

  session.edit('debounced\n');
  await recovery.notifyChanged(session);
  time.advance(1_999);
  await settleAsyncWork();
  assert.equal(records.length, 0);
  time.advance(1);
  await settleAsyncWork();
  assert.equal(records.length, 1);
  assert.equal(records[0].capturedAt, 2_000);

  session.edit('flush before restart\n');
  await recovery.notifyChanged(session);
  assert.deepEqual(await recovery.prepareForRestart(), { kind: 'ready' });
  assert.equal(records.at(-1).buffer, 'flush before restart\n');

  const periodicTime = new ManualRecoveryTime();
  const periodicRecords = [];
  const periodicSession = new core.DocumentSession(
    createSnapshot(core),
    createAdapter(async () => { throw new Error('not used'); }),
  );
  const periodic = new core.RecoveryCoordinator({
    store: {
      write: async (record) => periodicRecords.push(record),
      remove: async () => {},
    },
    scheduler: periodicTime.scheduler,
    clock: periodicTime.clock,
    debounceMs: 60_000,
    periodicMs: 30_000,
  });
  periodic.track(periodicSession);
  periodicSession.edit('periodic\n');
  await periodic.notifyChanged(periodicSession);
  periodicTime.advance(30_000);
  await settleAsyncWork();
  assert.equal(periodicRecords.length, 1);
  assert.equal(periodicRecords[0].capturedAt, 30_000);
});

test('prepare for restart blocks conflicts and recovery failures with typed reasons', async () => {
  const core = await importBundledPackage('@mdular/core');
  const time = new ManualRecoveryTime();
  const session = new core.DocumentSession(
    createSnapshot(core),
    createAdapter(async () => { throw new Error('not used'); }),
  );
  const recovery = new core.RecoveryCoordinator({
    store: {
      write: async () => { throw new Error('quota exceeded'); },
      remove: async () => {},
    },
    scheduler: time.scheduler,
    clock: time.clock,
  });
  recovery.track(session);
  session.edit('cannot persist\n');
  await recovery.notifyChanged(session);

  const failed = await recovery.prepareForRestart();
  assert.equal(failed.kind, 'blocked');
  assert.deepEqual(failed.reasons.map((reason) => reason.kind), ['recovery-error']);

  const conflictSession = new core.DocumentSession(
    createSnapshot(core, { path: 'notes/conflict.md', pathKey: 'workspace:notes/conflict.md' }),
    createAdapter(async () => { throw new Error('not used'); }),
  );
  const conflictRecovery = new core.RecoveryCoordinator({
    store: { write: async () => {}, remove: async () => {} },
    scheduler: time.scheduler,
    clock: time.clock,
  });
  conflictRecovery.track(conflictSession);
  conflictSession.markMissing();
  await conflictRecovery.notifyChanged(conflictSession);
  const conflict = await conflictRecovery.prepareForRestart();
  assert.equal(conflict.kind, 'blocked');
  assert.deepEqual(conflict.reasons.map((reason) => reason.kind), ['conflict']);
});

test('read-only snapshots cannot enter an editable or writable session', async () => {
  const core = await importBundledPackage('@mdular/core');
  let writeCount = 0;
  const session = new core.DocumentSession(
    createSnapshot(core, {
      content: '\ufffd',
      access: {
        kind: 'read-only',
        reason: 'unsupported-encoding',
        message: 'invalid UTF-8',
      },
    }),
    createAdapter(async () => {
      writeCount += 1;
      throw new Error('must not write');
    }),
  );

  assert.throws(
    () => session.edit('replacement text'),
    (error) => error instanceof core.DocumentReadOnlyError && 'unsupported-encoding' === error.reason,
  );
  assert.equal((await session.save()).kind, 'unchanged');
  assert.equal(writeCount, 0);
});

test('desktop adapter validates typed command results and maps optimistic conflicts', async () => {
  const core = await importBundledPackage('@mdular/core');
  const desktop = await importBundledPackage('@mdular/desktop-workspace-adapter');
  const calls = [];
  const initialWire = createWireSnapshot();
  const conflictWire = createWireSnapshot({ content: 'external\n', revision: 'revision-2' });
  const bridge = {
    async invoke(command, args) {
      calls.push({ command, args });
      if ('workspace_read_document' === command) {
        return { status: 'ok', snapshot: initialWire };
      }
      if ('workspace_write_document_if_revision' === command) {
        return { status: 'conflict', current: conflictWire };
      }
      if ('workspace_stat_document' === command) {
        return { status: 'ok', stat: { kind: 'missing', path: initialWire.path } };
      }
      throw new Error(`unexpected command: ${command}`);
    },
    async listen() {
      return () => {};
    },
  };
  const adapter = new desktop.DesktopWorkspaceAdapter(bridge);
  const path = core.workspacePath(initialWire.path);
  const read = await adapter.read(path);

  assert.equal(read.ok, true);
  assert.equal(read.snapshot.revision, initialWire.revision);
  assert.deepEqual(adapter.capabilities, {
    persistence: 'durable',
    atomicReplace: 'host-guaranteed',
    externalWatch: 'native-hints',
  });
  const write = await adapter.write({
    path: read.snapshot.path,
    pathKey: read.snapshot.pathKey,
    expectedRevision: read.snapshot.revision,
    content: 'local\n',
    format: read.snapshot.format,
  });
  assert.equal(write.ok, false);
  assert.equal(write.kind, 'conflict');
  assert.equal(write.current.content, 'external\n');
  const stat = await adapter.stat(path);
  assert.deepEqual(stat, { ok: true, stat: { kind: 'missing', path } });
  assert.deepEqual(calls.map((call) => call.command), [
    'workspace_read_document',
    'workspace_write_document_if_revision',
    'workspace_stat_document',
  ]);
  assert.deepEqual(calls[0].args, { request: { path } });
});

test('desktop adapter registers only explicitly tracked document paths with native watch', async () => {
  const core = await importBundledPackage('@mdular/core');
  const desktop = await importBundledPackage('@mdular/desktop-workspace-adapter');
  const calls = [];
  const adapter = new desktop.DesktopWorkspaceAdapter({
    async invoke(command, args) {
      calls.push([command, structuredClone(args)]);
    },
    async listen() { return () => {}; },
  });
  const path = core.workspacePath('docs/watched.md');
  const tracked = adapter.trackDocument(path);
  await settleAsyncWork();
  await tracked.dispose();
  await tracked.dispose();
  assert.deepEqual(calls, [
    ['workspace_watch_document', { relativePath: 'docs/watched.md' }],
    ['workspace_unwatch_document', { relativePath: 'docs/watched.md' }],
  ]);
});

test('desktop adapter fails malformed host data closed and disposes async watch subscriptions', async () => {
  const core = await importBundledPackage('@mdular/core');
  const desktop = await importBundledPackage('@mdular/desktop-workspace-adapter');
  const diagnostics = [];
  let watchListener;
  let unlistenCount = 0;
  const bridge = {
    async invoke(command) {
      if ('workspace_read_document' === command) {
        return {
          status: 'ok',
          snapshot: createWireSnapshot({ path: '/absolute/escape.md' }),
        };
      }
      return { status: 'error', kind: 'invented-kind', message: 'malformed' };
    },
    async listen(_event, listener) {
      watchListener = listener;
      return () => { unlistenCount += 1; };
    },
  };
  const adapter = new desktop.DesktopWorkspaceAdapter(bridge, {
    onDiagnostic: (message) => diagnostics.push(message),
  });
  const path = core.workspacePath('notes/example.md');

  const read = await adapter.read(path);
  assert.equal(read.ok, false);
  assert.equal(read.error.kind, 'io-error');
  assert.match(read.error.message, /Invalid workspace path/u);
  const write = await adapter.write({
    path,
    pathKey: core.workspacePathKeyFromHost('workspace:notes/example.md'),
    expectedRevision: core.opaqueRevisionFromHost('revision-1'),
    content: 'content',
    format: { bom: 'none', mainEol: 'lf', trailingNewline: false },
  });
  assert.equal(write.ok, false);
  assert.equal(write.kind, 'io-error');
  assert.match(write.message, /invalid kind/u);

  const hints = [];
  const subscription = adapter.watch((hint) => hints.push(hint));
  watchListener({
    path: 'notes/example.md',
    pathKey: 'workspace:notes/example.md',
    kind: 'changed',
  });
  watchListener({ path: '/escape.md', kind: 'changed' });
  assert.equal(hints.length, 1);
  assert.match(diagnostics[0], /Invalid workspace path/u);
  await subscription.dispose();
  assert.equal(unlistenCount, 1);
});

test('Tauri desktop bridge forwards invoke arguments and unwraps event payloads', async () => {
  const desktop = await importBundledPackage('@mdular/tauri-desktop-bridge');
  const invokes = [];
  let eventListener;
  let unlistenCount = 0;
  const bridge = desktop.createTauriDesktopBridge({
    async invoke(command, args) {
      invokes.push({ command, args });
      return { status: 'ok' };
    },
    async listen(event, listener) {
      assert.equal(event, 'workspace-document-change');
      eventListener = listener;
      return () => { unlistenCount += 1; };
    },
  });

  assert.deepEqual(
    await bridge.invoke('workspace_stat_document', { request: { path: 'notes/example.md' } }),
    { status: 'ok' },
  );
  assert.deepEqual(invokes, [{
    command: 'workspace_stat_document',
    args: { request: { path: 'notes/example.md' } },
  }]);

  const payloads = [];
  const unlisten = await bridge.listen('workspace-document-change', (payload) => {
    payloads.push(payload);
  });
  eventListener({
    event: 'workspace-document-change',
    id: 1,
    payload: { path: 'notes/example.md', kind: 'changed' },
  });
  assert.deepEqual(payloads, [{ path: 'notes/example.md', kind: 'changed' }]);
  unlisten();
  assert.equal(unlistenCount, 1);
});

test('updater handshake answers one typed request only after the Core recovery gate', async () => {
  const desktop = await importBundledPackage('@mdular/desktop-updater-handshake');
  const invokes = [];
  let listener;
  let disposeCount = 0;
  let prepareCount = 0;
  let releasePreparation;
  const preparation = new Promise((resolvePreparation) => {
    releasePreparation = resolvePreparation;
  });
  const bridge = {
    async invoke(command, args) {
      invokes.push({ command, args });
      return null;
    },
    async listen(event, nextListener) {
      assert.equal(event, 'update-prepare-restart');
      listener = nextListener;
      return () => { disposeCount += 1; };
    },
  };
  const subscription = await desktop.installUpdaterRestartHandshake(bridge, async () => {
    prepareCount += 1;
    return preparation;
  });

  listener({ requestId: '../bad', version: '0.1.0', timeoutMs: 60_000 });
  listener({ requestId: 'restart-1', version: '0.1.0', timeoutMs: 60_000 });
  listener({ requestId: 'restart-1', version: '0.1.0', timeoutMs: 60_000 });
  await settleAsyncWork();
  assert.equal(prepareCount, 1);
  assert.deepEqual(invokes, []);

  releasePreparation({
    kind: 'blocked',
    reasons: [{
      kind: 'save-error',
      pathKey: 'opaque-path-key-must-not-cross-the-updater-boundary',
      message: 'disk unavailable',
    }],
  });
  await settleAsyncWork();
  assert.deepEqual(invokes, [{
    command: 'updater_respond_prepare_restart',
    args: {
      requestId: 'restart-1',
      result: {
        kind: 'blocked',
        reasons: [{ kind: 'save-error', message: 'disk unavailable' }],
      },
    },
  }]);
  assert.doesNotMatch(JSON.stringify(invokes), /opaque-path-key/u);

  subscription.dispose();
  assert.equal(disposeCount, 1);
  listener({ requestId: 'restart-2', version: '0.1.0', timeoutMs: 60_000 });
  await settleAsyncWork();
  assert.equal(prepareCount, 1);
});

test('Tauri recovery store forwards records and validates loaded generations', async () => {
  const core = await importBundledPackage('@mdular/core');
  const desktop = await importBundledPackage('@mdular/tauri-recovery-store');
  const calls = [];
  const record = {
    schemaVersion: 1,
    path: core.workspacePath('notes/example.md'),
    pathKey: core.workspacePathKeyFromHost('workspace-path-sha256:fixture'),
    savedRevision: core.opaqueRevisionFromHost('sha256:saved'),
    buffer: 'recovered\n',
    bufferVersion: 3,
    capturedAt: 123,
  };
  const bridge = {
    async invoke(command, args) {
      calls.push({ command, args });
      if ('recovery_list_records' === command) {
        return [{ record, generation: 'previous', diagnostic: 'current invalid' }];
      }
      return null;
    },
    async listen() { return () => {}; },
  };
  const store = new desktop.TauriRecoveryStore(bridge);

  await store.write(record);
  await store.remove(record.pathKey);
  const loaded = await store.list();

  assert.deepEqual(calls, [
    { command: 'recovery_write_record', args: { record } },
    {
      command: 'recovery_remove_record',
      args: { request: { pathKey: record.pathKey } },
    },
    { command: 'recovery_list_records', args: {} },
  ]);
  assert.deepEqual(loaded, [{ record, generation: 'previous', diagnostic: 'current invalid' }]);
});

test('browser preview adapter preserves UTF-8 BOM and CRLF while declaring memory-only scope', async () => {
  const core = await importBundledPackage('@mdular/core');
  const web = await importBundledPackage('@mdular/web-preview-adapter');
  const path = core.workspacePath('资料/示例 文档.md');
  const pathKey = core.workspacePathKeyFromHost('browser-selection:document-1');
  const hashBytes = async (bytes) => [...bytes]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
  const initialBytes = web.encodeUtf8Document('标题\n内容\n', {
    bom: 'utf8',
    mainEol: 'crlf',
    trailingNewline: true,
  });
  const adapter = new web.BrowserPreviewWorkspaceAdapter(
    [{ path, pathKey, bytes: initialBytes }],
    { hashBytes, now: () => 123 },
  );

  assert.deepEqual(adapter.capabilities, {
    persistence: 'session-memory',
    atomicReplace: 'memory-assignment',
    externalWatch: 'adapter-local-only',
  });
  const read = await adapter.read(path);
  assert.equal(read.ok, true);
  assert.equal(read.snapshot.content, '标题\n内容\n');
  assert.deepEqual(read.snapshot.format, {
    bom: 'utf8',
    mainEol: 'crlf',
    trailingNewline: true,
  });
  assert.equal(read.snapshot.access.kind, 'read-write');
  assert.equal(read.snapshot.capturedAt, 123);

  const hints = [];
  adapter.watch((hint) => hints.push(hint));
  const session = new core.DocumentSession(read.snapshot, adapter);
  session.edit('标题\n新内容\n');
  assert.equal((await session.save()).kind, 'saved');
  assert.deepEqual(
    [...adapter.exportBytes(path)],
    [...web.encodeUtf8Document('标题\n新内容\n', read.snapshot.format)],
  );
  assert.deepEqual(hints.map((hint) => hint.kind), ['changed']);
});

test('browser UTF-8 codec round-trips empty, LF and trailing-newline fixtures exactly', async () => {
  const web = await importBundledPackage('@mdular/web-preview-adapter');
  const fixtures = [
    { content: '', format: { bom: 'none', mainEol: 'lf', trailingNewline: false } },
    { content: 'one line', format: { bom: 'none', mainEol: 'lf', trailingNewline: false } },
    { content: 'one line\n', format: { bom: 'none', mainEol: 'lf', trailingNewline: true } },
    { content: '', format: { bom: 'utf8', mainEol: 'lf', trailingNewline: false } },
  ];

  for (const fixture of fixtures) {
    const encoded = web.encodeUtf8Document(fixture.content, fixture.format);
    const body = 'utf8' === fixture.format.bom ? encoded.slice(3) : encoded;
    assert.equal(new TextDecoder().decode(body), fixture.content);
    assert.equal(
      0xef === encoded[0] && 0xbb === encoded[1] && 0xbf === encoded[2],
      'utf8' === fixture.format.bom,
    );
  }
});

test('browser preview exposes invalid UTF-8 as read-only and detects optimistic conflicts', async () => {
  const core = await importBundledPackage('@mdular/core');
  const web = await importBundledPackage('@mdular/web-preview-adapter');
  const path = core.workspacePath('notes/invalid.md');
  const pathKey = core.workspacePathKeyFromHost('browser-selection:invalid');
  const hashBytes = async (bytes) => [...bytes].join('-');
  const adapter = new web.BrowserPreviewWorkspaceAdapter(
    [{ path, pathKey, bytes: Uint8Array.from([0xff, 0xfe, 0x61]) }],
    { hashBytes, now: () => 1 },
  );
  const invalid = await adapter.read(path);
  assert.equal(invalid.ok, true);
  assert.equal(invalid.snapshot.access.kind, 'read-only');
  const readOnlySession = new core.DocumentSession(invalid.snapshot, adapter);
  assert.throws(() => readOnlySession.edit('unsafe replacement'), core.DocumentReadOnlyError);

  const validBytes = web.encodeUtf8Document('original\n', {
    bom: 'none',
    mainEol: 'lf',
    trailingNewline: true,
  });
  adapter.replaceFromBrowser(path, validBytes);
  const valid = await adapter.read(path);
  assert.equal(valid.ok, true);
  const session = new core.DocumentSession(valid.snapshot, adapter);
  session.edit('local\n');
  const externalBytes = web.encodeUtf8Document('external\n', valid.snapshot.format);
  adapter.replaceFromBrowser(path, externalBytes);

  assert.equal((await session.save()).kind, 'conflict');
  assert.deepEqual([...adapter.exportBytes(path)], [...externalBytes]);
  assert.equal(session.state.buffer, 'local\n');
});

test('session registry deduplicates host keys and rekeys an app rename atomically', async () => {
  const core = await importBundledPackage('@mdular/core');
  const adapter = createAdapter(async () => {
    throw new Error('not used');
  });
  const initial = createSnapshot(core);
  const registry = new core.SessionRegistry();
  const session = registry.open(initial, adapter);

  assert.equal(registry.open(initial, adapter), session);
  session.attachPane('primary');
  assert.equal(registry.release(initial.pathKey), false);
  session.detachPane('primary');

  const renamed = createSnapshot(core, {
    path: 'notes/renamed.md',
    pathKey: 'workspace:notes/renamed.md',
    content: initial.content,
    revision: 'revision-1',
  });
  assert.equal(registry.rekeyAfterHostRename(initial.pathKey, renamed), session);
  assert.equal(registry.get(initial.pathKey), undefined);
  assert.equal(registry.get(renamed.pathKey), session);
  assert.equal(session.state.path, renamed.path);
  assert.equal(registry.release(renamed.pathKey), true);
});

function createPluginServices() {
  return {
    commands: {
      register: () => ({ dispose() {} }),
      execute: async () => undefined,
    },
    workspace: {
      readMarkdown: async () => '',
      writeMarkdown: async () => {},
      listMarkdown: async () => [],
      watchMarkdown: () => ({ dispose() {} }),
    },
    navigation: {
      openMarkdown: async () => {},
    },
    views: {
      setState() {},
      onAction: () => ({ dispose() {} }),
      reveal: async () => {},
    },
    logger: {
      debug() {},
      info() {},
      warn() {},
      error() {},
    },
  };
}

function createManifest(id) {
  return {
    schemaVersion: 1,
    id,
    name: id,
    version: '0.0.0',
    entry: 'index.js',
  };
}

test('plugin manifest validation accepts only known permissions and entry basenames', async () => {
  const manifestApi = await importBundledPackage('@mdular/plugin-manifest');
  const valid = {
    ...createManifest('test.manifest'),
    permissions: [
      'documents.editActive',
      'documents.readActive',
      'ui.documentHeader',
      'storage.workspace',
    ],
    contributes: {
      documentHeaders: [{ id: 'metadata', title: 'Metadata' }],
    },
  };
  assert.equal(manifestApi.validatePluginManifest(valid).ok, true);

  const editWithoutRead = manifestApi.validatePluginManifest({
    ...createManifest('test.edit-only'),
    permissions: ['documents.editActive'],
  });
  assert.equal(editWithoutRead.ok, false);
  assert.match(editWithoutRead.errors.join('; '), /requires documents\.readActive/u);

  const textEditWithoutRead = manifestApi.validatePluginManifest({
    ...createManifest('test.text-edit-only'),
    permissions: ['workspace.modifyText'],
  });
  assert.equal(textEditWithoutRead.ok, false);
  assert.match(textEditWithoutRead.errors.join('; '), /requires workspace\.readText/u);

  const unknown = manifestApi.validatePluginManifest({
    ...valid,
    permissions: [...valid.permissions, 'workspace.everything'],
  });
  assert.equal(unknown.ok, false);
  assert.match(unknown.errors.join('; '), /unknown/u);

  const pathEntry = manifestApi.validatePluginManifest({
    ...valid,
    entry: '../remote/plugin.js',
  });
  assert.equal(pathEntry.ok, false);
  assert.match(pathEntry.errors.join('; '), /basename/u);

  const missingHeaderPermission = manifestApi.validatePluginManifest({
    ...valid,
    permissions: ['documents.readActive', 'storage.workspace'],
  });
  assert.equal(missingHeaderPermission.ok, false);
  assert.match(missingHeaderPermission.errors.join('; '), /require ui\.documentHeader/u);
});

test('desktop plugin host grants only declared and host-approved services', async () => {
  const { DesktopPluginHost } = await importBundledPackage('@mdular/desktop-plugin-host');
  const marker = { marker: true };
  const host = new DesktopPluginHost({
    documents: { createService: () => marker },
    headers: { createService: () => marker },
    storage: { createService: () => marker },
    grantedPermissions: new Set(['documents.readActive', 'ui.documentHeader']),
  });
  const services = host.createServices({
    ...createManifest('test.permissions'),
    permissions: ['documents.readActive', 'ui.documentHeader', 'storage.workspace'],
  });
  assert.equal(services.documents, marker);
  assert.equal(services.ui, marker);
  assert.equal(services.storage, undefined);
  assert.ok(services.logger);

  const undeclared = host.createServices({
    ...createManifest('test.undeclared'),
    permissions: [],
  });
  assert.equal(undeclared.documents, undefined);
  assert.equal(undeclared.ui, undefined);
});

test('Docs Metadata fails in isolation when a required permission is missing', async () => {
  const { InProcessPluginRuntime } = await importBundledPackage('@mdular/plugin-runtime');
  const { DesktopPluginHost } = await importBundledPackage('@mdular/desktop-plugin-host');
  const docs = await importBundledPackage('@mdular/plugin-docs');
  const host = new DesktopPluginHost({
    documents: { createService: () => ({ getActiveSnapshot: () => null }) },
    extensions: {
      createService: () => ({
        register: () => ({ dispose() {} }),
        list: () => [],
        onDidChange: () => ({ dispose() {} }),
      }),
      releasePlugin() {},
    },
    headers: { createService: () => ({ registerDocumentHeaderProvider: () => ({ dispose() {} }) }) },
    storage: { createService: () => ({}) },
  });
  const runtime = new InProcessPluginRuntime(host);
  const manifest = {
    ...docs.pluginManifest,
    permissions: docs.pluginManifest.permissions.filter(
      (permission) => 'storage.workspace' !== permission,
    ),
  };
  const hash = `sha256:${'e'.repeat(64)}`;
  const result = await runtime.activateBundledCatalog([{
    manifest,
    entry: manifest.entry,
    contentHash: hash,
    load: async () => ({
      default: docs.default,
      pluginManifest: manifest,
      pluginContentHash: hash,
    }),
  }]);
  assert.equal(result[0].kind, 'disabled');
  assert.match(result[0].message, /storage\.workspace/u);
  assert.deepEqual(runtime.listActivePluginIds(), []);
  assert.deepEqual(runtime.listDisabledPluginIds(), [manifest.id]);
});

test('Docs controller reads, navigates, round-trips the active buffer and provides Chat To Docs', async () => {
  const docs = await importBundledPackage('@mdular/plugin-docs');
  let active = {
    path: 'docs/Guide.md',
    content: [
      '---',
      '# keep this comment',
      'title: Old title',
      'custom: keep-me',
      '---',
      '# Heading',
      'Body <script>stays text</script>.',
      '',
    ].join('\n'),
    revision: 'revision-1',
    bufferVersion: 0,
    dirty: false,
  };
  const commands = new Map();
  const contributions = [];
  const subscriptions = [];
  const states = [];
  const planned = new Map();
  let nextPlan = 1;
  let viewListener = null;
  let appliedContent = null;
  let readerBlock = null;
  const context = {
    pluginId: 'mdular.docs',
    subscriptions: {
      add(disposable) { subscriptions.push(disposable); return disposable; },
    },
    commands: {
      register(id, handler) {
        commands.set(id, handler);
        return { dispose: () => commands.delete(id) };
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
  const documents = {
    getActiveSnapshot: () => active,
    applyActiveEdit: async (edit) => {
      if (edit.expectedBufferVersion !== active.bufferVersion) {
        return { status: 'stale', current: active };
      }
      appliedContent = edit.content;
      active = { ...active, content: edit.content, bufferVersion: active.bufferVersion + 1, dirty: true };
      return { status: 'applied', snapshot: active };
    },
    onDidOpen: () => ({ dispose() {} }),
    onDidChange: () => ({ dispose() {} }),
    onDidSave: () => ({ dispose() {} }),
    onDidActivatePane: () => ({ dispose() {} }),
  };
  const extensions = {
    register(pointId, contribution) {
      contributions.push({ pointId, contribution });
      return { dispose() {} };
    },
    list: () => [],
    onDidChange: () => ({ dispose() {} }),
  };
  const views = {
    setState(_viewId, state) { states.push(state); },
    onAction(_viewId, listener) { viewListener = listener; return { dispose() {} }; },
    reveal: async () => {},
    revealReaderBlock(_viewId, blockId) { readerBlock = blockId; },
    hide() {},
  };
  const workspace = {
    readMarkdown: async (path) => {
      if ('docs/Other.md' === path) { return '---\ntitle: Other\n---\n# Other\n'; }
      throw new Error(`missing fixture: ${path}`);
    },
    listMarkdown: async () => ['docs/Other.md'],
    watchMarkdown: () => ({ dispose() {} }),
    planTextWrites: async (operations, policy) => {
      const planId = `plan-${nextPlan++}`;
      planned.set(planId, operations);
      return {
        planId,
        policy,
        entries: operations.map(({ path, content }) => ({
          path,
          bytes: content.length,
          disposition: 'create',
        })),
      };
    },
    commitTextWritePlan: async (planId) => ({
      status: 'complete',
      created: planned.get(planId).map(({ path }) => path),
      skipped: [],
    }),
  };
  const controller = new docs.DocsController(context, {
    documents,
    extensions,
    navigation: { openMarkdown: async () => {} },
    views,
    workspace,
  });
  controller.start();
  assert.equal(planned.size, 0, 'activation must not write workspace content');
  await commands.get(docs.DOCS_COMMANDS.openReader)([]);
  assert.equal(states.at(-1).kind, 'reader');
  assert.equal(states.at(-1).title, 'Old title');
  assert.equal(states.at(-1).blocks.some((block) =>
    'paragraph' === block.kind && block.text.includes('<script>')
  ), true);

  await commands.get(docs.DOCS_COMMANDS.openOutline)([]);
  assert.equal(states.at(-1).kind, 'collection');
  const headingId = states.at(-1).items[0].id;
  await viewListener({ type: 'activate', payload: { id: headingId } });
  assert.equal(states.at(-1).kind, 'reader');
  assert.equal(readerBlock, headingId);

  await commands.get(docs.DOCS_COMMANDS.editFrontmatter)([]);
  assert.equal(states.at(-1).title, 'Frontmatter · docs/Guide.md');
  await viewListener({ type: 'field', payload: { id: 'title', value: 'New title' } });
  await viewListener({ type: 'field', payload: { id: 'status', value: 'ready' } });
  await viewListener({ type: 'command', payload: { id: 'preview-frontmatter' } });
  assert.ok(states.at(-1).fields.some(({ id }) => 'preview' === id));
  await viewListener({ type: 'command', payload: { id: 'apply-frontmatter' } });
  assert.match(appliedContent, /# keep this comment/u);
  assert.match(appliedContent, /custom: keep-me/u);
  assert.match(appliedContent, /title: New title/u);
  assert.match(appliedContent, /status: ready/u);
  assert.match(appliedContent, /# Heading\nBody <script>stays text<\/script>\./u);
  assert.equal(planned.size, 0, 'frontmatter edits stay in the Core editor buffer');

  const archive = contributions.find(({ pointId }) =>
    'mdular.chat.archive-targets' === pointId
  )?.contribution;
  assert.ok(archive);
  const archived = await archive.execute({ schemaVersion: 1, text: 'Archived title\nArchived body' });
  assert.equal(archived.path, 'docs/Archived title.md');
  const archiveOperation = [...planned.values()].at(-1)[0];
  assert.equal(archiveOperation.path, archived.path);
  assert.match(archiveOperation.content, /^---\ntitle: Archived title\ndate: \d{4}-\d{2}-\d{2}\ntags:\n---/u);
  assert.match(archiveOperation.content, /Archived body\n$/u);

  await commands.get(docs.DOCS_COMMANDS.browse)([]);
  assert.equal(states.at(-1).title, 'Browse Docs');
  assert.deepEqual(states.at(-1).items.map(({ id }) => id), ['docs/Other.md']);
  controller.dispose();
});

test('generated official catalog lists all allowlisted assets and loads Docs with matching identity', async () => {
  const { InProcessPluginRuntime } = await importBundledPackage('@mdular/plugin-runtime');
  const catalogUrl = pathToFileURL(
    resolve(projectRoot, 'web/v2/bundled-plugin-catalog.js'),
  ).href;
  const generated = await import(`${catalogUrl}?fixture=${Date.now()}`);
  assert.deepEqual(
    generated.bundledPluginCatalog.map((candidate) => candidate.manifest.id),
    [
      'mdular.docs',
      'mdular.search',
      'mdular.templates',
      'mdular.chat',
      'mdular.extended-markdown',
      'mdular.media',
      'mdular.kanban',
      'mdular.vcs',
    ],
  );
  const entry = generated.bundledPluginCatalog.find(
    (candidate) => 'mdular.docs' === candidate.manifest.id,
  );
  assert.ok(entry);
  assert.equal(entry.manifest.id, 'mdular.docs');
  assert.equal(entry.entry, 'docs.js');
  assert.match(entry.contentHash, /^sha256:[a-f0-9]{64}$/u);
  assert.match(entry.load.toString(), /\.\/plugins\/docs\.js/u);
  let providerCount = 0;
  const runtime = new InProcessPluginRuntime({
    createServices: () => ({
      commands: {
        register: () => ({ dispose() {} }),
        execute: async () => undefined,
      },
      documents: {
        getActiveSnapshot: () => null,
        applyActiveEdit: async () => ({ status: 'stale', current: null }),
        onDidOpen: () => ({ dispose() {} }),
        onDidChange: () => ({ dispose() {} }),
        onDidSave: () => ({ dispose() {} }),
        onDidActivatePane: () => ({ dispose() {} }),
      },
      extensions: {
        register: () => ({ dispose() {} }),
        list: () => [],
        onDidChange: () => ({ dispose() {} }),
      },
      ui: {
        registerDocumentHeaderProvider() {
          providerCount += 1;
          return { dispose: () => { providerCount -= 1; } };
        },
      },
      storage: {
        get: async () => ({ ok: true, value: null }),
        set: async () => ({ ok: true, value: null }),
        remove: async () => ({ ok: true, value: null }),
      },
      navigation: { openMarkdown: async () => {} },
      views: {
        setState() {},
        onAction: () => ({ dispose() {} }),
        reveal: async () => {},
        revealReaderBlock() {},
        hide() {},
      },
      workspace: {
        readMarkdown: async () => '',
        listMarkdown: async () => [],
        watchMarkdown: () => ({ dispose() {} }),
        planTextWrites: async () => ({ planId: 'fixture', policy: 'skip-existing', entries: [] }),
        commitTextWritePlan: async () => ({ status: 'complete', created: [], skipped: [] }),
      },
    }),
  });
  assert.deepEqual(await runtime.activateBundledCatalog([entry]), [{
    pluginId: 'mdular.docs',
    kind: 'active',
  }]);
  assert.equal(providerCount, 1);
  await runtime.deactivate('mdular.docs');
  assert.equal(providerCount, 0);
});

test('bundled plugin discovery validates identity and keeps failed plugins disabled', async () => {
  const { InProcessPluginRuntime } = await importBundledPackage('@mdular/plugin-runtime');
  const hash = `sha256:${'a'.repeat(64)}`;
  const manifest = createManifest('test.catalog');
  let loadCount = 0;
  const runtime = new InProcessPluginRuntime({
    createServices: () => createPluginServices(),
  });
  const plugin = { activate() {} };
  const validCatalog = [{
    manifest,
    entry: manifest.entry,
    contentHash: hash,
    async load() {
      loadCount += 1;
      return { default: plugin, pluginManifest: manifest, pluginContentHash: hash };
    },
  }];
  assert.deepEqual(await runtime.activateBundledCatalog(validCatalog), [{
    pluginId: manifest.id,
    kind: 'active',
  }]);
  await runtime.disable(manifest.id);
  const loadsWhileDisabled = loadCount;
  assert.equal((await runtime.activateBundledCatalog(validCatalog))[0].kind, 'disabled');
  assert.equal(loadCount, loadsWhileDisabled);
  runtime.enable(manifest.id);
  assert.equal((await runtime.activateBundledCatalog(validCatalog))[0].kind, 'active');
  const loadsWhileActive = loadCount;
  assert.equal((await runtime.activateBundledCatalog(validCatalog))[0].kind, 'active');
  assert.equal(loadCount, loadsWhileActive, 'active discovery must be idempotent');
  await runtime.deactivate(manifest.id);

  const mismatch = createManifest('test.hash-mismatch');
  const mismatchCatalog = [{
    manifest: mismatch,
    entry: mismatch.entry,
    contentHash: hash,
    async load() {
      loadCount += 1;
      return {
        default: plugin,
        pluginManifest: mismatch,
        pluginContentHash: `sha256:${'b'.repeat(64)}`,
      };
    },
  }];
  const failed = await runtime.activateBundledCatalog(mismatchCatalog);
  assert.equal(failed[0].kind, 'disabled');
  assert.match(failed[0].message, /content hash/u);
  assert.deepEqual(runtime.listDisabledPluginIds(), [mismatch.id]);
  assert.equal(runtime.listDiagnostics().at(-1).phase, 'catalog');
  const loadsBeforeRetry = loadCount;
  const retry = await runtime.activateBundledCatalog(mismatchCatalog);
  assert.equal(retry[0].kind, 'disabled');
  assert.equal(loadCount, loadsBeforeRetry, 'a failed plugin must not silently reactivate');
});

test('provider failure disables a plugin and disposes all owned subscriptions', async () => {
  const { InProcessPluginRuntime } = await importBundledPackage('@mdular/plugin-runtime');
  const events = [];
  const runtime = new InProcessPluginRuntime({
    createServices: () => createPluginServices(),
  });
  const manifest = createManifest('test.provider-failure');
  await runtime.activate(manifest, {
    activate(context) {
      context.subscriptions.add({ dispose: () => events.push('disposed') });
    },
    deactivate() { events.push('deactivated'); },
  });

  await runtime.reportFailure(manifest.id, 'provider', new Error('provider crashed'));
  assert.deepEqual(events, ['deactivated', 'disposed']);
  assert.equal(runtime.getState(manifest.id), undefined);
  assert.deepEqual(runtime.listDisabledPluginIds(), [manifest.id]);
  assert.deepEqual(runtime.listDiagnostics(), [{
    pluginId: manifest.id,
    phase: 'provider',
    message: 'provider crashed',
  }]);
});

test('plugin runtime owns lifecycle and disposes subscriptions in reverse order', async () => {
  const { InProcessPluginRuntime } = await importBundledPackage('@mdular/plugin-runtime');
  const events = [];
  const runtime = new InProcessPluginRuntime({
    createServices: () => createPluginServices(),
  });
  const manifest = createManifest('test.lifecycle');
  const plugin = {
    activate(context) {
      context.subscriptions.add({ dispose: () => events.push('first subscription') });
      return { dispose: () => events.push('activation result') };
    },
    deactivate() {
      events.push('module deactivate');
    },
  };

  await runtime.activate(manifest, plugin);
  assert.equal(runtime.getState(manifest.id), 'active');
  assert.deepEqual(runtime.listActivePluginIds(), [manifest.id]);
  await assert.rejects(runtime.activate(manifest, plugin), /already active/u);

  await runtime.deactivate(manifest.id);
  assert.equal(runtime.getState(manifest.id), undefined);
  assert.deepEqual(events, [
    'module deactivate',
    'activation result',
    'first subscription',
  ]);
});

test('failed plugin activation rolls back collected subscriptions', async () => {
  const { InProcessPluginRuntime } = await importBundledPackage('@mdular/plugin-runtime');
  const events = [];
  const runtime = new InProcessPluginRuntime({
    createServices: () => createPluginServices(),
  });
  const manifest = createManifest('test.rollback');

  await assert.rejects(
    runtime.activate(manifest, {
      activate(context) {
        context.subscriptions.add({ dispose: () => events.push('cleanup') });
        throw new Error('activation failed');
      },
    }),
    /activation failed/u,
  );

  assert.deepEqual(events, ['cleanup']);
  assert.equal(runtime.getState(manifest.id), undefined);
});

test('deactivateAll follows reverse activation order', async () => {
  const { InProcessPluginRuntime } = await importBundledPackage('@mdular/plugin-runtime');
  const events = [];
  const runtime = new InProcessPluginRuntime({
    createServices: () => createPluginServices(),
  });

  for (const id of ['test.first', 'test.second']) {
    await runtime.activate(createManifest(id), {
      activate: () => {},
      deactivate: () => events.push(id),
    });
  }
  await runtime.deactivateAll();

  assert.deepEqual(events, ['test.second', 'test.first']);
  assert.deepEqual(runtime.listActivePluginIds(), []);
});

test('Search index covers path, body, frontmatter, highlighting and hard budgets', async () => {
  const search = await importBundledPackage('@mdular/plugin-search');
  const index = new search.SearchIndex();
  assert.equal(index.upsert(
    'Roadmap.md',
    '---\nstatus: active\ntags:\n  - release\n  - urgent\n---\nShip the lunar release.',
  ).indexed, true);
  assert.equal(index.upsert(
    'docs/Design.md',
    '---\nstatus: draft\nauthor: C\n---\nArchitecture body.',
  ).indexed, true);
  assert.equal(index.upsert('docs/Notes.md', 'Plain body contains moonlight here.').indexed, true);
  assert.equal(index.upsert('docs/nested/Deep.md', 'Nested body.').indexed, true);
  assert.equal(index.upsert('archive/Roadmap old.md', 'Old roadmap.').indexed, true);

  assert.deepEqual(index.search('moonlight').map(({ path }) => path), ['docs/Notes.md']);
  assert.ok(0 < index.search('moonlight')[0].descriptionHighlights.length);
  assert.deepEqual(index.search('#urgent').map(({ path }) => path), ['Roadmap.md']);
  assert.deepEqual(
    index.search('status:draft in:docs').map(({ path }) => path),
    ['docs/Design.md'],
  );
  assert.deepEqual(
    index.search('docs/').map(({ path }) => path),
    ['docs/Design.md', 'docs/Notes.md'],
  );
  assert.deepEqual(index.search('docs Design').map(({ path }) => path), ['docs/Design.md']);
  assert.equal(index.search('Roadmap')[0].path, 'Roadmap.md');

  assert.equal(index.upsert('../escape.md', 'no').reason, 'invalid-path');
  assert.equal(
    index.upsert('oversized.md', 'x'.repeat(search.SEARCH_INDEX_LIMITS.maxDocumentBytes + 1)).reason,
    'document-size',
  );
  const cache = index.exportCache();
  const restored = new search.SearchIndex();
  assert.equal(restored.importCache(cache), true);
  assert.deepEqual(restored.search('moonlight').map(({ path }) => path), ['docs/Notes.md']);
  assert.equal(restored.importCache({ documents: [{ path: '../bad.md', content: 'bad' }] }), false);
  assert.deepEqual(restored.search('moonlight').map(({ path }) => path), ['docs/Notes.md']);
});

test('desktop plugin command and declarative view hosts clean up shortcuts and render text safely', async () => {
  const { DesktopPluginCommandHost } = await importBundledPackage(
    '@mdular/desktop-plugin-commands',
  );
  const { DesktopPluginViewHost } = await importBundledPackage('@mdular/desktop-plugin-views');
  const keyListeners = new Set();
  const fakeWindow = {
    addEventListener(name, listener) { if ('keydown' === name) { keyListeners.add(listener); } },
    removeEventListener(name, listener) { if ('keydown' === name) { keyListeners.delete(listener); } },
  };
  const document = {
    createElement(tagName) {
      const created = createFakeElement(tagName);
      Object.defineProperty(created, 'innerHTML', {
        set() { throw new Error('innerHTML must not be used'); },
      });
      return created;
    },
  };
  const commandContainer = createFakeElement('div');
  let executions = 0;
  const commandHost = new DesktopPluginCommandHost({
    document,
    window: fakeWindow,
    container: commandContainer,
    onFailure() {},
  });
  const commandManifest = {
    ...createManifest('test.search-command'),
    permissions: ['commands'],
    contributes: {
      commands: [{
        id: 'test.search.open',
        title: 'Search',
        defaultKeybindings: ['Mod+K'],
      }],
    },
  };
  const commands = commandHost.createService(commandManifest);
  commands.register('test.search.open', () => { executions += 1; });
  assert.equal(commandHost.commandCount(), 1);
  assert.equal(commandContainer.children.length, 1);
  const event = {
    key: 'k',
    metaKey: true,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    stopPropagation() {},
  };
  for (const listener of keyListeners) { listener(event); }
  await settleAsyncWork();
  assert.equal(executions, 1);
  assert.equal(event.defaultPrevented, true);
  commandHost.releasePlugin(commandManifest.id);
  assert.equal(commandHost.commandCount(), 0);
  assert.equal(commandContainer.children.length, 0);
  commandHost.dispose();
  assert.equal(keyListeners.size, 0);

  const viewContainer = createFakeElement('div');
  const viewHost = new DesktopPluginViewHost({ document, container: viewContainer, onFailure() {} });
  const viewManifest = {
    ...createManifest('test.search-view'),
    permissions: ['ui.views'],
    contributes: {
      views: [{ id: 'results', title: 'Results', location: 'editor-pane' }],
    },
  };
  const views = viewHost.createService(viewManifest);
  const actions = [];
  views.onAction('results', (action) => { actions.push(action); });
  views.setState('results', {
    schemaVersion: 1,
    kind: 'collection',
    title: '<img src=x onerror=alert(1)>',
    input: { value: '<script>', ariaLabel: 'Unsafe fixture' },
    fields: [
      {
        id: 'path',
        kind: 'text',
        label: '<b>Path</b>',
        value: '<img src=x>',
        submitActionId: 'submit',
      },
      {
        id: 'mode',
        kind: 'select',
        label: 'Mode',
        value: 'safe',
        options: [{ value: 'safe', label: '<script>safe</script>' }],
      },
    ],
    actions: [{ id: 'preview', label: '<img>Preview</img>', tone: 'primary' }],
    dismissOnActivate: true,
    items: [{
      id: 'notes/xss.md',
      title: '<script>alert(1)</script>',
      description: '<img src=x onerror=alert(1)>',
      titleHighlights: [{ start: 0, end: 8 }],
      selected: true,
      appearance: 'completed',
      actions: [{ id: 'done', label: '<b>Done</b>' }],
    }],
  });
  await views.reveal('results');
  const findByDataset = (key, value) => {
    const pending = [...viewContainer.children];
    while (pending.length) {
      const candidate = pending.shift();
      if (value === candidate.dataset?.[key]) { return candidate; }
      pending.push(...(candidate.children ?? []));
    }
    return null;
  };
  const pathField = findByDataset('pluginFieldId', 'path');
  assert.ok(pathField);
  pathField.value = '<svg onload=alert(1)>';
  pathField.dispatch('input');
  pathField.dispatch('keydown', {
    key: 'Enter',
    shiftKey: false,
    isComposing: false,
    preventDefault() {},
  });
  const previewButton = findByDataset('actionId', 'preview');
  assert.ok(previewButton);
  previewButton.dispatch('click');
  const itemAction = findByDataset('itemActionId', 'done');
  assert.ok(itemAction);
  itemAction.dispatch('click', { stopPropagation() {} });
  const itemButton = (() => {
    const pending = [...viewContainer.children];
    while (pending.length) {
      const candidate = pending.shift();
      if ('notes/xss.md' === candidate.dataset?.itemId) { return candidate; }
      pending.push(...(candidate.children ?? []));
    }
    return null;
  })();
  assert.ok(itemButton);
  itemButton.dispatch('click');
  assert.deepEqual(actions, [
    { type: 'field', payload: { id: 'path', value: '<svg onload=alert(1)>' } },
    { type: 'command', payload: { id: 'submit' } },
    { type: 'command', payload: { id: 'preview' } },
    { type: 'item-command', payload: { id: 'notes/xss.md', actionId: 'done' } },
    { type: 'activate', payload: { id: 'notes/xss.md' } },
  ]);
  assert.equal(viewContainer.children[0].hidden, true);
  viewHost.releasePlugin(viewManifest.id);
  assert.equal(viewHost.viewCount(), 0);
  viewHost.dispose();
  assert.equal(viewContainer.children.length, 0);
});

test('declarative reader renders text safely, resolves workspace images and releases lightbox leases', async () => {
  const { DesktopPluginViewHost } = await importBundledPackage('@mdular/desktop-plugin-views');
  const document = {
    createElement(tagName) {
      const created = createFakeElement(tagName);
      Object.defineProperty(created, 'innerHTML', {
        set() { throw new Error('innerHTML must not be used'); },
      });
      return created;
    },
  };
  const container = createFakeElement('div');
  const acquired = [];
  const disposed = [];
  const host = new DesktopPluginViewHost({
    document,
    container,
    onFailure() {},
    imageResolver: {
      async acquire(path) {
        acquired.push(path);
        return { url: `blob:${path}`, dispose: () => { disposed.push(path); } };
      },
    },
  });
  const manifest = {
    ...createManifest('test.reader-view'),
    permissions: ['ui.views'],
    contributes: { views: [{ id: 'reader', title: 'Reader', location: 'editor-pane' }] },
  };
  const views = host.createService(manifest);
  views.setState('reader', {
    schemaVersion: 1,
    kind: 'reader',
    title: '<script>Reader</script>',
    sourcePath: 'docs/read.md',
    cover: {
      path: 'assets/cover.png',
      alt: '<img onerror=alert(1)>',
      presentation: 'cover',
      focusX: 20,
      focusY: 80,
    },
    outline: [{ id: 'heading-1', label: '<b>Heading</b>', level: 1 }],
    blocks: [
      { id: 'heading-1', kind: 'heading', level: 1, text: '<b>Heading</b>' },
      { id: 'paragraph-2', kind: 'paragraph', text: '<script>alert(1)</script>' },
      {
        id: 'image-3',
        kind: 'image',
        image: { path: 'assets/diagram.webp', alt: 'Diagram', presentation: 'content' },
      },
    ],
    actions: [{ id: 'refresh', label: 'Refresh' }],
  });
  await views.reveal('reader');
  await settleAsyncWork();
  assert.deepEqual(acquired, ['assets/cover.png', 'assets/diagram.webp']);
  assert.equal(findFakeElementByTag(container, 'h1').textContent, '<b>Heading</b>');
  assert.equal(findFakeElementByTag(container, 'script'), null);
  const readyImage = (() => {
    const pending = [...container.children];
    while (pending.length) {
      const candidate = pending.shift();
      if ('ready' === candidate.dataset?.state) { return candidate; }
      pending.push(...(candidate.children ?? []));
    }
    return null;
  })();
  assert.ok(readyImage);
  findFakeElementByClass(readyImage, 'v2-plugin-workspace-image-trigger').dispatch('click', {
    stopPropagation() {},
  });
  assert.equal(findFakeElementByClass(container, 'v2-plugin-image-lightbox').hidden, false);
  views.hide('reader');
  assert.deepEqual(disposed.sort(), ['assets/cover.png', 'assets/diagram.webp']);
  assert.equal(findFakeElementByClass(container, 'v2-plugin-image-lightbox').hidden, true);
  host.dispose();
});

test('workspace image cache deduplicates mtime keys, caps concurrency and revokes object URLs', async () => {
  const assets = await importBundledPackage('@mdular/desktop-plugin-assets');
  let modified = 1;
  let reads = 0;
  const revoked = [];
  const host = new assets.DesktopPluginAssetHost({
    bridge: {
      invoke: async (command) => {
        if ('workspace_file_mtime' === command) { return modified; }
        if ('workspace_read_plugin_image' === command) {
          reads += 1;
          return { contentBase64: 'aGk=', lastModifiedMs: modified };
        }
        throw new Error(`unexpected command: ${command}`);
      },
    },
    createObjectUrl: (_bytes, mime) => `blob:${mime}:${reads}`,
    revokeObjectUrl: (url) => { revoked.push(url); },
  });
  const first = await host.acquire('assets/cover.png');
  const second = await host.acquire('assets/cover.png');
  assert.equal(reads, 1);
  assert.equal(first.url, second.url);
  first.dispose();
  second.dispose();
  modified = 2;
  const refreshed = await host.acquire('assets/cover.png');
  assert.equal(reads, 2);
  assert.notEqual(refreshed.url, first.url);
  refreshed.dispose();
  await assert.rejects(() => host.acquire('../escape.png'), /escapes|invalid/u);
  await assert.rejects(() => host.acquire('assets/vector.svg'), /unsupported/u);
  host.notifyWorkspaceReset();
  assert.equal(host.cacheStats().entries, 0);
  assert.deepEqual(revoked.sort(), ['blob:image/png:1', 'blob:image/png:2']);
  host.dispose();

  let active = 0;
  let maximum = 0;
  const releases = [];
  const concurrent = new assets.DesktopPluginAssetHost({
    bridge: {
      invoke: async (command) => {
        if ('workspace_file_mtime' === command) { return 1; }
        active += 1;
        maximum = Math.max(maximum, active);
        return new Promise((resolvePayload) => {
          releases.push(() => {
            active -= 1;
            resolvePayload({ contentBase64: 'aGk=', lastModifiedMs: 1 });
          });
        });
      },
    },
    createObjectUrl: (_bytes, mime) => `blob:${mime}:${releases.length}`,
    revokeObjectUrl() {},
  });
  const pending = ['a', 'b', 'c', 'd'].map((name) => concurrent.acquire(`assets/${name}.png`));
  await settleAsyncWork();
  assert.equal(releases.length, 3);
  assert.equal(maximum, assets.PLUGIN_IMAGE_CACHE_LIMITS.maxConcurrentLoads);
  releases[0]();
  await settleAsyncWork();
  assert.equal(releases.length, 4);
  releases.slice(1).forEach((release) => release());
  const leases = await Promise.all(pending);
  leases.forEach((lease) => lease.dispose());
  concurrent.dispose();
});

test('desktop plugin workspace host scopes Markdown reads and diffs external inventory changes', async () => {
  const { DesktopPluginWorkspaceHost } = await importBundledPackage(
    '@mdular/desktop-plugin-workspace',
  );
  let inventory = [
    { relative_path: 'docs/A.md', last_modified_ms: 1 },
    { relative_path: 'docs/asset.png', last_modified_ms: 1 },
  ];
  const contents = new Map([['docs/A.md', 'alpha']]);
  const timers = new Map();
  let nextTimer = 1;
  const host = new DesktopPluginWorkspaceHost({
    bridge: {
      invoke: async (command) => {
        assert.equal(command, 'workspace_list_files');
        return inventory;
      },
    },
    workspaceAdapter: {
      read: async (path) => contents.has(path)
        ? { ok: true, snapshot: { content: contents.get(path) } }
        : { ok: false, error: { kind: 'not-found', message: 'missing' } },
    },
    window: {
      setTimeout(task) {
        const id = nextTimer++;
        timers.set(id, task);
        return id;
      },
      clearTimeout(id) { timers.delete(id); },
    },
    onFailure() {},
  });
  const service = host.createService('test.search-workspace', { read: true, watch: true });
  assert.deepEqual(await service.listMarkdown('docs'), ['docs/A.md']);
  assert.deepEqual(await service.listMarkdownEntries('docs'), [
    { path: 'docs/A.md', lastModifiedMs: 1 },
  ]);
  assert.equal(await service.readMarkdown('docs/A.md'), 'alpha');
  await assert.rejects(() => service.readMarkdown('docs/asset.png'), /limited to Markdown/u);
  await assert.rejects(() => service.readMarkdown('../escape.md'), /Invalid workspace path/u);

  const changes = [];
  service.watchMarkdown((change) => { changes.push(change); });
  assert.equal(host.watcherCount('test.search-workspace'), 1);
  await host.pollNow();
  inventory = [
    { relative_path: 'docs/A.md', last_modified_ms: 2 },
    { relative_path: 'docs/B.md', last_modified_ms: 1 },
  ];
  await host.pollNow();
  assert.deepEqual(changes, [
    { path: 'docs/A.md', kind: 'changed' },
    { path: 'docs/B.md', kind: 'created' },
  ]);
  inventory = [{ relative_path: 'docs/Renamed.md', last_modified_ms: 3 }];
  await host.pollNow();
  assert.deepEqual(changes.slice(2), [
    { path: 'docs/A.md', kind: 'deleted' },
    { path: 'docs/B.md', kind: 'deleted' },
    { path: 'docs/Renamed.md', kind: 'created' },
  ]);
  host.notifyWorkspaceReset();
  assert.deepEqual(changes.at(-1), { kind: 'reset' });
  host.releasePlugin('test.search-workspace');
  assert.equal(host.watcherCount(), 0);
  assert.equal(timers.size, 0);
  host.dispose();
});

test('desktop plugin extension host isolates providers, consumers and lifecycle cleanup', async () => {
  const { DesktopPluginExtensionHost } = await importBundledPackage(
    '@mdular/desktop-plugin-extensions',
  );
  const failures = [];
  const host = new DesktopPluginExtensionHost((...args) => { failures.push(args); });
  const provider = host.createService('test.provider', { register: true, consume: false });
  const consumer = host.createService('test.consumer', { register: false, consume: true });
  let changes = 0;
  consumer.onDidChange('test.point', () => { changes += 1; });
  const later = provider.register('test.point', {
    id: 'later',
    label: 'Later',
    order: 20,
    data: { safe: '<script>' },
    execute: async (request) => ({ request }),
  });
  provider.register('test.point', { id: 'first', label: 'First', order: 10 });
  assert.equal(changes, 2);
  assert.deepEqual(consumer.list('test.point').map(({ id }) => id), ['first', 'later']);
  const executable = consumer.list('test.point')[1];
  assert.deepEqual(await executable.execute({ text: '<img>' }), {
    request: { text: '<img>' },
  });
  assert.throws(
    () => consumer.register('test.point', { id: 'bad', label: 'Bad' }),
    /may not register/u,
  );
  assert.throws(
    () => provider.list('test.point'),
    /may not consume/u,
  );
  assert.throws(
    () => provider.register('test.point', { id: 'first', label: 'Duplicate' }),
    /duplicated/u,
  );
  later.dispose();
  assert.equal(changes, 3);
  await assert.rejects(
    () => executable.execute({}),
    /no longer active/u,
  );

  provider.register('test.point', {
    id: 'throws',
    label: 'Throws',
    execute: () => { throw new Error('provider fixture'); },
  });
  const throwing = consumer.list('test.point').find(({ id }) => 'throws' === id);
  await assert.rejects(() => throwing.execute({}), /provider fixture/u);
  assert.equal(failures.length, 1);
  assert.equal(failures[0][0], 'test.provider');
  host.releasePlugin('test.provider');
  assert.equal(host.contributionCount(), 0);
  host.releasePlugin('test.consumer');
  host.dispose();
});

test('desktop plugin workspace edit tokens preserve optimistic Markdown conflicts', async () => {
  const core = await importBundledPackage('@mdular/core');
  const { DesktopPluginWorkspaceHost } = await importBundledPackage(
    '@mdular/desktop-plugin-workspace',
  );
  let snapshot = createSnapshot(core, {
    path: 'Chat.md',
    pathKey: 'workspace:Chat.md',
    content: 'saved\n',
    revision: 'revision-1',
  });
  let conflictOnce = true;
  const host = new DesktopPluginWorkspaceHost({
    bridge: { invoke: async () => [] },
    workspaceAdapter: {
      read: async () => ({ ok: true, snapshot }),
      async write(request) {
        if (conflictOnce) {
          conflictOnce = false;
          snapshot = createSnapshot(core, {
            path: 'Chat.md',
            pathKey: 'workspace:Chat.md',
            content: 'external\n',
            revision: 'revision-2',
          });
          return { ok: false, kind: 'conflict', current: snapshot };
        }
        snapshot = createSnapshot(core, {
          path: 'Chat.md',
          pathKey: 'workspace:Chat.md',
          content: request.content,
          revision: 'revision-3',
        });
        return { ok: true, snapshot };
      },
    },
    window: { setTimeout: () => 1, clearTimeout() {} },
    onFailure() {},
  });
  const service = host.createService('test.chat', {
    read: false,
    watch: false,
    modifyMarkdown: true,
  });
  const draft = await service.beginMarkdownEdit('Chat.md');
  assert.equal(draft.content, 'saved\n');
  const conflict = await service.commitMarkdownEdit(draft.editId, 'local\n');
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.current.content, 'external\n');
  await assert.rejects(
    () => service.commitMarkdownEdit(draft.editId, 'stale\n'),
    /edit is unknown/u,
  );
  const other = host.createService('test.other', {
    read: false,
    watch: false,
    modifyMarkdown: true,
  });
  await assert.rejects(
    () => other.commitMarkdownEdit(conflict.current.editId, 'stolen\n'),
    /edit is unknown/u,
  );
  assert.deepEqual(
    await service.commitMarkdownEdit(conflict.current.editId, 'external\nmerged\n'),
    { status: 'written', path: 'Chat.md', content: 'external\nmerged\n' },
  );
  const resetDraft = await service.beginMarkdownEdit('Chat.md');
  host.notifyWorkspaceReset();
  await assert.rejects(
    () => service.commitMarkdownEdit(resetDraft.editId, 'wrong workspace\n'),
    /edit is unknown/u,
  );
  host.dispose();
});

test('desktop plugin workspace host plans create-only text batches and owns safe rollback tokens', async () => {
  const { DesktopPluginWorkspaceHost } = await importBundledPackage(
    '@mdular/desktop-plugin-workspace',
  );
  const existing = new Set(['docs/existing.md']);
  const nativeCalls = [];
  const revision = `sha256:${'a'.repeat(64)}`;
  const host = new DesktopPluginWorkspaceHost({
    bridge: {
      async invoke(command, args) {
        nativeCalls.push({ command, args });
        if ('workspace_exists' === command) { return existing.has(args.relativePath); }
        if ('workspace_apply_text_batch' === command) {
          const operations = args.request.operations;
          if (operations.some((operation) => 'docs/fail.md' === operation.path)) {
            const created = [{ path: operations[0].path, revision }];
            existing.add(operations[0].path);
            return {
              status: 'partial',
              created,
              failed: {
                index: 1,
                path: 'docs/fail.md',
                kind: 'io-error',
                message: 'fixture failure',
              },
            };
          }
          for (const operation of operations) { existing.add(operation.path); }
          return {
            status: 'complete',
            created: operations.map((operation) => ({ path: operation.path, revision })),
          };
        }
        if ('workspace_rollback_text_batch' === command) {
          for (const receipt of args.request.receipts) { existing.delete(receipt.path); }
          return {
            removed: args.request.receipts.map((receipt) => receipt.path),
            retained: [],
          };
        }
        throw new Error(`Unexpected command: ${command}`);
      },
    },
    workspaceAdapter: {},
    window: { setTimeout: () => 1, clearTimeout() {} },
    onFailure() {},
  });
  const service = host.createService('test.templates', {
    read: false,
    watch: false,
    writeTextBatch: true,
  });
  const operations = [
    { path: 'docs/existing.md', content: 'keep' },
    { path: 'docs/new.md', content: 'new' },
  ];
  const blocked = await service.planTextWrites(operations, 'fail-if-existing');
  assert.deepEqual(blocked.entries.map(({ disposition }) => disposition), ['conflict', 'create']);
  await assert.rejects(() => service.commitTextWritePlan(blocked.planId), /unresolved conflicts/u);

  const plan = await service.planTextWrites(operations, 'skip-existing');
  assert.deepEqual(plan.entries.map(({ disposition }) => disposition), ['skip', 'create']);
  const committed = await service.commitTextWritePlan(plan.planId);
  assert.equal(committed.status, 'complete');
  assert.deepEqual(committed.created, ['docs/new.md']);
  assert.deepEqual(committed.skipped, ['docs/existing.md']);
  assert.ok(committed.rollbackId);
  const applyCall = nativeCalls.find(({ command }) => 'workspace_apply_text_batch' === command);
  assert.deepEqual(applyCall.args.request.operations, [{ path: 'docs/new.md', content: 'new' }]);

  const other = host.createService('test.other', {
    read: false,
    watch: false,
    writeTextBatch: true,
  });
  await assert.rejects(
    () => other.rollbackTextWrites(committed.rollbackId),
    /rollback is unknown/u,
  );
  assert.deepEqual(await service.rollbackTextWrites(committed.rollbackId), {
    removed: ['docs/new.md'],
    retained: [],
  });

  const partialPlan = await service.planTextWrites([
    { path: 'docs/first.md', content: 'first' },
    { path: 'docs/fail.md', content: 'fail' },
  ], 'fail-if-existing');
  const partial = await service.commitTextWritePlan(partialPlan.planId);
  assert.equal(partial.status, 'partial');
  assert.deepEqual(partial.created, ['docs/first.md']);
  assert.equal(partial.failed.path, 'docs/fail.md');
  assert.ok(partial.rollbackId);

  await assert.rejects(
    () => service.planTextWrites([{ path: '../escape.md', content: 'bad' }], 'fail-if-existing'),
    /Invalid workspace path/u,
  );
  await assert.rejects(
    () => service.planTextWrites([{ path: 'asset.png', content: 'bad' }], 'fail-if-existing'),
    /limited to Markdown, JSON, text and YAML/u,
  );
  await assert.rejects(
    () => service.planTextWrites([
      { path: 'same.md', content: 'a' },
      { path: 'SAME.md', content: 'b' },
    ], 'fail-if-existing'),
    /duplicated/u,
  );
  const released = await service.planTextWrites(
    [{ path: 'docs/released.md', content: 'x' }],
    'fail-if-existing',
  );
  host.releasePlugin('test.templates');
  await assert.rejects(() => service.commitTextWritePlan(released.planId), /plan is unknown/u);
  host.dispose();
});

test('Templates engine renders bounded variables and editable scaffold packages', async () => {
  const templates = await importBundledPackage('@mdular/plugin-templates');
  const frontmatter = templates.BUILTIN_DOCUMENT_TEMPLATES.find(
    (template) => 'builtin:frontmatter' === template.id,
  );
  assert.ok(frontmatter);
  const document = templates.renderDocumentOperation({
    path: 'notes/Moon.md',
    title: 'Moon\nReport',
    date: '2026-09-18',
    body: frontmatter.body,
  });
  assert.equal(document.path, 'notes/Moon.md');
  assert.match(document.content, /title: Moon Report/u);
  assert.match(document.content, /date: 2026-09-18/u);
  assert.throws(
    () => templates.renderTemplateBody('${secret}', {
      title: '', date: '', path: 'x.md', filename: 'x.md',
    }),
    /Unknown template variable: secret/u,
  );
  assert.throws(
    () => templates.renderDocumentOperation({
      path: '../escape.md', title: '', date: '2026-09-18', body: '',
    }),
    /invalid segment/u,
  );

  const packageDefinition = templates.parseScaffoldPackage(
    templates.DEFAULT_SCAFFOLD_PACKAGE_JSON,
  );
  const standard = templates.renderScaffoldOperations({
    packageDefinition,
    prefix: 'project',
    preset: 'standard',
    date: '2026-09-18',
  });
  assert.equal(standard.length, 6);
  assert.equal(standard[0].path, 'project/docs/README.md');
  assert.match(
    standard.find(({ path }) => path.endsWith('issues/README.md')).content,
    /date: 2026-09-18/u,
  );
  const docsOnly = templates.renderScaffoldOperations({
    packageDefinition,
    prefix: '',
    preset: 'docs-only',
    date: '2026-09-18',
  });
  assert.deepEqual(docsOnly.map(({ path }) => path), [
    'docs/README.md',
    'docs/design/README.md',
  ]);
  assert.throws(
    () => templates.parseScaffoldPackage(JSON.stringify({
      schemaVersion: 1,
      name: 'duplicate',
      files: [
        { path: 'A.md', content: '' },
        { path: 'a.md', content: '' },
      ],
    })),
    /repeats/u,
  );
});

test('Templates plugin previews before writes and preserves partial batches for continuation', async () => {
  const { InProcessPluginRuntime } = await importBundledPackage('@mdular/plugin-runtime');
  const catalogUrl = pathToFileURL(
    resolve(projectRoot, 'web/v2/bundled-plugin-catalog.js'),
  ).href;
  const generated = await import(`${catalogUrl}?templates-fixture=${Date.now()}`);
  const entry = generated.bundledPluginCatalog.find(
    (candidate) => 'mdular.templates' === candidate.manifest.id,
  );
  assert.ok(entry);
  assert.equal(entry.entry, 'templates.js');
  assert.match(entry.contentHash, /^sha256:[a-f0-9]{64}$/u);
  const templates = await entry.load();
  const handlers = new Map();
  const stored = new Map();
  const planned = [];
  const opened = [];
  let actionListener = null;
  let currentView = null;
  let commitCount = 0;
  const runtime = new InProcessPluginRuntime({
    createServices: () => ({
      commands: {
        register(id, handler) {
          handlers.set(id, handler);
          return { dispose() { handlers.delete(id); } };
        },
        execute: async () => undefined,
      },
      navigation: { openMarkdown: async (path) => { opened.push(path); } },
      storage: {
        get: async (key) => ({ ok: true, value: stored.get(key) ?? null }),
        set: async (key, value) => { stored.set(key, value); return { ok: true, value: null }; },
        remove: async (key) => { stored.delete(key); return { ok: true, value: null }; },
      },
      views: {
        setState(viewId, state) { assert.equal(viewId, 'templates'); currentView = state; },
        onAction(viewId, listener) {
          assert.equal(viewId, 'templates');
          actionListener = listener;
          return { dispose() { actionListener = null; } };
        },
        reveal: async () => {},
        hide() {},
      },
      workspace: {
        async planTextWrites(operations, policy) {
          planned.push({ operations, policy });
          return {
            planId: `plan-${planned.length}`,
            policy,
            entries: operations.map((operation) => ({
              path: operation.path,
              bytes: new TextEncoder().encode(operation.content).byteLength,
              disposition: 'create',
            })),
          };
        },
        async commitTextWritePlan() {
          commitCount += 1;
          const operations = planned.at(-1).operations;
          if (1 === commitCount) {
            return {
              status: 'complete',
              created: [operations[0].path],
              skipped: [],
              rollbackId: 'rollback-document',
            };
          }
          return {
            status: 'partial',
            created: [operations[0].path],
            skipped: [],
            failed: {
              index: 1,
              path: operations[1].path,
              kind: 'io-error',
              message: 'fixture partial failure',
            },
            rollbackId: 'rollback-scaffold',
          };
        },
        rollbackTextWrites: async () => ({ removed: [], retained: [] }),
      },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    }),
  });
  await runtime.activate(entry.manifest, templates.default);
  assert.deepEqual(runtime.listActivePluginIds(), ['mdular.templates']);
  assert.equal(currentView.title, 'New from Template');
  assert.equal(planned.length, 0, 'activation must not write or plan implicitly');

  await handlers.get('mdular.templates.new-document')([]);
  await actionListener({ type: 'field', payload: { id: 'new-path', value: 'notes/Moon.md' } });
  await actionListener({ type: 'field', payload: { id: 'new-title', value: 'Moon' } });
  await actionListener({ type: 'field', payload: { id: 'template-id', value: 'builtin:frontmatter' } });
  await actionListener({ type: 'command', payload: { id: 'preview-document' } });
  assert.equal(currentView.title, 'Write Plan · document template');
  assert.equal(planned.length, 1);
  assert.match(planned[0].operations[0].content, /title: Moon/u);
  assert.ok(currentView.fields.some(({ id, readOnly }) =>
    'preview-content' === id && true === readOnly));
  await actionListener({ type: 'command', payload: { id: 'commit-plan' } });
  assert.deepEqual(opened, ['notes/Moon.md']);
  assert.equal(currentView.title, 'Template Batch Result');

  await handlers.get('mdular.templates.scaffold')([]);
  await actionListener({ type: 'command', payload: { id: 'preview-scaffold' } });
  assert.equal(planned.at(-1).operations.length, 6);
  assert.equal(currentView.items.length, 6);
  await actionListener({ type: 'command', payload: { id: 'commit-plan' } });
  assert.match(currentView.status, /^Partial:/u);
  assert.ok(stored.has('partial-batch'));
  await actionListener({ type: 'command', payload: { id: 'continue-batch' } });
  assert.equal(planned.at(-1).policy, 'skip-existing');
  assert.match(currentView.title, /continuation/u);

  await runtime.deactivate('mdular.templates');
  assert.equal(handlers.size, 0);
  assert.equal(actionListener, null);
});

test('generated Search plugin rebuilds corrupt private cache, updates incrementally and deactivates cleanly', async () => {
  const { InProcessPluginRuntime } = await importBundledPackage('@mdular/plugin-runtime');
  const catalogUrl = pathToFileURL(
    resolve(projectRoot, 'web/v2/bundled-plugin-catalog.js'),
  ).href;
  const generated = await import(`${catalogUrl}?search-fixture=${Date.now()}`);
  const entry = generated.bundledPluginCatalog.find(
    (candidate) => 'mdular.search' === candidate.manifest.id,
  );
  assert.ok(entry);
  assert.equal(entry.entry, 'search.js');
  assert.match(entry.contentHash, /^sha256:[a-f0-9]{64}$/u);
  assert.match(entry.load.toString(), /\.\/plugins\/search\.js/u);

  const markdown = new Map([
    ['Roadmap.md', '---\ntags: release urgent\n---\nShip it.'],
    ['docs/Notes.md', 'Body contains moonlight.'],
    ['Chat.md', 'private moonlight chat'],
  ]);
  let commandHandler = null;
  let actionListener = null;
  let watchListener = null;
  let currentView = null;
  let commandCount = 0;
  let viewListenerCount = 0;
  let watcherCount = 0;
  let policyListener = null;
  let policyEnabled = true;
  let cacheRemoveCount = 0;
  let revealCount = 0;
  const opened = [];
  const runtime = new InProcessPluginRuntime({
    createServices: () => ({
      commands: {
        register(commandId, handler) {
          assert.equal(commandId, 'mdular.search.open');
          commandHandler = handler;
          commandCount += 1;
          return { dispose() { commandCount -= 1; commandHandler = null; } };
        },
        execute: async () => undefined,
      },
      navigation: { openMarkdown: async (path) => { opened.push(path); } },
      extensions: {
        register: () => ({ dispose() {} }),
        list(pointId) {
          return policyEnabled && 'mdular.documents.policy' === pointId
            ? [{
                id: 'fixture.chat-policy',
                label: 'Chat policy',
                data: {
                  schemaVersion: 1,
                  paths: ['Chat.md'],
                  search: 'exclude',
                },
              }]
            : [];
        },
        onDidChange(pointId, listener) {
          assert.equal(pointId, 'mdular.documents.policy');
          policyListener = listener;
          return { dispose() { policyListener = null; } };
        },
      },
      storage: {
        get: async () => ({
          ok: true,
          value: {
            schemaVersion: 1,
            value: { documents: [{ path: '../corrupt.md', content: 'bad' }] },
          },
        }),
        set: async () => ({ ok: true, value: null }),
        remove: async () => { cacheRemoveCount += 1; return { ok: true, value: null }; },
      },
      views: {
        setState(viewId, state) { assert.equal(viewId, 'search-results'); currentView = state; },
        onAction(viewId, listener) {
          assert.equal(viewId, 'search-results');
          actionListener = listener;
          viewListenerCount += 1;
          return { dispose() { viewListenerCount -= 1; actionListener = null; } };
        },
        async reveal() { revealCount += 1; },
        hide() {},
      },
      workspace: {
        listMarkdown: async () => [...markdown.keys()],
        readMarkdown: async (path) => markdown.get(path),
        watchMarkdown(listener) {
          watchListener = listener;
          watcherCount += 1;
          return { dispose() { watcherCount -= 1; watchListener = null; } };
        },
      },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    }),
  });
  assert.deepEqual(await runtime.activateBundledCatalog([entry]), [{
    pluginId: 'mdular.search',
    kind: 'active',
  }]);
  await settleAsyncWork();
  assert.equal(cacheRemoveCount, 1);
  assert.equal(commandCount, 1);
  assert.equal(viewListenerCount, 1);
  assert.equal(watcherCount, 1);
  assert.ok(currentView.items.some((item) => 'docs/Notes.md' === item.id));
  assert.equal(currentView.items.some((item) => 'Chat.md' === item.id), false);

  actionListener({ type: 'input', payload: { value: 'moonlight' } });
  assert.deepEqual(currentView.items.map(({ id }) => id), ['docs/Notes.md']);
  policyEnabled = false;
  policyListener();
  await settleAsyncWork();
  await settleAsyncWork();
  actionListener({ type: 'input', payload: { value: 'moonlight' } });
  assert.deepEqual(
    new Set(currentView.items.map(({ id }) => id)),
    new Set(['Chat.md', 'docs/Notes.md']),
    'removing the Chat policy makes Chat.md searchable again',
  );
  policyEnabled = true;
  policyListener();
  await settleAsyncWork();
  await settleAsyncWork();
  markdown.set('docs/Notes.md', 'Now contains starlight.');
  watchListener({ path: 'docs/Notes.md', kind: 'changed' });
  await settleAsyncWork();
  actionListener({ type: 'input', payload: { value: 'starlight' } });
  assert.deepEqual(currentView.items.map(({ id }) => id), ['docs/Notes.md']);
  await commandHandler([]);
  assert.equal(revealCount, 1);
  actionListener({ type: 'activate', payload: { id: 'docs/Notes.md' } });
  await settleAsyncWork();
  assert.deepEqual(opened, ['docs/Notes.md']);

  await runtime.deactivate('mdular.search');
  assert.equal(commandCount, 0);
  assert.equal(viewListenerCount, 0);
  assert.equal(watcherCount, 0);
  assert.equal(policyListener, null);
});

test('plugin runtime force-releases host resources after activation throws before subscription ownership', async () => {
  const { InProcessPluginRuntime } = await importBundledPackage('@mdular/plugin-runtime');
  let leaked = 0;
  let releases = 0;
  const runtime = new InProcessPluginRuntime({
    createServices: () => ({
      commands: {
        register() { leaked += 1; return { dispose() { leaked -= 1; } }; },
        execute: async () => undefined,
      },
    }),
    releaseServices() { leaked = 0; releases += 1; },
  });
  await assert.rejects(
    () => runtime.activate(createManifest('test.forced-release'), {
      activate(context) {
        context.commands.register('fixture', () => undefined);
        throw new Error('activation failed after registration');
      },
    }),
    /activation failed after registration/u,
  );
  assert.equal(leaked, 0);
  assert.equal(releases, 1);
});

test('Search manifest permissions fail closed before any plugin resource is registered', async () => {
  const { InProcessPluginRuntime } = await importBundledPackage('@mdular/plugin-runtime');
  const search = await importBundledPackage('@mdular/plugin-search');
  let registrations = 0;
  const runtime = new InProcessPluginRuntime({
    createServices: () => ({
      commands: {
        register() { registrations += 1; return { dispose() { registrations -= 1; } }; },
        execute: async () => undefined,
      },
      navigation: { openMarkdown: async () => {} },
      extensions: {
        register: () => ({ dispose() {} }),
        list: () => [],
        onDidChange: () => ({ dispose() {} }),
      },
      storage: {
        get: async () => ({ ok: true, value: null }),
        set: async () => ({ ok: true, value: null }),
        remove: async () => ({ ok: true, value: null }),
      },
      views: {
        setState() {},
        onAction: () => ({ dispose() {} }),
        reveal: async () => {},
        hide() {},
      },
      workspace: {
        listMarkdown: async () => [],
        readMarkdown: async () => '',
      },
    }),
  });
  await assert.rejects(
    () => runtime.activate(search.pluginManifest, search.default),
    /workspace read and watch access/u,
  );
  assert.equal(registrations, 0);
  assert.deepEqual(runtime.listActivePluginIds(), []);
});

test('Search command and view contributions require their manifest capabilities', async () => {
  const manifestApi = await importBundledPackage('@mdular/plugin-manifest');
  const search = await importBundledPackage('@mdular/plugin-search');
  assert.equal(manifestApi.validatePluginManifest(search.pluginManifest).ok, true);
  const withoutCommands = manifestApi.validatePluginManifest({
    ...search.pluginManifest,
    permissions: search.pluginManifest.permissions.filter((entry) => 'commands' !== entry),
  });
  assert.equal(withoutCommands.ok, false);
  assert.match(withoutCommands.errors.join('; '), /require commands/u);
  const malformedBinding = manifestApi.validatePluginManifest({
    ...search.pluginManifest,
    contributes: {
      ...search.pluginManifest.contributes,
      commands: [{
        ...search.pluginManifest.contributes.commands[0],
        defaultKeybindings: ['Mod+NotAKey'],
      }],
    },
  });
  assert.equal(malformedBinding.ok, false);
  assert.match(malformedBinding.errors.join('; '), /commands\[0\] is malformed/u);
});

test('Chat model preserves V1 Markdown and targets exactly one duplicate occurrence', async () => {
  const chat = await importBundledPackage('@mdular/plugin-chat');
  const source = [
    'ignored preamble',
    '#### 18 September, Friday',
    '- [ ] `09:05` first line',
    'continued',
    '- [X] duplicate',
    '- [ ] duplicate',
    '',
  ].join('\r\n');
  const parsed = chat.parseChatDocument(source, 'fallback');
  assert.deepEqual(parsed.map(({ done, text, timestamp, date, occurrence }) => ({
    done, text, timestamp, date, occurrence,
  })), [
    {
      done: false,
      text: 'first line\ncontinued',
      timestamp: '09:05',
      date: '18 September, Friday',
      occurrence: 0,
    },
    {
      done: true,
      text: 'duplicate',
      timestamp: '',
      date: '18 September, Friday',
      occurrence: 0,
    },
    {
      done: false,
      text: 'duplicate',
      timestamp: '',
      date: '18 September, Friday',
      occurrence: 1,
    },
  ]);

  const removed = chat.removeChatMessages(
    source,
    [chat.messageLocator(parsed[2])],
    'fallback',
  );
  assert.equal(removed.affected, 1);
  assert.equal((removed.content.match(/duplicate/gu) ?? []).length, 1);
  assert.match(removed.content, /- \[x\] duplicate/u);

  const completed = chat.setChatMessageDone(
    removed.content,
    chat.messageLocator(chat.parseChatDocument(removed.content, 'fallback')[0]),
    true,
    'fallback',
  );
  assert.match(completed.content, /- \[x\] `09:05` first line/u);
  const appended = chat.appendChatMessage(completed.content, 'new thought', 'Day B', '10:00');
  assert.match(appended.content, /#### Day B\n- \[ \] `10:00` new thought\n$/u);
  const structuralMultiline = 'first\n- [ ] nested checklist\n#### nested heading\n\\literal';
  const escaped = chat.appendChatMessage('', structuralMultiline, 'Day C', '11:00');
  assert.equal(chat.parseChatDocument(escaped.content, 'fallback')[0].text, structuralMultiline);

  const date = new Date(2026, 8, 18, 9, 5);
  assert.equal(chat.chatDate(date), '18 September, Friday');
  assert.equal(chat.chatTimestamp(date), '09:05');
  assert.equal(chat.journalPath(date), 'journal/2026.09 September.md');
  assert.equal(chat.safeArchiveBasename('../unsafe: title.'), '..-unsafe- title');
  assert.throws(() => chat.appendChatMessage('', ' '.repeat(4), 'Day', '10:00'), /empty/u);
});

test('generated Chat plugin captures through conflicts and archives through an extension', async () => {
  const { InProcessPluginRuntime } = await importBundledPackage('@mdular/plugin-runtime');
  const catalogUrl = pathToFileURL(
    resolve(projectRoot, 'web/v2/bundled-plugin-catalog.js'),
  ).href;
  const generated = await import(`${catalogUrl}?chat-fixture=${Date.now()}`);
  const entry = generated.bundledPluginCatalog.find(
    (candidate) => 'mdular.chat' === candidate.manifest.id,
  );
  assert.ok(entry);
  assert.equal(entry.entry, 'chat.js');
  assert.match(entry.contentHash, /^sha256:[a-f0-9]{64}$/u);
  const chat = await entry.load();
  assert.deepEqual(entry.manifest.contributes.commands.map(({ id, defaultKeybindings }) => ({
    id, defaultKeybindings,
  })), [
    { id: 'mdular.chat.open', defaultKeybindings: ['Mod+Enter'] },
    { id: 'mdular.chat.quick-capture', defaultKeybindings: ['Mod+Shift+Enter'] },
  ]);

  const markdown = new Map([
    ['Chat.md', '#### Existing\n- [ ] `08:00` existing\n'],
    ['notes/recent.md', '# Recent\n'],
  ]);
  const handlers = new Map();
  const editTokens = new Map();
  const plans = new Map();
  const registered = new Set();
  const archived = [];
  let nextToken = 1;
  let actionListener = null;
  let watchListener = null;
  let currentView = null;
  let revealCount = 0;
  let planCount = 0;
  let commitCount = 0;
  let injectConflict = false;
  const archiveProvider = {
    id: 'fixture.archive',
    label: 'Fixture archive',
    order: 10,
    async execute(request) {
      archived.push(request.text);
      return { schemaVersion: 1, path: 'docs/provider.md' };
    },
  };
  const runtime = new InProcessPluginRuntime({
    createServices: () => ({
      commands: {
        register(id, handler) {
          handlers.set(id, handler);
          return { dispose() { handlers.delete(id); } };
        },
        execute: async () => undefined,
      },
      extensions: {
        register(pointId, contribution) {
          const owned = { pointId, contribution };
          registered.add(owned);
          return { dispose() { registered.delete(owned); } };
        },
        list(pointId) {
          return [
            ...('mdular.chat.archive-targets' === pointId ? [archiveProvider] : []),
            ...[...registered]
              .filter((owned) => owned.pointId === pointId)
              .map((owned) => owned.contribution),
          ];
        },
        onDidChange: () => ({ dispose() {} }),
      },
      views: {
        setState(viewId, state) { assert.equal(viewId, 'chat'); currentView = state; },
        onAction(viewId, listener) {
          assert.equal(viewId, 'chat');
          actionListener = listener;
          return { dispose() { actionListener = null; } };
        },
        reveal: async () => { revealCount += 1; },
        hide() {},
      },
      workspace: {
        async readMarkdown(path) {
          if (!markdown.has(path)) { throw new Error('not-found: fixture'); }
          return markdown.get(path);
        },
        async listMarkdownEntries() {
          return [...markdown.keys()].map((path, index) => ({
            path,
            lastModifiedMs: 100 + index,
          }));
        },
        watchMarkdown(listener) {
          watchListener = listener;
          return { dispose() { watchListener = null; } };
        },
        async beginMarkdownEdit(path) {
          if (!markdown.has(path)) { throw new Error('not-found: fixture'); }
          const editId = `edit-${nextToken++}`;
          const draft = { editId, path, content: markdown.get(path) };
          editTokens.set(editId, draft);
          return draft;
        },
        async commitMarkdownEdit(editId, content) {
          const draft = editTokens.get(editId);
          assert.ok(draft);
          editTokens.delete(editId);
          commitCount += 1;
          if (injectConflict && 'Chat.md' === draft.path) {
            injectConflict = false;
            const external = `${markdown.get('Chat.md')}- [ ] \`08:30\` external\n`;
            markdown.set('Chat.md', external);
            const nextId = `edit-${nextToken++}`;
            const current = { editId: nextId, path: 'Chat.md', content: external };
            editTokens.set(nextId, current);
            return { status: 'conflict', current };
          }
          markdown.set(draft.path, content);
          return { status: 'written', path: draft.path, content };
        },
        async planTextWrites(operations, policy) {
          planCount += 1;
          const planId = `plan-${nextToken++}`;
          plans.set(planId, { operations, policy });
          return {
            planId,
            policy,
            entries: operations.map((operation) => ({
              path: operation.path,
              bytes: new TextEncoder().encode(operation.content).byteLength,
              disposition: markdown.has(operation.path) ? 'skip' : 'create',
            })),
          };
        },
        async commitTextWritePlan(planId) {
          const plan = plans.get(planId);
          assert.ok(plan);
          plans.delete(planId);
          const created = [];
          const skipped = [];
          for (const operation of plan.operations) {
            if (markdown.has(operation.path)) {
              skipped.push(operation.path);
            } else {
              markdown.set(operation.path, operation.content);
              created.push(operation.path);
            }
          }
          return { status: 'complete', created, skipped };
        },
      },
      logger: { debug() {}, info() {}, warn() {}, error() {} },
    }),
  });
  await runtime.activate(entry.manifest, chat.default);
  await settleAsyncWork();
  await settleAsyncWork();
  assert.deepEqual(runtime.listActivePluginIds(), ['mdular.chat']);
  assert.equal(currentView.items.length, 1);
  assert.equal(planCount, 0, 'Chat activation must not create files');
  assert.equal(commitCount, 0, 'Chat activation must not write files');
  assert.equal([...registered].some(({ pointId, contribution }) =>
    'mdular.documents.policy' === pointId && 'mdular.chat' === contribution.id), true);

  await handlers.get('mdular.chat.quick-capture')([]);
  assert.equal(revealCount, 1);
  injectConflict = true;
  await actionListener({ type: 'field', payload: { id: 'capture', value: 'captured' } });
  await actionListener({ type: 'command', payload: { id: 'send' } });
  assert.match(markdown.get('Chat.md'), /external/u);
  assert.match(markdown.get('Chat.md'), /captured/u);
  assert.equal(currentView.items.length, 3);

  const captured = currentView.items.find((item) => 'captured' === item.title);
  assert.ok(captured);
  await actionListener({
    type: 'item-command',
    payload: { id: captured.id, actionId: 'complete' },
  });
  assert.match(markdown.get('Chat.md'), /- \[x\] `\d{2}:\d{2}` captured/u);

  await actionListener({ type: 'field', payload: { id: 'capture', value: 'second' } });
  await actionListener({ type: 'command', payload: { id: 'send' } });
  const toArchive = currentView.items.filter((item) => ['captured', 'second'].includes(item.title));
  for (const item of toArchive) {
    await actionListener({ type: 'activate', payload: { id: item.id } });
  }
  await actionListener({
    type: 'field',
    payload: { id: 'archive-target', value: 'extension:fixture.archive' },
  });
  await actionListener({ type: 'command', payload: { id: 'archive-selected' } });
  assert.deepEqual(archived, ['captured', 'second']);
  assert.doesNotMatch(markdown.get('Chat.md'), /captured|second/u);
  assert.match(markdown.get('Chat.md'), /existing/u);

  markdown.set('Chat.md', '#### External\n- [ ] changed outside\n');
  watchListener({ path: 'Chat.md', kind: 'changed' });
  await settleAsyncWork();
  await settleAsyncWork();
  assert.deepEqual(currentView.items.map(({ title }) => title), ['changed outside']);
  const planCountBeforeExternalDelete = planCount;
  const externallyDeleted = currentView.items[0];
  markdown.delete('Chat.md');
  await actionListener({
    type: 'item-command',
    payload: { id: externallyDeleted.id, actionId: 'delete' },
  });
  assert.equal(markdown.has('Chat.md'), false, 'a destructive action must not recreate an externally deleted Chat.md');
  assert.equal(planCount, planCountBeforeExternalDelete);

  await runtime.deactivate('mdular.chat');
  assert.equal(handlers.size, 0);
  assert.equal(actionListener, null);
  assert.equal(watchListener, null);
  assert.equal(registered.size, 0);
});

test('Chat fails closed before registration when optimistic Markdown edits are unavailable', async () => {
  const { InProcessPluginRuntime } = await importBundledPackage('@mdular/plugin-runtime');
  const chat = await importBundledPackage('@mdular/plugin-chat');
  let registrations = 0;
  const runtime = new InProcessPluginRuntime({
    createServices: () => ({
      commands: {
        register() { registrations += 1; return { dispose() { registrations -= 1; } }; },
        execute: async () => undefined,
      },
      extensions: {
        register() { registrations += 1; return { dispose() { registrations -= 1; } }; },
        list: () => [],
        onDidChange: () => ({ dispose() {} }),
      },
      views: {
        setState() {},
        onAction() { registrations += 1; return { dispose() { registrations -= 1; } }; },
        reveal: async () => {},
        hide() {},
      },
      workspace: {
        readMarkdown: async () => '',
        listMarkdownEntries: async () => [],
        watchMarkdown: () => ({ dispose() {} }),
        planTextWrites: async () => ({ planId: 'fixture', policy: 'skip-existing', entries: [] }),
        commitTextWritePlan: async () => ({ status: 'complete', created: [], skipped: [] }),
      },
    }),
  });
  await assert.rejects(
    () => runtime.activate(chat.pluginManifest, chat.default),
    /workspace read, watch, modify, and create access/u,
  );
  assert.equal(registrations, 0);
  assert.deepEqual(runtime.listActivePluginIds(), []);
});

test('editor extension host validates permissions, unions features and removes them on deactivate', async () => {
  const { DesktopPluginEditorHost } = await importBundledPackage('@mdular/desktop-plugin-editor');
  const host = new DesktopPluginEditorHost();
  const states = [];
  const binding = host.attach({
    setPluginFeatures(features) { states.push([...features].sort()); },
  });
  const extended = host.createService('mdular.extended-markdown', false);
  const registration = extended.registerExtension({
    schemaVersion: 1,
    id: 'mdular.extended-markdown.features',
    features: ['math', 'mermaid', 'tables'],
  });
  assert.deepEqual(states.at(-1), ['math', 'mermaid', 'tables']);
  assert.throws(() => extended.registerExtension({
    schemaVersion: 1,
    id: 'mdular.extended-markdown.media',
    features: ['media'],
  }), /workspace\.writeMedia/u);
  const media = host.createService('mdular.media', true);
  media.registerExtension({
    schemaVersion: 1,
    id: 'mdular.media.editor',
    features: ['media'],
  });
  assert.deepEqual(states.at(-1), ['math', 'media', 'mermaid', 'tables']);
  host.releasePlugin('mdular.media');
  assert.deepEqual(states.at(-1), ['math', 'mermaid', 'tables']);
  registration.dispose();
  assert.deepEqual(states.at(-1), []);
  binding.dispose();
  host.dispose();
});

test('Extended Markdown registers only declarative bounded editor features', async () => {
  const { InProcessPluginRuntime } = await importBundledPackage('@mdular/plugin-runtime');
  const { DesktopPluginEditorHost } = await importBundledPackage('@mdular/desktop-plugin-editor');
  const extended = await importBundledPackage('@mdular/plugin-extended-markdown');
  const editorHost = new DesktopPluginEditorHost();
  const runtime = new InProcessPluginRuntime({
    createServices: (manifest) => ({ editor: editorHost.createService(manifest.id, false) }),
    releaseServices: (pluginId) => editorHost.releasePlugin(pluginId),
  });
  await runtime.activate(extended.pluginManifest, extended.default);
  assert.deepEqual([...editorHost.activeFeatures()].sort(), [
    'code-languages',
    'emoji',
    'math',
    'mermaid',
    'tables',
    'wiki-links',
  ]);
  await runtime.deactivate('mdular.extended-markdown');
  assert.deepEqual([...editorHost.activeFeatures()], []);
  editorHost.dispose();
});

test('Media plugin registers only the declarative media feature and cleans up on deactivate', async () => {
  const { InProcessPluginRuntime } = await importBundledPackage('@mdular/plugin-runtime');
  const { DesktopPluginEditorHost } = await importBundledPackage('@mdular/desktop-plugin-editor');
  const media = await importBundledPackage('@mdular/plugin-media');
  const editorHost = new DesktopPluginEditorHost();
  const runtime = new InProcessPluginRuntime({
    createServices: (manifest) => ({ editor: editorHost.createService(manifest.id, true) }),
    releaseServices: (pluginId) => editorHost.releasePlugin(pluginId),
  });
  await runtime.activate(media.pluginManifest, media.default);
  assert.deepEqual([...editorHost.activeFeatures()], ['media']);
  await runtime.deactivate('mdular.media');
  assert.deepEqual([...editorHost.activeFeatures()], []);
  editorHost.dispose();
});

test('media insertion helpers bound names, bytes, selection edits and native receipts', async () => {
  const media = await importBundledPackage('@mdular/desktop-media-insert');
  assert.equal(media.mediaExtensionForMime('audio/x-wav'), 'wav');
  assert.equal(
    media.createMediaAssetPath(
      'my bad:<name>.PNG',
      'image/png',
      new Date('2026-09-18T00:00:00.123Z'),
    ),
    'media/20260918-000000-123-my-bad-name.png',
  );
  assert.equal(
    media.createMediaAssetPath(
      'CON.jpg',
      'image/jpeg',
      new Date('2026-09-18T00:00:00.123Z'),
      1,
    ),
    'media/20260918-000000-123-asset-CON-2.jpg',
  );
  const markdown = media.markdownMediaLink('media/demo.png', 'demo].png');
  assert.equal(markdown, '![demo](media/demo.png)');
  assert.deepEqual(
    media.applyMediaMarkdownEdit('before SELECT after', 13, 7, markdown),
    {
      content: `before ${markdown} after`,
      cursor: 7 + markdown.length,
      markdown,
    },
  );
  assert.equal(media.encodeMediaBase64(new Uint8Array([0, 1, 2, 255])), 'AAEC/w==');
  const revision = `sha256:${'a'.repeat(64)}`;
  assert.deepEqual(media.decodeMediaWriteResult({
    status: 'written',
    receipt: { path: 'media/demo.png', revision, bytes: 4 },
  }), {
    status: 'written',
    receipt: { path: 'media/demo.png', revision, bytes: 4 },
  });
  assert.deepEqual(media.decodeMediaRollbackResult({
    status: 'retained',
    path: 'media/demo.png',
    kind: 'changed',
    message: 'retained',
  }), {
    status: 'retained',
    path: 'media/demo.png',
    kind: 'changed',
    message: 'retained',
  });
  assert.throws(() => media.mediaExtensionForMime('image/svg+xml'), /unsupported/u);
  assert.throws(
    () => media.applyMediaMarkdownEdit('short', 0, 99, markdown),
    /selection/u,
  );
});

test('editor enhancement parser bounds Mermaid, math, code modes and wiki links', async () => {
  const enhancements = await importBundledPackage('@mdular/desktop-editor-enhancements');
  const blocks = enhancements.parseEditorPreviewBlocks([
    '```mermaid',
    'graph TD',
    'A-->B',
    '```',
    '```text',
    '$$not math$$',
    '```',
    '$$x^2 + y^2$$',
    '$$',
    '\\frac{1}{2}',
    '$$',
  ].join('\n'));
  assert.deepEqual(structuredClone(blocks), [
    { kind: 'mermaid', line: 3, source: 'graph TD\nA-->B' },
    { kind: 'math', line: 7, source: 'x^2 + y^2' },
    { kind: 'math', line: 10, source: '\\frac{1}{2}' },
  ]);
  assert.deepEqual(
    [...enhancements.fencedCodeLanguages('```js\na()\n```\n```python\nb()\n```')].sort(),
    ['js', 'python'],
  );
  assert.equal(enhancements.wikiLinkAt('See [[docs/Plan|the plan]] now', 10), 'docs/Plan');
  assert.equal(enhancements.wikiLinkAt('`[[not closed]`', 5), null);
  assert.deepEqual(
    enhancements.parseEditorPreviewBlocks('x'.repeat(
      enhancements.EDITOR_ENHANCEMENT_LIMITS.maxDocumentCharacters + 1,
    )),
    [],
  );
});

test('editor media parser accepts bounded local assets and rejects fences and traversal', async () => {
  const enhancements = await importBundledPackage('@mdular/desktop-editor-enhancements');
  assert.deepEqual(structuredClone(enhancements.parseEditorMediaPreviews([
    '![Cover](media/cover.png)',
    '![[media/clip.mp4|Clip]]',
    '```md',
    '![Hidden](media/hidden.png)',
    '```',
    '![Escape](media/../secret.png)',
    '![Remote](https://example.test/image.png)',
    '![Audio](media/note.weba)',
  ].join('\n'))), [
    { alt: 'Cover', kind: 'image', line: 0, path: 'media/cover.png' },
    { alt: 'Clip', kind: 'video', line: 1, path: 'media/clip.mp4' },
    { alt: 'Audio', kind: 'audio', line: 7, path: 'media/note.weba' },
  ]);
});

test('workspace media cache uses the bounded native media reader and releases its lease', async () => {
  const assets = await importBundledPackage('@mdular/desktop-plugin-assets');
  const calls = [];
  const revoked = [];
  const host = new assets.DesktopPluginAssetHost({
    bridge: {
      async invoke(command, args) {
        calls.push({ command, args });
        if ('workspace_file_mtime' === command) { return 7; }
        if ('workspace_read_plugin_media' === command) {
          return { contentBase64: 'aGk=', lastModifiedMs: 7 };
        }
        throw new Error(`unexpected command: ${command}`);
      },
    },
    createObjectUrl: (_bytes, mime) => `blob:${mime}`,
    revokeObjectUrl: (url) => { revoked.push(url); },
  });
  const lease = await host.resolveMedia('media/voice.weba');
  assert.equal(lease.url, 'blob:audio/webm');
  assert.deepEqual(calls.map(({ command }) => command), [
    'workspace_file_mtime',
    'workspace_read_plugin_media',
  ]);
  lease.release();
  await assert.rejects(() => host.resolveMedia('assets/voice.weba'), /direct child/u);
  host.notifyWorkspaceReset();
  assert.deepEqual(revoked, ['blob:audio/webm']);
  host.dispose();
});

test('Mermaid SVG policy rejects active URLs and the host never inserts raw renderer HTML', async () => {
  const enhancements = await importBundledPackage('@mdular/desktop-editor-enhancements');
  assert.equal(enhancements.isSafeSvgReference('#arrowhead'), true);
  assert.equal(enhancements.isSafeSvgReference('javascript:alert(1)'), false);
  assert.equal(enhancements.isSafeSvgReference('https://example.test/x'), false);
  assert.equal(enhancements.sanitizeSvgStyle('fill:url(#gradient);stroke:#fff'), 'fill:url(#gradient);stroke:#fff');
  assert.equal(enhancements.sanitizeSvgStyle('fill:url(javascript:alert(1))'), null);
  assert.equal(enhancements.sanitizeSvgStyle('@import url(https://example.test/x)'), null);

  const source = readFileSync(
    resolve(projectRoot, 'apps/desktop/src/editor-enhancements.ts'),
    'utf8',
  );
  assert.match(source, /securityLevel:\s*'strict'/u);
  assert.match(source, /trust:\s*false/u);
  assert.doesNotMatch(source, /\.innerHTML\s*=/u);
  assert.match(source, /lib\/mermaid\.min\.js/u);
  assert.match(source, /lib\/latex\/katex\.min\.js/u);
});

test('Kanban model preserves unknown frontmatter bytes and rejects future issue schemas', async () => {
  const kanban = await importBundledPackage('@mdular/plugin-kanban');
  const statuses = kanban.parseStatusConfig({
    version: 1,
    vendor: { keep: true },
    defaultStatus: 'todo',
    statuses: [
      { id: 'todo', label: '待办', color: 'blue' },
      { id: 'done', label: '完成' },
    ],
  });
  const board = kanban.parseBoardConfig({
    version: 1,
    vendor: 'keep',
    columns: [
      { id: 'inbox', label: 'Inbox', statusId: null, locked: false, width: 320 },
      { id: 'done', label: 'Done', statusId: 'done', locked: false },
    ],
  });
  assert.equal(JSON.parse(kanban.serializeStatusConfig(statuses)).vendor.keep, true);
  assert.equal(JSON.parse(kanban.serializeStatusConfig(statuses)).statuses[0].color, 'blue');
  assert.equal(JSON.parse(kanban.serializeBoardConfig(board)).columns[0].width, 320);
  assert.throws(
    () => kanban.parseStatusConfig({ version: 2, defaultStatus: 'todo', statuses: [{ id: 'todo', label: 'Todo' }] }),
    /unsupported version 2/u,
  );

  const source = '\uFEFF---\r\nstatus: todo\r\ncustom: keep\r\nnested:\r\n  child: yes\r\n---\r\n\r\n# Body\r\n';
  const changed = kanban.patchIssueFrontmatter(source, {
    status: 'done',
    boardColumn: null,
  });
  assert.ok(changed.startsWith('\uFEFF---\r\n'));
  assert.match(changed, /kanbanSchema: 1\r\n/u);
  assert.match(changed, /status: done\r\n/u);
  assert.match(changed, /custom: keep\r\nnested:\r\n  child: yes\r\n/u);
  assert.ok(changed.endsWith('\r\n# Body\r\n'));
  assert.throws(
    () => kanban.patchIssueFrontmatter('---\nkanbanSchema: 2\n---\nbody', { status: 'done' }),
    /unsupported kanbanSchema 2/u,
  );

  const card = kanban.parseIssueCard('issues/a.md', changed, statuses, board);
  assert.equal(card.statusId, 'done');
  assert.equal(card.columnId, 'done');
  assert.equal(card.writable, true);
  assert.equal(kanban.matchesIssueFilter({ ...card, assignee: 'Moon', tags: 'UI, release' }, {
    assignee: 'moon', priority: '', tag: 'lea',
  }), true);
});

test('desktop text edit capability is bounded, typed and isolated from Markdown tokens', async () => {
  const core = await importBundledPackage('@mdular/core');
  const { DesktopPluginWorkspaceHost } = await importBundledPackage(
    '@mdular/desktop-plugin-workspace',
  );
  let snapshot = createSnapshot(core, {
    path: 'issues/ticket-board.json',
    pathKey: 'workspace:issues/ticket-board.json',
    content: '{"version":1}\n',
    revision: 'config-1',
  });
  const host = new DesktopPluginWorkspaceHost({
    bridge: { invoke: async () => [] },
    workspaceAdapter: {
      read: async () => ({ ok: true, snapshot }),
      write: async (request) => {
        snapshot = createSnapshot(core, {
          path: 'issues/ticket-board.json',
          pathKey: 'workspace:issues/ticket-board.json',
          content: request.content,
          revision: 'config-2',
        });
        return { ok: true, snapshot };
      },
    },
    window: { setTimeout: () => 1, clearTimeout() {} },
    onFailure() {},
  });
  const service = host.createService('test.kanban', {
    read: false,
    readText: true,
    watch: false,
    modifyText: true,
  });
  assert.equal(await service.readText('issues/ticket-board.json'), '{"version":1}\n');
  await assert.rejects(() => service.readText('issues/image.png'), /limited to Markdown, JSON/u);
  const draft = await service.beginTextEdit('issues/ticket-board.json');
  assert.deepEqual(await service.commitTextEdit(draft.editId, '{"version":1,"ok":true}\n'), {
    status: 'written',
    path: 'issues/ticket-board.json',
    content: '{"version":1,"ok":true}\n',
  });
  const second = await service.beginTextEdit('issues/ticket-board.json');
  const markdownService = host.createService('test.kanban', {
    read: false,
    watch: false,
    modifyMarkdown: true,
  });
  await assert.rejects(
    () => markdownService.commitMarkdownEdit(second.editId, 'stolen'),
    /Markdown edit is unknown/u,
  );
  host.releasePlugin('test.kanban');
  await assert.rejects(() => service.commitTextEdit(second.editId, 'stale'), /edit is unknown/u);
  host.dispose();
});

test('declarative board host owns safe rendering, drop dispatch and drag cleanup', async () => {
  const { DesktopPluginViewHost } = await importBundledPackage('@mdular/desktop-plugin-views');
  const body = createFakeElement('body');
  const document = {
    body,
    createElement: (tagName) => createFakeElement(tagName),
  };
  const host = new DesktopPluginViewHost({ document, container: body, onFailure() {} });
  const views = host.createService({
    schemaVersion: 1,
    id: 'test.board',
    name: 'Board',
    version: '1.0.0',
    entry: 'board.js',
    permissions: ['ui.views'],
    contributes: { views: [{ id: 'board', title: 'Board', location: 'editor-pane' }] },
  });
  const actions = [];
  views.onAction('board', (action) => { actions.push(structuredClone(action)); });
  const state = {
    schemaVersion: 1,
    kind: 'board',
    title: '<script>Issues</script>',
    columns: [
      {
        id: 'source', title: '<b>Source</b>', items: [{
          id: 'issues/x.md', title: '<img onerror=alert(1)>', draggable: true,
          fields: [{
            id: 'status', kind: 'select', label: 'Status', value: 'todo',
            options: [{ value: 'todo', label: 'Todo' }, { value: 'done', label: 'Done' }],
          }],
        }],
      },
      { id: 'target', title: 'Target', items: [] },
    ],
  };
  views.setState('board', state);
  await views.reveal('board');
  const board = findFakeElementByClass(body, 'v2-plugin-board');
  assert.ok(board);
  assert.equal(findFakeElementByTag(body, 'script'), null);
  assert.equal(findFakeElementByTag(body, 'strong').textContent, '<img onerror=alert(1)>');
  const sourceCard = board.children[0].children[1].children[0];
  const targetItems = board.children[1].children[1];
  const transfer = { effectAllowed: '', dropEffect: '', setData() {} };
  sourceCard.dispatch('dragstart', { dataTransfer: transfer });
  targetItems.dispatch('dragover', { dataTransfer: transfer, preventDefault() {} });
  targetItems.dispatch('drop', { dataTransfer: transfer, preventDefault() {} });
  assert.deepEqual(actions.at(-1), {
    type: 'board-drop', payload: { id: 'issues/x.md', columnId: 'target' },
  });
  sourceCard.dispatch('dragstart', { dataTransfer: transfer });
  views.setState('board', state);
  targetItems.dispatch('drop', { dataTransfer: transfer, preventDefault() {} });
  assert.equal(actions.filter(({ type }) => 'board-drop' === type).length, 1);
  host.releasePlugin('test.board');
  assert.equal(host.viewCount('test.board'), 0);
  host.dispose();
});

test('generated Kanban plugin loads issues, exposes Chat To Issues and releases every resource', async () => {
  const kanban = await importBundledPackage('@mdular/plugin-kanban');
  const commands = new Map();
  const subscriptions = [];
  const plans = new Map();
  const created = [];
  let nextPlan = 1;
  let viewState = null;
  let viewListener = null;
  let archiveContribution = null;
  let watcher = null;
  let hidden = false;
  let issueContent = [
    '---',
    'status: pending-assign',
    'title: First issue',
    'custom: keep',
    '---',
    'Body',
  ].join('\n');
  let issueEdit = 1;
  let conflictOnce = true;
  const controller = await kanban.default.activate({
    pluginId: 'mdular.kanban',
    subscriptions: {
      add(disposable) { subscriptions.push(disposable); return disposable; },
    },
    commands: {
      register(id, handler) {
        commands.set(id, handler);
        return { dispose: () => commands.delete(id) };
      },
      execute: async () => undefined,
    },
    extensions: {
      register(pointId, contribution) {
        assert.equal(pointId, 'mdular.chat.archive-targets');
        archiveContribution = contribution;
        return { dispose: () => { archiveContribution = null; } };
      },
      list: () => [],
      onDidChange: () => ({ dispose() {} }),
    },
    navigation: { openMarkdown: async () => {} },
    storage: {
      get: async () => ({ ok: true, value: null }),
      set: async () => ({ ok: true, value: null }),
      remove: async () => ({ ok: true, value: null }),
    },
    views: {
      setState(_id, state) { viewState = structuredClone(state); },
      onAction(_id, listener) {
        viewListener = listener;
        return { dispose: () => { viewListener = null; } };
      },
      reveal: async () => {},
      revealReaderBlock() {},
      hide() { hidden = true; },
    },
    workspace: {
      readText: async () => { throw new Error('not-found: fixture'); },
      listMarkdown: async () => ['issues/First.md', 'issues/README.md'],
      readMarkdown: async () => issueContent,
      watchMarkdown(listener) {
        watcher = listener;
        return { dispose: () => { watcher = null; } };
      },
      beginMarkdownEdit: async (path) => ({
        editId: `issue-edit-${issueEdit++}`,
        path,
        content: issueContent,
      }),
      async commitMarkdownEdit(_editId, content) {
        if (conflictOnce) {
          conflictOnce = false;
          issueContent = issueContent.replace('custom: keep', 'custom: keep\nexternal: preserved');
          return {
            status: 'conflict',
            current: {
              editId: `issue-edit-${issueEdit++}`,
              path: 'issues/First.md',
              content: issueContent,
            },
          };
        }
        issueContent = content;
        return { status: 'written', path: 'issues/First.md', content };
      },
      beginTextEdit: async () => { throw new Error('unused'); },
      commitTextEdit: async () => { throw new Error('unused'); },
      async planTextWrites(operations, policy) {
        const planId = `plan-${nextPlan++}`;
        plans.set(planId, operations);
        return {
          planId,
          policy,
          entries: operations.map((operation) => ({
            path: operation.path,
            bytes: operation.content.length,
            disposition: 'create',
          })),
        };
      },
      async commitTextWritePlan(planId) {
        const operations = plans.get(planId);
        assert.ok(operations);
        created.push(...operations);
        return { status: 'complete', created: operations.map(({ path }) => path), skipped: [] };
      },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  for (let index = 0; index < 4; index += 1) { await settleAsyncWork(); }
  assert.equal(viewState.kind, 'board');
  assert.equal(viewState.columns.reduce((total, column) => total + column.items.length, 0), 1);
  assert.ok(commands.has('mdular.kanban.open'));
  assert.equal(archiveContribution.label, 'To Issues');
  assert.equal(typeof watcher, 'function');

  await viewListener({
    type: 'item-field',
    payload: { id: 'issues/First.md', fieldId: 'status', value: 'in-progress' },
  });
  assert.match(issueContent, /kanbanSchema: 1/u);
  assert.match(issueContent, /status: in-progress/u);
  assert.match(issueContent, /external: preserved/u);
  assert.match(issueContent, /custom: keep/u);
  assert.ok(issueContent.endsWith('Body'));

  const archived = await archiveContribution.execute({
    schemaVersion: 1,
    text: 'Archived issue\nBody from Chat',
  });
  assert.deepEqual(archived, { schemaVersion: 1, path: 'issues/Archived issue.md' });
  assert.match(created.at(-1).content, /kanbanSchema: 1/u);
  assert.match(created.at(-1).content, /Body from Chat/u);

  controller.dispose();
  for (const disposable of subscriptions.reverse()) { await disposable.dispose(); }
  assert.equal(commands.size, 0);
  assert.equal(archiveContribution, null);
  assert.equal(watcher, null);
  assert.equal(viewListener, null);
  assert.equal(hidden, true);
});

test('Kanban fails closed before registration when text modification permission is absent', async () => {
  const kanban = await importBundledPackage('@mdular/plugin-kanban');
  let registrations = 0;
  assert.throws(() => kanban.default.activate({
    pluginId: 'mdular.kanban',
    subscriptions: { add(disposable) { return disposable; } },
    commands: { register() { registrations += 1; return { dispose() {} }; } },
    extensions: { register() { registrations += 1; return { dispose() {} }; } },
    navigation: { openMarkdown: async () => {} },
    storage: {},
    views: { setState() { registrations += 1; } },
    workspace: {
      beginMarkdownEdit: async () => {},
      commitMarkdownEdit: async () => {},
      commitTextWritePlan: async () => {},
      listMarkdown: async () => [],
      planTextWrites: async () => {},
      readMarkdown: async () => '',
      readText: async () => '',
      watchMarkdown: () => ({ dispose() {} }),
    },
  }), /bounded workspace read, watch, create and modify access/u);
  assert.equal(registrations, 0);
});

test('document hub exposes only deduplicated open save state to plugins', async () => {
  const core = await importBundledPackage('@mdular/core');
  const documentsApi = await importBundledPackage('@mdular/desktop-plugin-documents');
  const primary = new core.DocumentSession(
    createSnapshot(core, { path: 'docs/primary.md', pathKey: 'workspace:docs/primary.md' }),
    createAdapter(async () => { throw new Error('not used'); }),
  );
  const secondary = new core.DocumentSession(
    createSnapshot(core, { path: 'docs/secondary.md', pathKey: 'workspace:docs/secondary.md' }),
    createAdapter(async () => { throw new Error('not used'); }),
  );
  secondary.edit('dirty\n');
  const hub = new documentsApi.DesktopPluginDocumentHub(
    () => {},
    undefined,
    () => [primary, secondary, primary],
  );
  const states = hub.createService('test.vcs').listOpenSaveStates();
  assert.equal(Object.isFrozen(states), true);
  assert.deepEqual(states.map(({ path, dirty, bufferVersion }) => ({
    path, dirty, bufferVersion,
  })), [
    { path: 'docs/primary.md', dirty: false, bufferVersion: 0 },
    { path: 'docs/secondary.md', dirty: true, bufferVersion: 1 },
  ]);
});

test('desktop VCS broker validates native data, relative paths and release ownership', async () => {
  const { DesktopPluginVcsHost } = await importBundledPackage('@mdular/desktop-plugin-vcs');
  const calls = [];
  const host = new DesktopPluginVcsHost({
    async invoke(command, args) {
      calls.push([command, structuredClone(args)]);
      if ('workspace_vcs_status' === command) {
        return {
          kind: 'git',
          branch: 'feature/safe',
          entries: [{
            path: 'docs/a.md',
            status: 'M.',
            indexStatus: 'M',
            workingTreeStatus: '.',
          }],
          truncated: false,
        };
      }
      if ('workspace_vcs_diff' === command) {
        return {
          kind: 'git',
          path: args.request.path,
          sections: [
            { kind: 'working-tree', text: '-old\n+new\n', truncated: false },
            { kind: 'staged', text: '', truncated: false },
          ],
        };
      }
      return { client: args.request.client };
    },
  });
  const service = host.createService('mdular.vcs');
  assert.equal((await service.status()).branch, 'feature/safe');
  assert.equal((await service.diff('docs/a.md')).sections[0].text, '-old\n+new\n');
  assert.deepEqual(await service.openExternal('finder'), { client: 'finder' });
  assert.deepEqual(calls.map(([command]) => command), [
    'workspace_vcs_status',
    'workspace_vcs_diff',
    'workspace_vcs_open_external',
  ]);
  await assert.rejects(() => service.diff('../outside.md'), /Invalid workspace path/u);
  assert.equal(calls.length, 3);
  host.releasePlugin('mdular.vcs');
  await assert.rejects(() => service.status(), /released/u);
});

test('process.vcs is valid but the desktop host grants it only to the bundled VCS identity', async () => {
  const manifestApi = await importBundledPackage('@mdular/plugin-manifest');
  const { DesktopPluginHost } = await importBundledPackage('@mdular/desktop-plugin-host');
  const manifest = {
    schemaVersion: 1,
    id: 'mdular.vcs',
    name: 'Version Control',
    version: '0.1.0',
    entry: 'vcs.js',
    permissions: ['process.vcs'],
  };
  assert.equal(manifestApi.validatePluginManifest(manifest).ok, true);
  const marker = { status: async () => ({ kind: 'none', entries: [], truncated: false }) };
  const host = new DesktopPluginHost({
    documents: { createService: () => ({}) },
    headers: { createService: () => ({}) },
    storage: { createService: () => ({}) },
    vcs: { createService: () => marker },
    grantedPermissions: new Set(['process.vcs']),
  });
  assert.equal(host.createServices(manifest).vcs, marker);
  assert.equal(host.createServices({ ...manifest, id: 'thirdparty.vcs' }).vcs, undefined);
  assert.equal(host.createServices({ ...manifest, version: '0.1.1' }).vcs, undefined);
  assert.equal(host.createServices({ ...manifest, entry: 'other.js' }).vcs, undefined);
});

test('VCS model merges repository and app dirty state and bounds declarative diff output', async () => {
  const vcs = await importBundledPackage('@mdular/plugin-vcs');
  const merged = vcs.mergeVcsStatus([
    { path: 'docs/a.md', status: 'M.', indexStatus: 'M', workingTreeStatus: '.' },
  ], [
    { path: 'docs/a.md', revision: 'r1', bufferVersion: 1, dirty: true },
    { path: 'docs/b.md', revision: 'r2', bufferVersion: 2, dirty: true },
    { path: 'docs/clean.md', revision: 'r3', bufferVersion: 0, dirty: false },
  ]);
  assert.deepEqual(merged.map(({ path, unsaved, status }) => ({
    path, unsaved, status: status?.status,
  })), [
    { path: 'docs/a.md', unsaved: true, status: 'M.' },
    { path: 'docs/b.md', unsaved: true, status: undefined },
  ]);
  assert.equal(vcs.visibleStatusCode({ status: 'M.', path: '', indexStatus: '', workingTreeStatus: '' }), 'M·');
  const rendered = vcs.diffReaderBlocks({
    kind: 'git',
    path: 'docs/a.md',
    sections: [{
      kind: 'working-tree',
      text: '变'.repeat(vcs.VCS_LIMITS.renderedDiffBytes),
      truncated: false,
    }],
  });
  assert.equal(rendered.truncated, true);
  assert.ok(0 < rendered.blocks.length);
  assert.ok(rendered.blocks.every((block) => 'code' !== block.kind ||
    block.text.length <= vcs.VCS_LIMITS.diffBlockCharacters));
});

test('generated VCS plugin renders status and diff, opens an enum client and releases resources', async () => {
  const vcs = await importBundledPackage('@mdular/plugin-vcs');
  const commands = new Map();
  const subscriptions = [];
  const documentListeners = new Map();
  let viewState = null;
  let viewListener = null;
  let hidden = false;
  let selectedExternal = null;
  let storedClient = null;
  const controller = vcs.default.activate({
    pluginId: 'mdular.vcs',
    subscriptions: {
      add(disposable) { subscriptions.push(disposable); return disposable; },
    },
    commands: {
      register(id, handler) {
        commands.set(id, handler);
        return { dispose: () => commands.delete(id) };
      },
      execute: async () => undefined,
    },
    documents: {
      getActiveSnapshot: () => null,
      listOpenSaveStates: () => [{
        path: 'notes/unsaved.md', revision: 'r1', bufferVersion: 1, dirty: true,
      }],
      onDidOpen(listener) { documentListeners.set('open', listener); return { dispose: () => documentListeners.delete('open') }; },
      onDidChange(listener) { documentListeners.set('change', listener); return { dispose: () => documentListeners.delete('change') }; },
      onDidSave(listener) { documentListeners.set('save', listener); return { dispose: () => documentListeners.delete('save') }; },
      onDidActivatePane(listener) { documentListeners.set('activate', listener); return { dispose: () => documentListeners.delete('activate') }; },
    },
    storage: {
      get: async () => ({ ok: true, value: null }),
      set: async (_key, value) => { storedClient = value.value; return { ok: true, value: null }; },
      remove: async () => ({ ok: true, value: null }),
    },
    vcs: {
      status: async () => ({
        kind: 'git',
        branch: 'main',
        entries: [{
          path: 'docs/a.md', status: '.M', indexStatus: '.', workingTreeStatus: 'M',
        }],
        truncated: false,
      }),
      diff: async (path) => ({
        kind: 'git', path,
        sections: [{ kind: 'working-tree', text: '-old\n+new\n', truncated: false }],
      }),
      openExternal: async (client) => {
        selectedExternal = client;
        return { client };
      },
    },
    views: {
      setState(_id, state) { viewState = structuredClone(state); },
      onAction(_id, listener) {
        viewListener = listener;
        return { dispose: () => { viewListener = null; } };
      },
      reveal: async () => {},
      revealReaderBlock() {},
      hide() { hidden = true; },
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  for (let index = 0; index < 4; index += 1) { await settleAsyncWork(); }
  assert.equal(viewState.kind, 'collection');
  assert.equal(viewState.title, 'Version Control · main');
  assert.deepEqual(viewState.items.map(({ title }) => title), ['docs/a.md', 'notes/unsaved.md']);
  assert.ok(commands.has('mdular.vcs.open'));
  assert.equal(documentListeners.size, 4);

  const changedItem = viewState.items.find(({ title }) => 'docs/a.md' === title);
  await viewListener({ type: 'activate', payload: { id: changedItem.id } });
  for (let index = 0; index < 3; index += 1) { await settleAsyncWork(); }
  assert.equal(viewState.kind, 'reader');
  assert.equal(viewState.sourcePath, 'docs/a.md');
  assert.ok(viewState.blocks.some(({ kind, text }) => 'code' === kind && text.includes('+new')));

  await viewListener({ type: 'command', payload: { id: 'back' } });
  assert.equal(viewState.kind, 'collection');
  await viewListener({ type: 'field', payload: { id: 'client', value: 'finder' } });
  for (let index = 0; index < 2; index += 1) { await settleAsyncWork(); }
  await viewListener({ type: 'command', payload: { id: 'open-external' } });
  for (let index = 0; index < 2; index += 1) { await settleAsyncWork(); }
  assert.equal(storedClient, 'finder');
  assert.equal(selectedExternal, 'finder');

  controller.dispose();
  for (const disposable of subscriptions.reverse()) { await disposable.dispose(); }
  assert.equal(commands.size, 0);
  assert.equal(documentListeners.size, 0);
  assert.equal(viewListener, null);
  assert.equal(hidden, true);
});

test('VCS plugin fails closed before registration without the official process broker', async () => {
  const vcs = await importBundledPackage('@mdular/plugin-vcs');
  let registrations = 0;
  assert.throws(() => vcs.default.activate({
    pluginId: 'mdular.vcs',
    subscriptions: { add(disposable) { return disposable; } },
    commands: { register() { registrations += 1; return { dispose() {} }; } },
    documents: {},
    storage: {},
    views: { setState() { registrations += 1; } },
  }), /official bounded process broker/u);
  assert.equal(registrations, 0);
});
