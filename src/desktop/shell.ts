/// <reference path="../types/global.d.ts" />

interface LauncherHint {
  workspacePath?: string;
  shell?: boolean;
  /** Plugin folder names under web/plugins/, from the workspace config file. */
  plugins?: string[];
  at?: string;
}

const WORKSPACE_HINT_DISMISSED_KEY = appStorageKey('workspace-hint-dismissed');

let launcherWorkspacePath = '';
let launcherPluginIds: string[] = [];

function getLauncherWorkspacePath(): string {
  return launcherWorkspacePath;
}

function getLauncherPlugins(): string[] {
  return launcherPluginIds.slice();
}

function isTauriHost(): boolean {
  return !!(window as Window & { __TAURI__?: unknown }).__TAURI__;
}

async function tauriInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  type InvokeFn = (command: string, payload?: Record<string, unknown>) => Promise<unknown>;
  const invoke = (window as Window & { __TAURI__?: { core?: { invoke?: InvokeFn } } }).__TAURI__?.core
    ?.invoke;
  if (!invoke) {
    throw new Error('Tauri invoke unavailable');
  }
  return invoke(cmd, args) as Promise<T>;
}

async function selectTauriWorkspaceDirectory(): Promise<string | null> {
  if (!isTauriHost()) {
    throw new Error('Tauri directory picker unavailable outside the desktop host');
  }

  const boundPath = await tauriInvoke<string | null>('workspace_pick_and_bind');
  if (boundPath === null) {
    return null;
  }
  if (typeof boundPath !== 'string' || boundPath.length === 0) {
    throw new Error('Desktop host did not bind the selected workspace');
  }

  launcherWorkspacePath = boundPath;
  setTauriWorkspaceBound(true);
  removeWorkspaceHintBanner();
  return boundPath;
}

function applyAppShellMode(shell: boolean): void {
  if (shell) {
    document.documentElement.classList.add('app-shell');
  }
}

function removeWorkspaceHintBanner(): void {
  document.getElementById('app-workspace-hint')?.remove();
}

function showWorkspaceHintBanner(path: string): void {
  if (!path || sessionStorage.getItem(WORKSPACE_HINT_DISMISSED_KEY) === path) {
    return;
  }
  if (document.getElementById('app-workspace-hint')) {
    return;
  }

  const banner = document.createElement('div');
  banner.id = 'app-workspace-hint';
  banner.className = 'app-workspace-hint';
  banner.innerHTML =
    '<span class="app-workspace-hint-text">启动器指定文件夹：<code></code></span>' +
    '<div class="app-workspace-hint-actions">' +
    '<button type="button" id="app-workspace-hint-open">打开文件夹</button>' +
    '<button type="button" id="app-workspace-hint-dismiss">知道了</button>' +
    '</div>';

  const code = banner.querySelector('code');
  if (code) {
    code.textContent = path;
  }

  const content = document.getElementById('content');
  if (content) {
    content.prepend(banner);
  } else {
    document.body.prepend(banner);
  }

  document.getElementById('app-workspace-hint-open')?.addEventListener('click', () => {
    void openDir();
  });
  document.getElementById('app-workspace-hint-dismiss')?.addEventListener('click', () => {
    sessionStorage.setItem(WORKSPACE_HINT_DISMISSED_KEY, path);
    removeWorkspaceHintBanner();
  });
}

async function loadLauncherHint(): Promise<LauncherHint | null> {
  try {
    const response = await fetch('/.launcher-hint.json?v=' + Date.now(), { cache: 'no-store' });
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as LauncherHint;
  } catch {
    return null;
  }
}

function readUrlLauncherParams(): LauncherHint | null {
  const params = new URLSearchParams(window.location.search);
  const workspacePath = (params.get('workspace') || '').trim();
  const shell = params.get('shell') === '1' || params.get('app') === '1';
  if (!workspacePath && !shell) {
    return null;
  }
  return { workspacePath: workspacePath || undefined, shell };
}

