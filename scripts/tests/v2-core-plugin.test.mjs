import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const projectRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const packageEntries = {
  '@mdular/core': resolve(projectRoot, 'packages/core/src/index.ts'),
  '@mdular/plugin-manifest': resolve(projectRoot, 'packages/plugin-manifest/src/index.ts'),
  '@mdular/plugin-sdk': resolve(projectRoot, 'packages/plugin-sdk/src/index.ts'),
  '@mdular/plugin-runtime': resolve(projectRoot, 'packages/plugin-runtime/src/index.ts'),
};

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
    entry: './index.js',
  };
}

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
