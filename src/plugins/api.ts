/// <reference path="../types/global.d.ts" />

interface PluginManifest {
  id: string;
  name: string;
  version?: string;
}

interface PluginToolbarButton {
  id: string;
  title: string;
  ariaLabel?: string;
  html: string;
  onClick: (event: MouseEvent) => void;
}

interface PluginKeyboardShortcut {
  id: string;
  match: (event: KeyboardEvent) => boolean;
  handler: (event: KeyboardEvent) => void;
}

interface PluginViewController {
  id: string;
  isOpen: () => boolean;
  open: () => void | Promise<void>;
  close: () => void;
}

interface MdToolkitPlugin {
  manifest: PluginManifest;
  init: (api: PluginAPI) => void | Promise<void>;
  destroy?: () => void;
}

interface PluginAPI {
  registerToolbarButton(button: PluginToolbarButton): void;
  registerKeyboardShortcut(shortcut: PluginKeyboardShortcut): void;
  registerView(view: PluginViewController): void;
  registerChatArchiveTarget(target: ChatArchiveTarget): void;
  getMountEl(): HTMLElement;
  loadStylesheet(href: string): void;
  onEscape(handler: () => boolean): void;
}

const pluginRegistry = new Map<string, MdToolkitPlugin>();
const activePlugins: MdToolkitPlugin[] = [];
const pluginViews: PluginViewController[] = [];
const pluginEscapeHandlers: Array<() => boolean> = [];
const pluginShortcuts: PluginKeyboardShortcut[] = [];

const loadedPluginIds = new Set<string>();

function registerPlugin(plugin: MdToolkitPlugin): void {
  pluginRegistry.set(plugin.manifest.id, plugin);
}

function createPluginAPI(): PluginAPI {
  const toolbar = document.getElementById('toolbar');
  const mount = document.getElementById('plugin-views');

  return {
    registerToolbarButton(button: PluginToolbarButton): void {
      if (!toolbar) {
        return;
      }
      if (document.getElementById(button.id)) {
        return;
      }
      const el = document.createElement('button');
      el.id = button.id;
      el.type = 'button';
      el.dataset.tooltip = button.title;
      el.setAttribute('aria-label', button.ariaLabel || button.title);
      el.innerHTML = button.html;
      el.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.onClick(event);
      });
      toolbar.appendChild(el);
    },

    registerKeyboardShortcut(shortcut: PluginKeyboardShortcut): void {
      pluginShortcuts.push(shortcut);
    },

    registerView(view: PluginViewController): void {
      pluginViews.push(view);
    },

    getMountEl(): HTMLElement {
      if (!mount) {
        throw new Error('plugin-views mount missing');
      }
      return mount;
    },

    loadStylesheet(href: string): void {
      const id = 'plugin-css-' + href.replace(/[^\w-]+/g, '-');
      if (document.getElementById(id)) {
        return;
      }
      const link = document.createElement('link');
      link.id = id;
      link.rel = 'stylesheet';
      link.href = href + (window.COMMIT_HASH || '');
      document.head.appendChild(link);
    },

    onEscape(handler: () => boolean): void {
      pluginEscapeHandlers.push(handler);
    },

    registerChatArchiveTarget(target: ChatArchiveTarget): void {
      registerChatArchiveTarget(target);
    },
  };
}

function closePluginViews(): void {
  for (const view of pluginViews) {
    if (view.isOpen()) {
      view.close();
    }
  }
}

function handlePluginEscape(): boolean {
  for (let i = pluginEscapeHandlers.length - 1; i >= 0; i--) {
    if (pluginEscapeHandlers[i]()) {
      return true;
    }
  }
  for (const view of pluginViews) {
    if (view.isOpen()) {
      view.close();
      return true;
    }
  }
  return false;
}

function handlePluginKeyboard(event: KeyboardEvent): boolean {
  for (const shortcut of pluginShortcuts) {
    if (shortcut.match(event)) {
      shortcut.handler(event);
      return true;
    }
  }
  return false;
}

function normalizeEnabledPluginIds(plugins: unknown): string[] {
  if (!Array.isArray(plugins)) {
    return [];
  }
  return plugins
    .filter(
      (id): id is string =>
        typeof id === 'string' && /^[a-z0-9][a-z0-9_-]*$/i.test(id.trim())
    )
    .map((id) => id.trim());
}

async function resolvePluginIds(): Promise<string[]> {
  if (typeof getLauncherPlugins === 'function') {
    const fromLauncher = getLauncherPlugins();
    if (fromLauncher.length > 0) {
      const normalizedLauncherIds = normalizeEnabledPluginIds(fromLauncher);
      log('Plugins from launcher (.mdtk/config.json on disk):', normalizedLauncherIds.join(', '));
      return normalizedLauncherIds;
    }
  }

  if (typeof loadMdtkWorkspaceConfig === 'function') {
    const cfg = await loadMdtkWorkspaceConfig(true);
    const fromWorkspace = normalizeEnabledPluginIds(cfg.plugins);
    if (fromWorkspace.length > 0) {
      log('Plugins from workspace .mdtk/config.json:', fromWorkspace.join(', '));
      return fromWorkspace;
    }
  }

  return [];
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src + (window.COMMIT_HASH || '');
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load ' + src));
    document.body.appendChild(script);
  });
}

async function loadPluginScriptList(id: string): Promise<string[]> {
  const manifestUrl = `plugins/${id}/scripts.json`;
  try {
    const response = await fetch(manifestUrl + (window.COMMIT_HASH || ''), { cache: 'no-store' });
    if (response.ok) {
      const files = await response.json();
      if (Array.isArray(files) && files.length > 0) {
        return files
          .filter(
            (file): file is string =>
              typeof file === 'string' && /^[a-z0-9][a-z0-9_.-]*\.js$/i.test(file.trim())
          )
          .map((file) => `plugins/${id}/${file.trim()}`);
      }
    }
  } catch {
    // fall through
  }
  return [`plugins/${id}/index.js`];
}

async function loadPluginById(id: string): Promise<void> {
  if (loadedPluginIds.has(id)) {
    return;
  }

  let plugin = pluginRegistry.get(id);
  if (!plugin) {
    const scripts = await loadPluginScriptList(id);
    for (const src of scripts) {
      await loadScript(src);
    }
    plugin = pluginRegistry.get(id);
  }

  if (!plugin) {
    log('Plugin folder not found or missing index.js:', id);
    return;
  }

  await plugin.init(createPluginAPI());
  activePlugins.push(plugin);
  loadedPluginIds.add(id);
  log('Plugin loaded:', id);
}

async function initPlugins(): Promise<void> {
  const ids = await resolvePluginIds();
  if (ids.length === 0) {
    log('No plugins configured — add "plugins": ["docs", "kanban"] to .mdtk/config.json');
  }

  for (const id of ids) {
    try {
      await loadPluginById(id);
    } catch (err) {
      logError('Plugin load failed:', id, err);
    }
  }

  if (typeof refreshChatArchiveUi === 'function') {
    refreshChatArchiveUi();
  }

  if (typeof getChatArchiveTargets === 'function') {
    log(
      'Chat archive targets after plugins:',
      getChatArchiveTargets()
        .map((t) => t.label)
        .join(', ') || '(none)'
    );
  }
}

Object.assign(globalThis, {
  registerPlugin,
  initPlugins,
  closePluginViews,
  handlePluginEscape,
  handlePluginKeyboard,
});