function applyLauncherHint(hint: LauncherHint | null): void {
  if (hint?.shell) {
    applyAppShellMode(true);
  }

  const path = (hint?.workspacePath || '').trim();
  if (path) {
    launcherWorkspacePath = path;
  }

  if (hint?.plugins && Array.isArray(hint.plugins)) {
    launcherPluginIds = hint.plugins
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .map((id) => id.trim());
  }
}

async function initTauriShell(hint: LauncherHint | null): Promise<boolean> {
  if (!isTauriHost()) {
    return false;
  }

  initUpdateDownloadPanel();
  applyAppShellMode(true);

  // In Tauri, only Rust can establish a native workspace capability. A
  // launcher hint is display metadata for the browser shell and may be stale;
  // treating it as a binding can hide Open Folder while Rust has no root.
  let path = '';
  try {
    const fromRust = await tauriInvoke<string | null>('workspace_get_path');
    path = (fromRust || '').trim();
  } catch {
    // No workspace was supplied by the desktop host.
  }

  if (path) {
    launcherWorkspacePath = path;
  }

  if (hint?.plugins && Array.isArray(hint.plugins)) {
    launcherPluginIds = hint.plugins
      .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
      .map((id) => id.trim());
  }

  log('Tauri shell · workspace:', path || '(none — use Open Folder)');

  if (path) {
    launcherWorkspacePath = path;
    setTauriWorkspaceBound(true);
    removeWorkspaceHintBanner();
    showToast('已绑定工作区：' + path);
    return true;
  }

  showWorkspaceHintBanner('');
  return false;
}

type UpdateHudPayload =
  | { phase: 'start'; version?: string }
  | { phase: 'progress'; percent: number; message: string; total?: number | null; downloaded?: number }
  | { phase: 'preparing'; version?: string; message?: string }
  | { phase: 'installing'; version?: string }
  | { phase: 'done'; version?: string; message?: string }
  | { phase: 'blocked'; version?: string; message?: string }
  | { phase: 'error'; message: string };

type UpdateHudController = {
  setProgress: (
    percent: number,
    message: string,
    opts?: { version?: string; indeterminate?: boolean; installing?: boolean },
  ) => void;
  showError: (message: string) => void;
};

let updateHudController: UpdateHudController | null = null;

