// Generated from src/ — edit TypeScript and run: npm run build

(() => {
  // src/runtime/storage-migration.ts
  var V2_STORAGE_MIGRATION_MARKER_KEY = `${"mdular"}:v2:migration:v1`;
  var V2_LEGACY_IMPORT_PREFIX = `${"mdular"}:v2:legacy-import:v1:`;
  var V0_0_5_IMPORTABLE_LOCAL_STORAGE_KEYS = Object.freeze([
    `${"mdular"}:default-template`,
    `${"mdular"}:read-mode`,
    `${"mdular"}:outline-collapsed`,
    `${"mdular"}:kanban-open`,
    `${"mdular"}:ticket-layout`,
    `${"mdular"}:kanban-filter`,
    `${"mdular"}:kanban-filter-presets`
  ]);
  function parseCompleteMarker(encoded) {
    try {
      const value = JSON.parse(encoded);
      if (!value || "object" !== typeof value || Array.isArray(value)) {
        return null;
      }
      const marker = value;
      if (1 !== marker.schemaVersion || "v0.0.5-to-v0.1.0" !== marker.migration || "complete" !== marker.status || !Array.isArray(marker.importedKeys) || marker.importedKeys.some((key) => "string" !== typeof key)) {
        return null;
      }
      const importedKeys = marker.importedKeys;
      if (new Set(importedKeys).size !== importedKeys.length || importedKeys.some((key) => !V0_0_5_IMPORTABLE_LOCAL_STORAGE_KEYS.includes(
        key
      ))) {
        return null;
      }
      return {
        schemaVersion: 1,
        migration: "v0.0.5-to-v0.1.0",
        status: "complete",
        importedKeys: Object.freeze([...importedKeys])
      };
    } catch {
      return null;
    }
  }
  function importedStorageKey(sourceKey) {
    return `${V2_LEGACY_IMPORT_PREFIX}${encodeURIComponent(sourceKey)}`;
  }
  function migrateV0_0_5LocalStorage(storage) {
    let marker;
    try {
      marker = storage.getItem(V2_STORAGE_MIGRATION_MARKER_KEY);
    } catch {
      return { kind: "failed", reason: "read" };
    }
    if (null !== marker) {
      const parsed = parseCompleteMarker(marker);
      return parsed ? {
        kind: "complete",
        importedKeys: parsed.importedKeys,
        alreadyComplete: true
      } : { kind: "failed", reason: "invalid-marker" };
    }
    const importedKeys = [];
    try {
      for (const sourceKey of V0_0_5_IMPORTABLE_LOCAL_STORAGE_KEYS) {
        const value = storage.getItem(sourceKey);
        if (null === value) {
          continue;
        }
        storage.setItem(importedStorageKey(sourceKey), JSON.stringify({
          schemaVersion: 1,
          sourceKey,
          value
        }));
        importedKeys.push(sourceKey);
      }
    } catch {
      return { kind: "failed", reason: "write" };
    }
    const completion = {
      schemaVersion: 1,
      migration: "v0.0.5-to-v0.1.0",
      status: "complete",
      importedKeys
    };
    try {
      storage.setItem(V2_STORAGE_MIGRATION_MARKER_KEY, JSON.stringify(completion));
    } catch {
      return { kind: "failed", reason: "write" };
    }
    return {
      kind: "complete",
      importedKeys: Object.freeze([...importedKeys]),
      alreadyComplete: false
    };
  }

  // src/runtime/runtime-bootstrap.ts
  var LEGACY_SCRIPT_PATHS = Object.freeze([
    "lib/latex/katex.min.js",
    "lib/sidebar.js",
    "lib/codemirror.js",
    "lib/core.js",
    "lib/markdown.js",
    "lib/hypermd.js",
    "lib/keymap.js",
    "lib/click.js",
    "lib/hide-token.js",
    "lib/fold.js",
    "lib/fold-image.js",
    "lib/fold-link.js",
    "lib/fold-code.js",
    "lib/latex/fold-math.js",
    "lib/hypermd-mermaid.js",
    "lib/table-align.js",
    "lib/autocomplete-link.js",
    "lib/show-hint.js",
    "lib/autoscroll.js",
    "lib/codemirror-go.js",
    "lib/codemirror-python.js",
    "lib/codemirror-javascript.js",
    "lib/codemirror-php.js",
    "lib/codemirror-shell.js",
    "lib/similarity.js",
    "lib/emoji.js",
    "config.js",
    "desktop-shell.js",
    "desktop-settings.js",
    "tauri-fs.js",
    "lib/fs.js",
    "lib/md.js",
    "welcome.js",
    "files.js",
    "reading-parse.js",
    "reading.js",
    "templates.js",
    "plugins/kanban/default-seeds.js",
    "project-structure.js",
    "search.js",
    "workspace-config.js",
    "plugins/chat-archive.js",
    "chat.js",
    "plugins.js",
    "vcs-repo.js",
    "vcs-menu.js",
    "vcs-dirty.js",
    "editor.js",
    "app.js",
    "modals.js",
    "legacy-bootstrap.js"
  ]);
  var V2_EDITOR_SCRIPT_PATHS = Object.freeze([
    "lib/codemirror.js",
    "lib/markdown.js"
  ]);
  var V2_STYLE_PATH = "v2.css";
  var RUNTIME_STORAGE_KEY = `${"mdular"}:runtime-mode`;
  function failSafe(diagnostic) {
    return { mode: "legacy", source: "failSafe", diagnostic };
  }
  function isRuntimeMode(value) {
    return "legacy" === value || "v2" === value;
  }
  function isRuntimeModeSource(value) {
    return "environment" === value || "appConfig" === value || "default" === value || "failSafe" === value;
  }
  function parseRuntimeResolution(value) {
    if (!value || "object" !== typeof value) {
      return null;
    }
    const record = value;
    if (!isRuntimeMode(record.mode) || !isRuntimeModeSource(record.source)) {
      return null;
    }
    const diagnostic = record.diagnostic;
    if (void 0 !== diagnostic && "string" !== typeof diagnostic) {
      return null;
    }
    if ("string" === typeof diagnostic) {
      return { mode: record.mode, source: record.source, diagnostic };
    }
    return { mode: record.mode, source: record.source };
  }
  function resolveBrowserRuntimeMode(storage) {
    let encoded;
    try {
      encoded = storage.getItem(RUNTIME_STORAGE_KEY);
    } catch {
      return failSafe("Browser runtime setting is unavailable; using legacy");
    }
    if (null === encoded) {
      return { mode: "legacy", source: "default" };
    }
    try {
      const parsed = JSON.parse(encoded);
      if (1 !== parsed.schemaVersion || !isRuntimeMode(parsed.mode)) {
        return failSafe("Browser runtime setting is invalid; using legacy");
      }
      return { mode: parsed.mode, source: "appConfig" };
    } catch {
      return failSafe("Browser runtime setting is invalid; using legacy");
    }
  }
  function tauriCoreBridge() {
    const candidate = window.__TAURI__?.core;
    return candidate && "function" === typeof candidate.invoke ? candidate : null;
  }
  async function resolveRuntimeMode() {
    const bridge = tauriCoreBridge();
    if (!bridge) {
      try {
        return resolveBrowserRuntimeMode(window.localStorage);
      } catch {
        return failSafe("Browser runtime setting is unavailable; using legacy");
      }
    }
    try {
      const result = parseRuntimeResolution(await bridge.invoke("runtime_get_mode"));
      return result ?? failSafe("Desktop runtime setting response is invalid; using legacy");
    } catch {
      return failSafe("Desktop runtime setting could not be read; using legacy");
    }
  }
  function applyV2StorageMigration(resolution, storage) {
    if ("v2" !== resolution.mode) {
      return resolution;
    }
    const migration = migrateV0_0_5LocalStorage(storage);
    if ("complete" === migration.kind) {
      return resolution;
    }
    return failSafe(
      `V2 local storage migration could not complete (${migration.reason}); using legacy`
    );
  }
  async function activateRuntime(resolution, loaders) {
    if ("v2" === resolution.mode) {
      await loaders.activateV2();
      return;
    }
    await loaders.activateLegacy();
  }
  function versioned(path) {
    return `${path}${window.COMMIT_HASH ?? ""}`;
  }
  async function loadClassicScript(path) {
    await new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = versioned(path);
      script.async = false;
      script.addEventListener("load", () => resolve(), { once: true });
      script.addEventListener("error", () => reject(new Error(`Failed to load ${path}`)), {
        once: true
      });
      document.head.append(script);
    });
  }
  async function loadStyleSheet(path) {
    await new Promise((resolve, reject) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = versioned(path);
      link.addEventListener("load", () => resolve(), { once: true });
      link.addEventListener("error", () => reject(new Error(`Failed to load ${path}`)), {
        once: true
      });
      document.head.append(link);
    });
  }
  async function activateLegacy() {
    for (const path of LEGACY_SCRIPT_PATHS) {
      await loadClassicScript(path);
    }
  }
  async function activateV2() {
    await loadStyleSheet(V2_STYLE_PATH);
    for (const path of V2_EDITOR_SCRIPT_PATHS) {
      await loadClassicScript(path);
    }
    const entry = tauriCoreBridge() ? "v2/desktop.js" : "v2/web.js";
    await import(versioned(entry));
  }
  function renderStartupFailure(error) {
    const message = error instanceof Error ? error.message : String(error);
    const panel = document.createElement("main");
    panel.id = "runtime-startup-error";
    panel.setAttribute("role", "alert");
    const title = document.createElement("h1");
    title.textContent = `${"mdular"} could not start`;
    const detail = document.createElement("p");
    detail.textContent = `${message}. Restart with the runtime environment override set to legacy to recover.`;
    panel.append(title, detail);
    document.body.replaceChildren(panel);
  }
  async function startRuntime() {
    const selectedResolution = await resolveRuntimeMode();
    let resolution = selectedResolution;
    if ("v2" === selectedResolution.mode) {
      try {
        resolution = applyV2StorageMigration(selectedResolution, window.localStorage);
      } catch {
        resolution = failSafe("V2 local storage migration is unavailable; using legacy");
      }
    }
    window.__APP_RUNTIME__ = Object.freeze({ ...resolution });
    document.documentElement.dataset.runtimeMode = resolution.mode;
    document.documentElement.dataset.runtimeSource = resolution.source;
    if (resolution.diagnostic) {
      console.warn(resolution.diagnostic);
    }
    try {
      await activateRuntime(resolution, { activateLegacy, activateV2 });
    } catch (error) {
      console.error("Runtime startup failed", error);
      renderStartupFailure(error);
    }
  }
  if ("undefined" !== typeof window && "undefined" !== typeof document) {
    void startRuntime();
  }
})();
