/// <reference path="../types/global.d.ts" />

interface MdtkWorkspaceConfig {
  /** Plugin folder names under `web/plugins/` (same as `src/plugins/<id>/`). */
  plugins?: string[];
  /** 本机绝对路径，供复制到 SourceGit / Explorer（浏览器无法自动读取 Open folder 路径） */
  workspacePath?: string;
  vcs?: {
    prefer?: 'explorer' | 'sourcegit' | 'tortoisegit';
  };
}

const MDTK_CONFIG_PATH = '/.mdtk/config.json';

let cachedMdtkConfig: MdtkWorkspaceConfig | null = null;

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

async function loadMdtkWorkspaceConfig(forceReload = false): Promise<MdtkWorkspaceConfig> {
  if (cachedMdtkConfig && !forceReload) {
    return cachedMdtkConfig;
  }
  try {
    const text = await read(MDTK_CONFIG_PATH);
    const parsed = JSON.parse(text) as MdtkWorkspaceConfig;
    cachedMdtkConfig = parsed && typeof parsed === 'object' ? parsed : {};
    if (cachedMdtkConfig.plugins) {
      cachedMdtkConfig.plugins = normalizeWorkspacePluginIds(cachedMdtkConfig.plugins);
    }
  } catch (err) {
    cachedMdtkConfig = {};
    log(
      'No readable .mdtk/config.json in workspace (plugins list unavailable from disk).',
      err && (err as Error).message ? (err as Error).message : err
    );
  }
  return cachedMdtkConfig;
}

function getWorkspacePath(): string {
  return (cachedMdtkConfig?.workspacePath || '').trim();
}

Object.assign(globalThis, {
  loadMdtkWorkspaceConfig,
  getWorkspacePath,
  MDTK_CONFIG_PATH,
});
