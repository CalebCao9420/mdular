/**
 * The only V1 startup edge. Runtime routing loads this file after every legacy
 * dependency has loaded, so a process activates either V1 or V2, never both.
 */
function startLegacyRuntime(): void {
  if (!window.COMMIT_HASH) {
    window.COMMIT_HASH = '?v=unknown';
  }
  log('Current version:', window.COMMIT_HASH);

  // Offline SW is for browser/PWA only — Tauri loads local files; SW caches stale JS.
  if (!window.__TAURI__) {
    navigator.serviceWorker?.register(`offline.js${window.COMMIT_HASH}`)
      .then(() => log('Service Worker registered'))
      .catch(() => logError('Service Worker registration failed'));
  }

  window.currentEditor = null;
  editor = initEditor(document.getElementById('editor-textarea'));
  init();
  initReading();
  initNewFileTemplates();
  getProjectScaffoldModal();
  currentEditor = editor;

  editor2 = initEditor(document.getElementById('editor2-textarea'));
}

startLegacyRuntime();
