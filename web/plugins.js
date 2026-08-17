// Generated from src/ — edit TypeScript and run: npm run build

const pluginRegistry = /* @__PURE__ */ new Map();
const activePlugins = [];
const pluginViews = [];
const pluginEscapeHandlers = [];
const pluginShortcuts = [];
const loadedPluginIds = /* @__PURE__ */ new Set();
function registerPlugin(plugin) {
  pluginRegistry.set(plugin.manifest.id, plugin);
}
function createPluginAPI() {
  const toolbar = document.getElementById("toolbar");
  const mount = document.getElementById("plugin-views");
  return {
    registerToolbarButton(button) {
      if (!toolbar) {
        return;
      }
      if (document.getElementById(button.id)) {
        return;
      }
      const el = document.createElement("button");
      el.id = button.id;
      el.type = "button";
      el.dataset.tooltip = button.title;
      el.setAttribute("aria-label", button.ariaLabel || button.title);
      el.innerHTML = button.html;
      el.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        button.onClick(event);
      });
      toolbar.appendChild(el);
    },
    registerKeyboardShortcut(shortcut) {
      pluginShortcuts.push(shortcut);
    },
    registerView(view) {
      pluginViews.push(view);
    },
    getMountEl() {
      if (!mount) {
        throw new Error("plugin-views mount missing");
      }
      return mount;
    },
    loadStylesheet(href) {
      const id = "plugin-css-" + href.replace(/[^\w-]+/g, "-");
      if (document.getElementById(id)) {
        return;
      }
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = href + (window.COMMIT_HASH || "");
      document.head.appendChild(link);
    },
    onEscape(handler) {
      pluginEscapeHandlers.push(handler);
    },
    registerChatArchiveTarget(target) {
      registerChatArchiveTarget(target);
    }
  };
}
function closePluginViews() {
  for (const view of pluginViews) {
    if (view.isOpen()) {
      view.close();
    }
  }
}
function handlePluginEscape() {
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
function handlePluginKeyboard(event) {
  for (const shortcut of pluginShortcuts) {
    if (shortcut.match(event)) {
      shortcut.handler(event);
      return true;
    }
  }
  return false;
}
function normalizeEnabledPluginIds(plugins) {
  if (!Array.isArray(plugins)) {
    return [];
  }
  return plugins.filter(
    (id) => typeof id === "string" && /^[a-z0-9][a-z0-9_-]*$/i.test(id.trim())
  ).map((id) => id.trim());
}
async function resolvePluginIds() {
  if (typeof getLauncherPlugins === "function") {
    const fromLauncher = getLauncherPlugins();
    if (fromLauncher.length > 0) {
      const normalizedLauncherIds = normalizeEnabledPluginIds(fromLauncher);
      log("Plugins from launcher (.mdtk/config.json on disk):", normalizedLauncherIds.join(", "));
      return normalizedLauncherIds;
    }
  }
  if (typeof loadMdtkWorkspaceConfig === "function") {
    const cfg = await loadMdtkWorkspaceConfig(true);
    const fromWorkspace = normalizeEnabledPluginIds(cfg.plugins);
    if (fromWorkspace.length > 0) {
      log("Plugins from workspace .mdtk/config.json:", fromWorkspace.join(", "));
      return fromWorkspace;
    }
  }
  return [];
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src + (window.COMMIT_HASH || "");
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Failed to load " + src));
    document.body.appendChild(script);
  });
}
async function loadPluginScriptList(id) {
  const manifestUrl = `plugins/${id}/scripts.json`;
  try {
    const response = await fetch(manifestUrl + (window.COMMIT_HASH || ""), { cache: "no-store" });
    if (response.ok) {
      const files = await response.json();
      if (Array.isArray(files) && files.length > 0) {
        return files.filter(
          (file) => typeof file === "string" && /^[a-z0-9][a-z0-9_.-]*\.js$/i.test(file.trim())
        ).map((file) => `plugins/${id}/${file.trim()}`);
      }
    }
  } catch {
  }
  return [`plugins/${id}/index.js`];
}
async function loadPluginById(id) {
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
    log("Plugin folder not found or missing index.js:", id);
    return;
  }
  await plugin.init(createPluginAPI());
  activePlugins.push(plugin);
  loadedPluginIds.add(id);
  log("Plugin loaded:", id);
}
async function initPlugins() {
  const ids = await resolvePluginIds();
  if (ids.length === 0) {
    log('No plugins configured \u2014 add "plugins": ["docs", "kanban"] to .mdtk/config.json');
  }
  for (const id of ids) {
    try {
      await loadPluginById(id);
    } catch (err) {
      logError("Plugin load failed:", id, err);
    }
  }
  if (typeof refreshChatArchiveUi === "function") {
    refreshChatArchiveUi();
  }
  if (typeof getChatArchiveTargets === "function") {
    log(
      "Chat archive targets after plugins:",
      getChatArchiveTargets().map((t) => t.label).join(", ") || "(none)"
    );
  }
}
Object.assign(globalThis, {
  registerPlugin,
  initPlugins,
  closePluginViews,
  handlePluginEscape,
  handlePluginKeyboard
});
