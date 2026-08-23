import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

import { transformSync } from 'esbuild';

const projectRoot = resolve(import.meta.dirname, '..', '..');

function readProjectFile(relativePath) {
  return readFileSync(resolve(projectRoot, relativePath), 'utf8');
}

function createShellHarness(launcherHint = null) {
  const boundStates = [];
  const windowObject = {
    location: { search: '' },
    clearTimeout,
    setTimeout,
  };
  const context = vm.createContext({
    URLSearchParams,
    appStorageKey: (key) => key,
    clearTimeout,
    console,
    document: {
      body: { appendChild() {}, prepend() {} },
      createElement: () => ({
        classList: { add() {}, remove() {}, toggle() {} },
        querySelector: () => null,
      }),
      documentElement: { classList: { add() {} } },
      getElementById: () => null,
    },
    fetch: async () => launcherHint === null
      ? ({ ok: false })
      : ({ ok: true, json: async () => launcherHint }),
    log() {},
    openDir() {},
    sessionStorage: { getItem: () => null, setItem() {} },
    setTauriWorkspaceBound: (bound) => boundStates.push(bound),
    setTimeout,
    showToast() {},
    window: windowObject,
  });
  const source = readProjectFile('src/desktop/shell.ts');
  const { code } = transformSync(source, { loader: 'ts', target: 'es2020' });
  vm.runInContext(code, context, { filename: 'src/desktop/shell.ts' });
  return { boundStates, context, windowObject };
}

test('Tauri directory selection cancellation leaves the workspace unchanged', async () => {
  const { boundStates, context, windowObject } = createShellHarness();
  let invokeCommand;
  windowObject.__TAURI__ = {
    core: {
      invoke: async (command) => {
        invokeCommand = command;
        return null;
      },
    },
  };

  assert.equal(await context.selectTauriWorkspaceDirectory(), null);
  assert.equal(invokeCommand, 'workspace_pick_and_bind');
  assert.deepEqual(boundStates, []);
  assert.equal(context.getLauncherWorkspacePath(), '');
});

test('Tauri directory selection atomically picks and binds through the Rust command', async () => {
  const { boundStates, context, windowObject } = createShellHarness();
  let invokeCall;
  windowObject.__TAURI__ = {
    core: {
      invoke: async (command, payload) => {
        invokeCall = { command, payload };
        return '/Users/test/Documents/notes';
      },
    },
  };

  const selected = await context.selectTauriWorkspaceDirectory();

  assert.equal(invokeCall.command, 'workspace_pick_and_bind');
  assert.equal(invokeCall.payload, undefined);
  assert.equal(selected, '/Users/test/Documents/notes');
  assert.deepEqual(boundStates, [true]);
  assert.equal(context.getLauncherWorkspacePath(), '/Users/test/Documents/notes');
});

test('Tauri directory selection rejects an invalid host result', async () => {
  const { context, windowObject } = createShellHarness();
  windowObject.__TAURI__ = {
    core: { invoke: async () => [] },
  };

  await assert.rejects(
    context.selectTauriWorkspaceDirectory(),
    /did not bind the selected workspace/u,
  );
});

test('Tauri startup trusts the Rust binding instead of a stale launcher hint path', async () => {
  const { boundStates, context, windowObject } = createShellHarness({
    shell: true,
    workspacePath: 'D:\\stale-launcher-workspace',
  });
  windowObject.__TAURI__ = {
    core: {
      invoke: async (command) => {
        assert.equal(command, 'workspace_get_path');
        return 'D:\\actual-native-workspace';
      },
    },
  };

  assert.equal(await context.initDesktopShell(), true);
  assert.equal(context.getLauncherWorkspacePath(), 'D:\\actual-native-workspace');
  assert.deepEqual(boundStates, [true]);
});

test('desktop Open Folder integration routes through Tauri and guards browser-only globals', () => {
  const appSource = readProjectFile('src/app/index.ts');
  const filesSource = readProjectFile('src/files/index.ts');
  const fsSource = readProjectFile('web/lib/fs.js');
  const rustSource = readProjectFile('src-tauri/src/lib.rs');
  const permissionSource = readProjectFile('src-tauri/permissions/workspace-io.toml');
  const capabilitySource = readProjectFile('src-tauri/capabilities/default.json');

  assert.match(appSource, /if \(tauriHost\)[\s\S]*selectTauriWorkspaceDirectory\(\)/u);
  assert.doesNotMatch(appSource, /instanceof FileSystemDirectoryHandle/u);
  assert.doesNotMatch(filesSource, /instanceof FileSystemDirectoryHandle/u);
  assert.match(fsSource, /typeof FileSystemDirectoryHandle !== 'undefined'/u);
  assert.match(rustSource, /fn workspace_pick_and_bind/u);
  assert.match(rustSource, /blocking_pick_folder/u);
  assert.match(rustSource, /workspace_pick_and_bind,/u);
  assert.match(permissionSource, /"workspace_pick_and_bind"/u);
  assert.doesNotMatch(permissionSource, /"workspace_bind_path"/u);
  assert.doesNotMatch(capabilitySource, /"dialog:default"/u);
});

