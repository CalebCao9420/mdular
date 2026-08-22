/// <reference path="../types/global.d.ts" />

function escapeVcsHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function vcsKindLabel(kind: VcsKind): string {
  if (kind === 'git') {
    return 'Git';
  }
  if (kind === 'svn') {
    return 'SVN';
  }
  return '未检测到版本库';
}

async function refreshVcsMenuContent(): Promise<void> {
  const body = document.getElementById('vcs-menu-body');
  if (!body) {
    return;
  }

  await loadWorkspaceConfig(true);
  await detectVcsRepo();

  const kind = getVcsKind();
  const dirty = getDirtyPaths();
  const workspacePath = getWorkspacePath();
  const lines: string[] = [];

  lines.push(`<p class="vcs-menu-summary"><strong>${escapeVcsHtml(vcsKindLabel(kind))}</strong>`);
  if (dirty.length) {
    lines.push(` · <span class="vcs-menu-dirty">${dirty.length} 个未保存</span>`);
  }
  lines.push('</p>');

  if (dirty.length) {
    lines.push('<ul class="vcs-menu-dirty-list">');
    for (const path of dirty.slice(0, 12)) {
      lines.push(`<li>${escapeVcsHtml(path)}</li>`);
    }
    if (dirty.length > 12) {
      lines.push(`<li>… 另有 ${dirty.length - 12} 个</li>`);
    }
    lines.push('</ul>');
    lines.push('<p class="vcs-menu-hint">侧边栏高亮项尚未写入磁盘；保存后再用 Git/SVN 客户端 commit。</p>');
  }

  if (workspacePath) {
    lines.push(`<p class="vcs-menu-path"><code>${escapeVcsHtml(workspacePath)}</code></p>`);
    lines.push('<div class="vcs-menu-actions">');
    lines.push(
      '<button type="button" id="vcs-copy-path">复制工作区路径</button>'
    );
    if (kind === 'git') {
      lines.push(
        '<button type="button" id="vcs-copy-git-cmd">复制 git status 命令</button>'
      );
    }
    lines.push('</div>');
    lines.push(
      '<p class="vcs-menu-hint">在本机运行 <code>scripts/open-vcs.ps1</code>（或 SourceGit → Open）打开上述路径。</p>'
    );
  } else {
    lines.push(
      `<p class="vcs-menu-hint">在 <code>${WORKSPACE_CONFIG_PATH}</code> 添加 <code>workspacePath</code>（本机绝对路径），即可一键复制路径与 git 命令。</p>`
    );
  }

  body.innerHTML = lines.join('');

  document.getElementById('vcs-copy-path')?.addEventListener('click', () => {
    void copyTextToClipboard(workspacePath).then((ok) => {
      showToast(ok ? '路径已复制' : '复制失败');
    });
  });

  document.getElementById('vcs-copy-git-cmd')?.addEventListener('click', () => {
    const cmd = `cd /d "${workspacePath}" && git status`;
    void copyTextToClipboard(cmd).then((ok) => {
      showToast(ok ? '命令已复制' : '复制失败');
    });
  });
}

function openVcsMenu(): void {
  const modal = document.getElementById('vcs-menu');
  if (!modal) {
    return;
  }
  void refreshVcsMenuContent();
  modal.style.display = 'flex';
}

function closeVcsMenu(): void {
  const modal = document.getElementById('vcs-menu');
  if (modal) {
    modal.style.display = 'none';
  }
}

function initVcsMenu(): void {
  document.getElementById('vcs-status')?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    openVcsMenu();
  });

  document.getElementById('vcs-menu-close')?.addEventListener('click', () => {
    closeVcsMenu();
  });

  document.addEventListener('keydown', (event) => {
    const modal = document.getElementById('vcs-menu');
    if (!modal || modal.style.display === 'none') {
      return;
    }
    if (event.key === 'Escape') {
      closeVcsMenu();
      event.preventDefault();
      event.stopPropagation();
    }
  });

  document.addEventListener('click', (event) => {
    const modal = document.getElementById('vcs-menu');
    if (!modal || modal.style.display === 'none') {
      return;
    }
    if (!modal.contains(event.target as Node)) {
      closeVcsMenu();
    }
  });
}

Object.assign(globalThis, {
  openVcsMenu,
  closeVcsMenu,
  initVcsMenu,
  refreshVcsMenuContent,
});
