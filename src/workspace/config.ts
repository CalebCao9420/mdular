/// <reference path="../types/global.d.ts" />

interface AppWorkspaceConfig {
  /** Plugin folder names under `web/plugins/` (same as `src/plugins/<id>/`). */
  plugins?: string[];
  /** 本机绝对路径，供复制到 SourceGit / Explorer（浏览器无法自动读取 Open folder 路径） */
  workspacePath?: string;
  vcs?: {
    prefer?: 'explorer' | 'sourcegit' | 'tortoisegit';
  };
}

let cachedWorkspaceConfig: AppWorkspaceConfig | null = null;

function normalizeWorkspacePluginIds(plugins: unknown): string[] {
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

async function loadWorkspaceConfig(forceReload = false): Promise<AppWorkspaceConfig> {
  if (cachedWorkspaceConfig && !forceReload) {
    return cachedWorkspaceConfig;
  }
  try {
    const text = await read(WORKSPACE_CONFIG_PATH);
    const parsed = JSON.parse(text) as AppWorkspaceConfig;
    cachedWorkspaceConfig = parsed && typeof parsed === 'object' ? parsed : {};
    if (cachedWorkspaceConfig.plugins) {
      cachedWorkspaceConfig.plugins = normalizeWorkspacePluginIds(cachedWorkspaceConfig.plugins);
    }
  } catch (err) {
    cachedWorkspaceConfig = {};
    log(
      `No readable ${WORKSPACE_CONFIG_PATH} in workspace (plugins list unavailable from disk).`,
      err && (err as Error).message ? (err as Error).message : err
    );
  }
  return cachedWorkspaceConfig;
}

function getWorkspacePath(): string {
  return (cachedWorkspaceConfig?.workspacePath || '').trim();
}

Object.assign(globalThis, {
  loadWorkspaceConfig,
  getWorkspacePath,
});