test('desktop settings persist one default workspace without accepting a frontend path', () => {
  const appSource = readProjectFile('src/app/index.ts');
  const settingsSource = readProjectFile('src/desktop/settings.ts');
  const rustSource = readProjectFile('src-tauri/src/lib.rs');
  const permissionSource = readProjectFile('src-tauri/permissions/workspace-io.toml');
  const indexSource = readProjectFile('web/index.html');
  const offlineSource = readProjectFile('web/offline.js');

  assert.match(appSource, /await initDesktopSettings\(shellWorkspaceBound\)/u);
  assert.match(settingsSource, /'workspace_get_startup_settings'/u);
  assert.match(settingsSource, /'workspace_choose_default'/u);
  assert.match(settingsSource, /'workspace_set_open_on_startup', \{ enabled \}/u);
  assert.match(settingsSource, /'workspace_clear_default'/u);
  assert.doesNotMatch(settingsSource, /workspace_choose_default[\s\S]{0,120}\{\s*path\s*:/u);
  assert.match(settingsSource, /Default workspace unavailable/u);

  assert.match(rustSource, /fn workspace_startup_settings_path[\s\S]*\.app_config_dir\(\)/u);
  assert.match(rustSource, /async fn workspace_choose_default\(\s*window: tauri::Window,\s*\)/u);
  assert.match(
    rustSource,
    /let workspace_path = workspace_from_cli\(\)[\s\S]*app_environment_value\("WORKSPACE"\)/u,
  );
  assert.match(rustSource, /if !already_bound[\s\S]*bind_configured_startup_workspace/u);

  for (const command of [
    'workspace_get_startup_settings',
    'workspace_choose_default',
    'workspace_set_open_on_startup',
    'workspace_clear_default',
  ]) {
    assert.match(permissionSource, new RegExp(`"${command}"`, 'u'));
  }
  assert.match(indexSource, /src="desktop-settings\.js/u);
  assert.match(indexSource, /id="desktop-settings-btn"/u);
  assert.match(indexSource, /id="desktop-settings-open-on-startup"/u);
  assert.match(offlineSource, /'\/desktop-settings\.js'/u);
});

test('workspace bootstrap uses the defined help intro and preserves Open Folder recovery', () => {
  const appSource = readProjectFile('src/app/index.ts');
  const configSource = readProjectFile('src/config.ts');

  assert.match(configSource, /function getAppHelpIntro\(\): string/u);
  assert.match(configSource, /Object\.assign\(globalThis,[\s\S]*getAppHelpIntro/u);
  assert.match(appSource, /async function ensureWorkspaceHelpFile\(\)/u);
  assert.match(appSource, /write\('\/Help\.md', getAppHelpIntro\(\) \+ getHelpContent\(\)\)/u);
  assert.doesNotMatch(appSource, /getToolkitHelpIntro/u);
  assert.match(appSource, /openFolderBtn\.style\.display = ''/u);
  assert.doesNotMatch(appSource, /openFolderBtn\.style\.display = 'none'/u);
  assert.match(appSource, /Help\.md is a convenience seed[\s\S]*logError/u);
});

test('manual desktop builds upload candidates while tags alone create releases', () => {
  const workflowSource = readProjectFile('.github/workflows/build-desktop.yml');

  assert.match(workflowSource, /Build candidate[\s\S]*github\.event_name == 'workflow_dispatch'/u);
  assert.match(workflowSource, /uses: actions\/upload-artifact@v4/u);
  assert.match(workflowSource, /retention-days: 7/u);
  assert.match(workflowSource, /cargo test --manifest-path src-tauri\/Cargo\.toml/u);
  assert.match(
    workflowSource,
    /Build and upload release[\s\S]*github\.event_name == 'push' && github\.ref_type == 'tag'/u,
  );
});
