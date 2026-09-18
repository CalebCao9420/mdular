// Generated from src/ — edit TypeScript and run: npm run build

function startLegacyRuntime() {
  if (!window.COMMIT_HASH) {
    window.COMMIT_HASH = "?v=unknown";
  }
  log("Current version:", window.COMMIT_HASH);
  if (!window.__TAURI__) {
    navigator.serviceWorker?.register(`offline.js${window.COMMIT_HASH}`).then(() => log("Service Worker registered")).catch(() => logError("Service Worker registration failed"));
  }
  window.currentEditor = null;
  editor = initEditor(document.getElementById("editor-textarea"));
  init();
  initReading();
  initNewFileTemplates();
  getProjectScaffoldModal();
  currentEditor = editor;
  editor2 = initEditor(document.getElementById("editor2-textarea"));
}
startLegacyRuntime();
