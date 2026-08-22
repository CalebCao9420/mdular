/// <reference path="../types/global.d.ts" />

const dirtyPaths = new Set<string>();
const dirtyEditorHooks = new WeakSet<object>();
let vcsStatusEl: HTMLElement | null = null;

function markPathDirty(path: string | undefined | null): void {
  if (!path || path.startsWith('/??')) {
    return;
  }
  if (dirtyPaths.has(path)) {
    return;
  }
  dirtyPaths.add(path);
  updateVcsStatusUI();
  renderSidebar('', Array.from(dirtyPaths));
}

function markPathClean(path: string | undefined | null): void {
  if (!path) {
    return;
  }
  if (!dirtyPaths.delete(path)) {
    return;
  }
  updateVcsStatusUI();
  renderSidebar('', dirtyPaths.size ? Array.from(dirtyPaths) : undefined);
}

function getDirtyPaths(): string[] {
  return Array.from(dirtyPaths);
}

function isPathDirty(path: string): boolean {
  return dirtyPaths.has(path);
}

/** @deprecated use detectVcsRepo */
async function detectGitRepo(): Promise<boolean> {
  await detectVcsRepo();
  return isGitRepo();
}

function updateVcsStatusUI(): void {
  if (!vcsStatusEl) {
    vcsStatusEl = document.getElementById('vcs-status');
  }
  if (!vcsStatusEl) {
    return;
  }

  const count = dirtyPaths.size;
  const kind = getVcsKind();
  vcsStatusEl.classList.toggle('vcs-dirty', count > 0);
  vcsStatusEl.classList.toggle('vcs-git', kind === 'git');
  vcsStatusEl.classList.toggle('vcs-svn', kind === 'svn');

  if (count > 0) {
    vcsStatusEl.dataset.tooltip = `${count} 个未保存 · 点击查看版本管理`;
    vcsStatusEl.setAttribute('aria-label', `${count} unsaved changes`);
  } else if (kind === 'git') {
    vcsStatusEl.dataset.tooltip = 'Git 工作区 · 点击查看 / 复制路径';
    vcsStatusEl.setAttribute('aria-label', 'Git repository');
  } else if (kind === 'svn') {
    vcsStatusEl.dataset.tooltip = 'SVN 工作区 · 点击查看';
    vcsStatusEl.setAttribute('aria-label', 'SVN repository');
  } else {
    vcsStatusEl.dataset.tooltip = '版本管理 · 绑定含 .git 的文件夹';
    vcsStatusEl.setAttribute('aria-label', 'Version control');
  }
}

function syncDirtyFromEditor(): void {
  const path = currentEditor?.path;
  if (!path) {
    return;
  }
  if (currentEditor.isClean()) {
    markPathClean(path);
  } else {
    markPathDirty(path);
  }
}

function hookEditorDirty(cm: CodeMirrorEditor): void {
  const editorKey = cm as unknown as object;
  if (dirtyEditorHooks.has(editorKey)) {
    return;
  }
  dirtyEditorHooks.add(editorKey);
  cm.on('change', () => {
    syncDirtyFromEditor();
  });
}

function initVcsDirty(): void {
  vcsStatusEl = document.getElementById('vcs-status');
  void loadWorkspaceConfig().then(() => detectVcsRepo()).then(() => updateVcsStatusUI());

  if (typeof editor !== 'undefined' && editor) {
    hookEditorDirty(editor);
  }
  if (typeof editor2 !== 'undefined' && editor2) {
    hookEditorDirty(editor2);
  }

  initVcsMenu();
}

Object.assign(globalThis, {
  markPathDirty,
  markPathClean,
  getDirtyPaths,
  isPathDirty,
  detectGitRepo,
  detectVcsRepo,
  initVcsDirty,
  syncDirtyFromEditor,
  hookEditorDirty,
});