function ensureUpdateDownloadHud(): UpdateHudController {
  if (updateHudController) {
    return updateHudController;
  }

  let overlay: HTMLElement | null = null;
  let barFill: HTMLElement | null = null;
  let statusEl: HTMLElement | null = null;
  let titleEl: HTMLElement | null = null;
  let subtitleEl: HTMLElement | null = null;
  let percentEl: HTMLElement | null = null;
  let actionsEl: HTMLElement | null = null;
  let hideTimer: ReturnType<typeof setTimeout> | null = null;

  const clearHideTimer = (): void => {
    if (hideTimer) {
      window.clearTimeout(hideTimer);
      hideTimer = null;
    }
  };

  const ensureOverlay = (): void => {
    if (overlay) {
      return;
    }
    overlay = document.createElement('div');
    overlay.id = 'app-update-overlay';
    overlay.className = 'app-update-overlay';
    overlay.hidden = true;
    overlay.innerHTML =
      '<div class="app-update-panel" role="dialog" aria-labelledby="app-update-title" aria-live="polite">' +
      '<div class="app-update-header">' +
      '<h2 id="app-update-title">软件更新</h2>' +
      '<p class="app-update-subtitle"></p>' +
      '</div>' +
      '<p class="app-update-status"></p>' +
      '<div class="app-update-bar" aria-hidden="true"><div class="app-update-bar-fill"></div></div>' +
      '<p class="app-update-percent"></p>' +
      '<div class="app-update-actions"></div>' +
      '</div>';
    document.body.appendChild(overlay);
    statusEl = overlay.querySelector('.app-update-status');
    barFill = overlay.querySelector('.app-update-bar-fill');
    titleEl = overlay.querySelector('#app-update-title');
    subtitleEl = overlay.querySelector('.app-update-subtitle');
    percentEl = overlay.querySelector('.app-update-percent');
    actionsEl = overlay.querySelector('.app-update-actions');
  };

  const setActions = (html: string): void => {
    if (actionsEl) {
      actionsEl.innerHTML = html;
    }
  };

  const showOverlay = (): void => {
    ensureOverlay();
    if (!overlay) {
      return;
    }
    clearHideTimer();
    overlay.hidden = false;
    overlay.classList.remove('app-update-overlay--error');
  };

  const hideOverlay = (): void => {
    clearHideTimer();
    if (overlay) {
      overlay.hidden = true;
      overlay.classList.remove(
        'app-update-overlay--error',
        'app-update-overlay--indeterminate',
        'app-update-overlay--installing',
      );
    }
    setActions('');
  };

  const setProgress = (
    percent: number,
    message: string,
    opts?: { version?: string; indeterminate?: boolean; installing?: boolean },
  ): void => {
    showOverlay();
    if (titleEl) {
      titleEl.textContent = '软件更新';
    }
    if (subtitleEl) {
      subtitleEl.textContent = opts?.version ? `新版本 v${opts.version}` : '';
    }
    if (statusEl) {
      statusEl.textContent = message;
    }
    if (barFill) {
      barFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;
    }
    if (percentEl) {
      percentEl.textContent =
        opts?.indeterminate || opts?.installing ? '' : percent > 0 ? `${percent}%` : '';
    }
    overlay?.classList.toggle('app-update-overlay--indeterminate', !!opts?.indeterminate);
    overlay?.classList.toggle('app-update-overlay--installing', !!opts?.installing);
    setActions('');
  };

  const showError = (message: string): void => {
    showOverlay();
    overlay?.classList.add('app-update-overlay--error');
    overlay?.classList.remove('app-update-overlay--indeterminate', 'app-update-overlay--installing');
    if (titleEl) {
      titleEl.textContent = '更新失败';
    }
    if (subtitleEl) {
      subtitleEl.textContent = '';
    }
    if (statusEl) {
      statusEl.textContent = message;
    }
    if (barFill) {
      barFill.style.width = '0%';
    }
    if (percentEl) {
      percentEl.textContent = '';
    }
    setActions('<button type="button" class="app-update-dismiss">关闭</button>');
    actionsEl?.querySelector('.app-update-dismiss')?.addEventListener('click', hideOverlay, {
      once: true,
    });
    clearHideTimer();
    hideTimer = window.setTimeout(hideOverlay, 15000);
  };

  updateHudController = { setProgress, showError };
  return updateHudController;
}

function handleUpdateHudPayload(payload: UpdateHudPayload): void {
  const hud = ensureUpdateDownloadHud();
  switch (payload.phase) {
    case 'start':
      hud.setProgress(0, '准备下载…', { version: payload.version, indeterminate: true });
      break;
    case 'progress': {
      const indeterminate = !payload.total && payload.percent === 0;
      hud.setProgress(payload.percent ?? 0, payload.message || '正在下载…', { indeterminate });
      break;
    }
    case 'preparing':
      hud.setProgress(100, payload.message || '正在保护未保存内容…', {
        version: payload.version,
        indeterminate: true,
      });
      break;
    case 'installing':
      hud.setProgress(100, '下载完成，正在安装…', { version: payload.version, installing: true });
      break;
    case 'done':
      hud.setProgress(100, payload.message || '安装完成，正在重启…', {
        version: payload.version,
        installing: true,
      });
      break;
    case 'blocked':
      hud.showError(payload.message || '应用状态尚未安全保存，更新已取消。');
      break;
    case 'error':
      hud.showError(payload.message || '未知错误');
      break;
    default:
      break;
  }
}

function __appUpdateHud(payload: UpdateHudPayload): void {
  handleUpdateHudPayload(payload);
}

