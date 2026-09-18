import { TauriRecoveryStore } from './recovery-store.js';
import { tauriDesktopBridge } from './tauri-bridge.js';
import { createTauriWindowLifecycle } from './window-lifecycle.js';
import { DesktopWorkspaceAdapter } from './workspace-adapter.js';
import { DesktopApplication } from './desktop-application.js';

const workspaceAdapter = new DesktopWorkspaceAdapter(tauriDesktopBridge);
const recoveryStore = new TauriRecoveryStore(tauriDesktopBridge);

const application = new DesktopApplication({
  bridge: tauriDesktopBridge,
  workspaceAdapter,
  recoveryStore,
  windowLifecycle: createTauriWindowLifecycle(),
  document,
  window,
});
application.mount();
