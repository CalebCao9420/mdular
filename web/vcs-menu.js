// Generated from src/ — edit TypeScript and run: npm run build

function escapeVcsHtml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
async function copyTextToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
function vcsKindLabel(kind) {
  if (kind === "git") {
    return "Git";
  }
  if (kind === "svn") {
    return "SVN";
  }
  return "\u672A\u68C0\u6D4B\u5230\u7248\u672C\u5E93";
}
async function refreshVcsMenuContent() {
  const body = document.getElementById("vcs-menu-body");
  if (!body) {
    return;
  }
  await loadWorkspaceConfig(true);
  await detectVcsRepo();
  const kind = getVcsKind();
  const dirty = getDirtyPaths();
  const workspacePath = getWorkspacePath();
  const lines = [];
  lines.push(`<p class="vcs-menu-summary"><strong>${escapeVcsHtml(vcsKindLabel(kind))}</strong>`);
  if (dirty.length) {
    lines.push(` \xB7 <span class="vcs-menu-dirty">${dirty.length} \u4E2A\u672A\u4FDD\u5B58</span>`);
  }
  lines.push("</p>");
  if (dirty.length) {
    lines.push('<ul class="vcs-menu-dirty-list">');
    for (const path of dirty.slice(0, 12)) {
      lines.push(`<li>${escapeVcsHtml(path)}</li>`);
    }
    if (dirty.length > 12) {
      lines.push(`<li>\u2026 \u53E6\u6709 ${dirty.length - 12} \u4E2A</li>`);
    }
    lines.push("</ul>");
    lines.push('<p class="vcs-menu-hint">\u4FA7\u8FB9\u680F\u9AD8\u4EAE\u9879\u5C1A\u672A\u5199\u5165\u78C1\u76D8\uFF1B\u4FDD\u5B58\u540E\u518D\u7528 Git/SVN \u5BA2\u6237\u7AEF commit\u3002</p>');
  }
  if (workspacePath) {
    lines.push(`<p class="vcs-menu-path"><code>${escapeVcsHtml(workspacePath)}</code></p>`);
    lines.push('<div class="vcs-menu-actions">');
    lines.push(
      '<button type="button" id="vcs-copy-path">\u590D\u5236\u5DE5\u4F5C\u533A\u8DEF\u5F84</button>'
    );
    if (kind === "git") {
      lines.push(
        '<button type="button" id="vcs-copy-git-cmd">\u590D\u5236 git status \u547D\u4EE4</button>'
      );
    }
    lines.push("</div>");
    lines.push(
      '<p class="vcs-menu-hint">\u5728\u672C\u673A\u8FD0\u884C <code>scripts/open-vcs.ps1</code>\uFF08\u6216 SourceGit \u2192 Open\uFF09\u6253\u5F00\u4E0A\u8FF0\u8DEF\u5F84\u3002</p>'
    );
  } else {
    lines.push(
      `<p class="vcs-menu-hint">\u5728 <code>${WORKSPACE_CONFIG_PATH}</code> \u6DFB\u52A0 <code>workspacePath</code>\uFF08\u672C\u673A\u7EDD\u5BF9\u8DEF\u5F84\uFF09\uFF0C\u5373\u53EF\u4E00\u952E\u590D\u5236\u8DEF\u5F84\u4E0E git \u547D\u4EE4\u3002</p>`
    );
  }
  body.innerHTML = lines.join("");
  document.getElementById("vcs-copy-path")?.addEventListener("click", () => {
    void copyTextToClipboard(workspacePath).then((ok) => {
      showToast(ok ? "\u8DEF\u5F84\u5DF2\u590D\u5236" : "\u590D\u5236\u5931\u8D25");
    });
  });
  document.getElementById("vcs-copy-git-cmd")?.addEventListener("click", () => {
    const cmd = `cd /d "${workspacePath}" && git status`;
    void copyTextToClipboard(cmd).then((ok) => {
      showToast(ok ? "\u547D\u4EE4\u5DF2\u590D\u5236" : "\u590D\u5236\u5931\u8D25");
    });
  });
}
function openVcsMenu() {
  const modal = document.getElementById("vcs-menu");
  if (!modal) {
    return;
  }
  void refreshVcsMenuContent();
  modal.style.display = "flex";
}
function closeVcsMenu() {
  const modal = document.getElementById("vcs-menu");
  if (modal) {
    modal.style.display = "none";
  }
}
function initVcsMenu() {
  document.getElementById("vcs-status")?.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openVcsMenu();
  });
  document.getElementById("vcs-menu-close")?.addEventListener("click", () => {
    closeVcsMenu();
  });
  document.addEventListener("keydown", (event) => {
    const modal = document.getElementById("vcs-menu");
    if (!modal || modal.style.display === "none") {
      return;
    }
    if (event.key === "Escape") {
      closeVcsMenu();
      event.preventDefault();
      event.stopPropagation();
    }
  });
  document.addEventListener("click", (event) => {
    const modal = document.getElementById("vcs-menu");
    if (!modal || modal.style.display === "none") {
      return;
    }
    if (!modal.contains(event.target)) {
      closeVcsMenu();
    }
  });
}
Object.assign(globalThis, {
  openVcsMenu,
  closeVcsMenu,
  initVcsMenu,
  refreshVcsMenuContent
});