function legacyPrepareRestartResult(): {
  kind: 'ready' | 'blocked';
  reasons?: Array<{ kind: 'save-in-progress' | 'unsaved-changes' }>;
} {
  const reasons: Array<{ kind: 'save-in-progress' | 'unsaved-changes' }> = [];
  if (
    ('undefined' !== typeof isSaving && isSaving) ||
    ('undefined' !== typeof isMessingWithCurrentEditor && isMessingWithCurrentEditor)
  ) {
    reasons.push({ kind: 'save-in-progress' });
  }
  const editors = [
    'undefined' === typeof editor ? null : editor,
    'undefined' === typeof editor2 ? null : editor2,
  ];
  if (
    editors.some((candidate) => candidate && !candidate.isClean()) ||
    ('undefined' !== typeof chatIsClean && !chatIsClean)
  ) {
    reasons.push({ kind: 'unsaved-changes' });
  }
  return 0 === reasons.length ? { kind: 'ready' } : { kind: 'blocked', reasons };
}

async function respondToLegacyRestartRequest(payload: unknown): Promise<void> {
  if (!payload || 'object' !== typeof payload || Array.isArray(payload)) { return; }
  const request = payload as Record<string, unknown>;
  if (
    'string' !== typeof request.requestId ||
    !/^restart-[1-9][0-9]*$/u.test(request.requestId) ||
    128 < request.requestId.length ||
    60_000 !== request.timeoutMs
  ) { return; }
  await tauriInvoke('updater_respond_prepare_restart', {
    requestId: request.requestId,
    result: legacyPrepareRestartResult(),
  });
}

function initUpdateDownloadPanel(): void {
  ensureUpdateDownloadHud();

  type ListenFn = (
    event: string,
    handler: (event: { payload: unknown }) => void,
  ) => Promise<() => void>;
  const eventApi = (window as Window & { __TAURI__?: { event?: { listen?: ListenFn } } }).__TAURI__
    ?.event;
  if (!eventApi?.listen) {
    return;
  }

  const listen = eventApi.listen.bind(eventApi);

  void listen('update-download-start', (event) => {
    handleUpdateHudPayload({ phase: 'start', ...(event.payload as { version?: string }) });
  });
  void listen('update-download-progress', (event) => {
    const p = event.payload as {
      percent?: number;
      message?: string;
      total?: number | null;
    };
    handleUpdateHudPayload({
      phase: 'progress',
      percent: p.percent ?? 0,
      message: p.message || '正在下载…',
      total: p.total,
    });
  });
  void listen('update-download-preparing', (event) => {
    handleUpdateHudPayload({
      phase: 'preparing',
      ...(event.payload as { version?: string; message?: string }),
    });
  });
  void listen('update-download-installing', (event) => {
    handleUpdateHudPayload({
      phase: 'installing',
      ...(event.payload as { version?: string }),
    });
  });
  void listen('update-download-done', (event) => {
    handleUpdateHudPayload({
      phase: 'done',
      ...(event.payload as { version?: string; message?: string }),
    });
  });
  void listen('update-download-blocked', (event) => {
    handleUpdateHudPayload({
      phase: 'blocked',
      ...(event.payload as { version?: string; message?: string }),
    });
  });
  void listen('update-download-error', (event) => {
    handleUpdateHudPayload({
      phase: 'error',
      message: (event.payload as { message?: string }).message || '未知错误',
    });
  });
  void listen('update-prepare-restart', (event) => {
    void respondToLegacyRestartRequest(event.payload).catch(() => {
      handleUpdateHudPayload({ phase: 'error', message: '无法确认重启前的文档状态。' });
    });
  });
}

if (isTauriHost()) {
  ensureUpdateDownloadHud();
}

async function initDesktopShell(): Promise<boolean> {
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
  selectTauriWorkspaceDirectory,
  removeWorkspaceHintBanner,
  __appUpdateHud,
});
