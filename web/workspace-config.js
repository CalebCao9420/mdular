// Generated from src/ — edit TypeScript and run: npm run build

let cachedWorkspaceConfig = null;
function normalizeWorkspacePluginIds(plugins) {
  if (!Array.isArray(plugins)) {
    return [];
  }
  return plugins.filter(
    (id) => typeof id === "string" && /^[a-z0-9][a-z0-9_-]*$/i.test(id.trim())
  ).map((id) => id.trim());
}
async function loadWorkspaceConfig(forceReload = false) {
  if (cachedWorkspaceConfig && !forceReload) {
    return cachedWorkspaceConfig;
  }
  try {
    const text = await read(WORKSPACE_CONFIG_PATH);
    const parsed = JSON.parse(text);
    cachedWorkspaceConfig = parsed && typeof parsed === "object" ? parsed : {};
    if (cachedWorkspaceConfig.plugins) {
      cachedWorkspaceConfig.plugins = normalizeWorkspacePluginIds(cachedWorkspaceConfig.plugins);
    }
  } catch (err) {
    cachedWorkspaceConfig = {};
    log(
      `No readable ${WORKSPACE_CONFIG_PATH} in workspace (plugins list unavailable from disk).`,
      err && err.message ? err.message : err
    );
  }
  return cachedWorkspaceConfig;
}
function getWorkspacePath() {
  return (cachedWorkspaceConfig?.workspacePath || "").trim();
}
Object.assign(globalThis, {
  loadWorkspaceConfig,
  getWorkspacePath
});
