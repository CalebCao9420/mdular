// Generated from src/ — edit TypeScript and run: npm run build

const WORKSPACE_HINT_DISMISSED_KEY = appStorageKey("workspace-hint-dismissed");
let launcherWorkspacePath = "";
let launcherPluginIds = [];
function getLauncherWorkspacePath() {
  return launcherWorkspacePath;
}
function getLauncherPlugins() {
  return launcherPluginIds.slice();
}
function isTauriHost() {
  return !!window.__TAURI__;
}
async function tauriInvoke(cmd, args) {
  const invoke = window.__TAURI__?.core?.invoke;
  if (!invoke) {
    throw new Error("Tauri invoke unavailable");
  }
  return invoke(cmd, args);
}
function applyAppShellMode(shell) {
  if (shell) {
    document.documentElement.classList.add("app-shell");
  }
}
function removeWorkspaceHintBanner() {
  document.getElementById("app-workspace-hint")?.remove();
}
function showWorkspaceHintBanner(path) {
  if (!path || sessionStorage.getItem(WORKSPACE_HINT_DISMISSED_KEY) === path) {
    return;
  }
  if (document.getElementById("app-workspace-hint")) {
    return;
  }
  const banner = document.createElement("div");
  banner.id = "app-workspace-hint";
  banner.className = "app-workspace-hint";
  banner.innerHTML = '<span class="app-workspace-hint-text">\u542F\u52A8\u5668\u6307\u5B9A\u6587\u4EF6\u5939\uFF1A<code></code></span><div class="app-workspace-hint-actions"><button type="button" id="app-workspace-hint-open">\u6253\u5F00\u6587\u4EF6\u5939</button><button type="button" id="app-workspace-hint-dismiss">\u77E5\u9053\u4E86</button></div>';
  const code = banner.querySelector("code");
  if (code) {
    code.textContent = path;
  }
  const content = document.getElementById("content");
  if (content) {
    content.prepend(banner);
  } else {
    document.body.prepend(banner);
  }
  document.getElementById("app-workspace-hint-open")?.addEventListener("click", () => {
    void openDir();
  });
  document.getElementById("app-workspace-hint-dismiss")?.addEventListener("click", () => {
    sessionStorage.setItem(WORKSPACE_HINT_DISMISSED_KEY, path);
    removeWorkspaceHintBanner();
  });
}
async function loadLauncherHint() {
  try {
    const response = await fetch("/.launcher-hint.json?v=" + Date.now(), { cache: "no-store" });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}
function readUrlLauncherParams() {
  const params = new URLSearchParams(window.location.search);
  const workspacePath = (params.get("workspace") || "").trim();
  const shell = params.get("shell") === "1" || params.get("app") === "1";
  if (!workspacePath && !shell) {
    return null;
  }
  return { workspacePath: workspacePath || void 0, shell };
}
function applyLauncherHint(hint) {
  if (hint?.shell) {
    applyAppShellMode(true);
  }
  const path = (hint?.workspacePath || "").trim();
  if (path) {
    launcherWorkspacePath = path;
  }
  if (hint?.plugins && Array.isArray(hint.plugins)) {
    launcherPluginIds = hint.plugins.filter((id) => typeof id === "string" && id.trim().length > 0).map((id) => id.trim());
  }
}
async function initTauriShell(hint) {
  if (!isTauriHost()) {
    return false;
  }
  initUpdateDownloadPanel();
  applyAppShellMode(true);
  let path = (hint?.workspacePath || "").trim();
  if (!path) {
    try {
      const fromRust = await tauriInvoke("workspace_get_path");
      path = (fromRust || "").trim();
    } catch {
    }
  }
  if (path) {
    launcherWorkspacePath = path;
  }
  if (hint?.plugins && Array.isArray(hint.plugins)) {
    launcherPluginIds = hint.plugins.filter((id) => typeof id === "string" && id.trim().length > 0).map((id) => id.trim());
  }
  log("Tauri shell \xB7 workspace:", path || "(none \u2014 restart with -Folder)");
  if (path) {
    launcherWorkspacePath = path;
    setTauriWorkspaceBound(true);
    removeWorkspaceHintBanner();
    showToast("\u5DF2\u7ED1\u5B9A\u5DE5\u4F5C\u533A\uFF1A" + path);
    return true;
  }
  showWorkspaceHintBanner("");
  return false;
}
let updateHudController = null;
function ensureUpdateDownloadHud() {
  if (updateHudController) {
    return updateHudController;
  }
  let overlay = null;
  let barFill = null;
  let statusEl = null;
  let titleEl = null;
  let subtitleEl = null;
  let percentEl = null;
  let actionsEl = null;
  let hideTimer = null;
  const clearHideTimer = () => {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };
  const ensureOverlay = () => {
    if (overlay) {
      return;
    }
    overlay = document.createElement("div");
    overlay.id = "app-update-overlay";
    overlay.className = "app-update-overlay";
    overlay.hidden = true;
    overlay.innerHTML = '<div class="app-update-panel" role="dialog" aria-labelledby="app-update-title" aria-live="polite"><div class="app-update-header"><h2 id="app-update-title">\u8F6F\u4EF6\u66F4\u65B0</h2><p class="app-update-subtitle"></p></div><p class="app-update-status"></p><div class="app-update-bar" aria-hidden="true"><div class="app-update-bar-fill"></div></div><p class="app-update-percent"></p><div class="app-update-actions"></div></div>';
    document.body.appendChild(overlay);
    statusEl = overlay.querySelector(".app-update-status");
    barFill = overlay.querySelector(".app-update-bar-fill");
    titleEl = overlay.querySelector("#app-update-title");
    subtitleEl = overlay.querySelector(".app-update-subtitle");
    percentEl = overlay.querySelector(".app-update-percent");
    actionsEl = overlay.querySelector(".app-update-actions");
  };
  const setActions = (html) => {
    if (actionsEl) {
      actionsEl.innerHTML = html;
    }
  };
  const showOverlay = () => {
    ensureOverlay();
    if (!overlay) {
      return;
    }
    clearHideTimer();
    overlay.hidden = false;
    overlay.classList.remove("app-update-overlay--error");
  };
  const hideOverlay = () => {
    clearHideTimer();
    if (overlay) {
      overlay.hidden = true;
      overlay.classList.remove(
        "app-update-overlay--error",
        "app-update-overlay--indeterminate",
        "app-update-overlay--installing"
      );
    }
    setActions("");
  };
  const setProgress = (percent, message, opts) => {
    showOverlay();
    if (titleEl) {
      titleEl.textContent = "\u8F6F\u4EF6\u66F4\u65B0";
    }
    if (subtitleEl) {
      subtitleEl.textContent = opts?.version ? `\u65B0\u7248\u672C v${opts.version}` : "";
    }
    if (statusEl) {
      statusEl.textContent = message;
    }
    if (barFill) {
      barFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }
    if (percentEl) {
      percentEl.textContent = opts?.indeterminate || opts?.installing ? "" : percent > 0 ? `${percent}%` : "";
    }
    overlay?.classList.toggle("app-update-overlay--indeterminate", !!opts?.indeterminate);
    overlay?.classList.toggle("app-update-overlay--installing", !!opts?.installing);
    setActions("");
  };
  const showError = (message) => {
    showOverlay();
    overlay?.classList.add("app-update-overlay--error");
    overlay?.classList.remove("app-update-overlay--indeterminate", "app-update-overlay--installing");
    if (titleEl) {
      titleEl.textContent = "\u66F4\u65B0\u5931\u8D25";
    }
    if (subtitleEl) {
      subtitleEl.textContent = "";
    }
    if (statusEl) {
      statusEl.textContent = message;
    }
    if (barFill) {
      barFill.style.width = "0%";
    }
    if (percentEl) {
      percentEl.textContent = "";
    }
    setActions('<button type="button" class="app-update-dismiss">\u5173\u95ED</button>');
    actionsEl?.querySelector(".app-update-dismiss")?.addEventListener("click", hideOverlay, {
      once: true
    });
    clearHideTimer();
    hideTimer = window.setTimeout(hideOverlay, 15e3);
  };
  updateHudController = { setProgress, showError };
  return updateHudController;
}
function handleUpdateHudPayload(payload) {
  const hud = ensureUpdateDownloadHud();
  switch (payload.phase) {
    case "start":
      hud.setProgress(0, "\u51C6\u5907\u4E0B\u8F7D\u2026", { version: payload.version, indeterminate: true });
      break;
    case "progress": {
      const indeterminate = !payload.total && payload.percent === 0;
      hud.setProgress(payload.percent ?? 0, payload.message || "\u6B63\u5728\u4E0B\u8F7D\u2026", { indeterminate });
      break;
    }
    case "installing":
      hud.setProgress(100, "\u4E0B\u8F7D\u5B8C\u6210\uFF0C\u6B63\u5728\u5B89\u88C5\u2026", { version: payload.version, installing: true });
      break;
    case "done":
      hud.setProgress(100, "\u5B89\u88C5\u5B8C\u6210\uFF0C\u6B63\u5728\u91CD\u542F\u2026", { version: payload.version, installing: true });
      break;
    case "error":
      hud.showError(payload.message || "\u672A\u77E5\u9519\u8BEF");
      break;
    default:
      break;
  }
}
function __appUpdateHud(payload) {
  handleUpdateHudPayload(payload);
}
function initUpdateDownloadPanel() {
  ensureUpdateDownloadHud();
  const eventApi = window.__TAURI__?.event;
  if (!eventApi?.listen) {
    return;
  }
  const listen = eventApi.listen.bind(eventApi);
  void listen("update-download-start", (event) => {
    handleUpdateHudPayload({ phase: "start", ...event.payload });
  });
  void listen("update-download-progress", (event) => {
    const p = event.payload;
    handleUpdateHudPayload({
      phase: "progress",
      percent: p.percent ?? 0,
      message: p.message || "\u6B63\u5728\u4E0B\u8F7D\u2026",
      total: p.total
    });
  });
  void listen("update-download-installing", (event) => {
    handleUpdateHudPayload({
      phase: "installing",
      ...event.payload
    });
  });
  void listen("update-download-done", (event) => {
    handleUpdateHudPayload({ phase: "done", ...event.payload });
  });
  void listen("update-download-error", (event) => {
    handleUpdateHudPayload({
      phase: "error",
      message: event.payload.message || "\u672A\u77E5\u9519\u8BEF"
    });
  });
}
if (isTauriHost()) {
  ensureUpdateDownloadHud();
}
async function initDesktopShell() {
  const fromUrl = readUrlLauncherParams();
  const fromFile = await loadLauncherHint();
  const hint = fromFile || fromUrl;
  if (isTauriHost()) {
    return initTauriShell(hint);
  }
  applyLauncherHint(hint);
  const path = getLauncherWorkspacePath();
  if (path) {
    showWorkspaceHintBanner(path);
  }
  return false;
}
Object.assign(globalThis, {
  initDesktopShell,
  getLauncherWorkspacePath,
  getLauncherPlugins,
  isTauriHost,
  tauriInvoke,
  removeWorkspaceHintBanner,
  __appUpdateHud
});
