// Generated from src/ — edit TypeScript and run: npm run build

const dirtyPaths = /* @__PURE__ */ new Set();
const dirtyEditorHooks = /* @__PURE__ */ new WeakSet();
let vcsStatusEl = null;
function markPathDirty(path) {
  if (!path || path.startsWith("/??")) {
    return;
  }
  if (dirtyPaths.has(path)) {
    return;
  }
  dirtyPaths.add(path);
  updateVcsStatusUI();
  renderSidebar("", Array.from(dirtyPaths));
}
function markPathClean(path) {
  if (!path) {
    return;
  }
  if (!dirtyPaths.delete(path)) {
    return;
  }
  updateVcsStatusUI();
  renderSidebar("", dirtyPaths.size ? Array.from(dirtyPaths) : void 0);
}
function getDirtyPaths() {
  return Array.from(dirtyPaths);
}
function isPathDirty(path) {
  return dirtyPaths.has(path);
}
async function detectGitRepo() {
  await detectVcsRepo();
  return isGitRepo();
}
function updateVcsStatusUI() {
  if (!vcsStatusEl) {
    vcsStatusEl = document.getElementById("vcs-status");
  }
  if (!vcsStatusEl) {
    return;
  }
  const count = dirtyPaths.size;
  const kind = getVcsKind();
  vcsStatusEl.classList.toggle("vcs-dirty", count > 0);
  vcsStatusEl.classList.toggle("vcs-git", kind === "git");
  vcsStatusEl.classList.toggle("vcs-svn", kind === "svn");
  if (count > 0) {
    vcsStatusEl.dataset.tooltip = `${count} \u4E2A\u672A\u4FDD\u5B58 \xB7 \u70B9\u51FB\u67E5\u770B\u7248\u672C\u7BA1\u7406`;
    vcsStatusEl.setAttribute("aria-label", `${count} unsaved changes`);
  } else if (kind === "git") {
    vcsStatusEl.dataset.tooltip = "Git \u5DE5\u4F5C\u533A \xB7 \u70B9\u51FB\u67E5\u770B / \u590D\u5236\u8DEF\u5F84";
    vcsStatusEl.setAttribute("aria-label", "Git repository");
  } else if (kind === "svn") {
    vcsStatusEl.dataset.tooltip = "SVN \u5DE5\u4F5C\u533A \xB7 \u70B9\u51FB\u67E5\u770B";
    vcsStatusEl.setAttribute("aria-label", "SVN repository");
  } else {
    vcsStatusEl.dataset.tooltip = "\u7248\u672C\u7BA1\u7406 \xB7 \u7ED1\u5B9A\u542B .git \u7684\u6587\u4EF6\u5939";
    vcsStatusEl.setAttribute("aria-label", "Version control");
  }
}
function syncDirtyFromEditor() {
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
function hookEditorDirty(cm) {
  const editorKey = cm;
  if (dirtyEditorHooks.has(editorKey)) {
    return;
  }
  dirtyEditorHooks.add(editorKey);
  cm.on("change", () => {
    syncDirtyFromEditor();
  });
}
function initVcsDirty() {
  vcsStatusEl = document.getElementById("vcs-status");
  void loadWorkspaceConfig().then(() => detectVcsRepo()).then(() => updateVcsStatusUI());
  if (typeof editor !== "undefined" && editor) {
    hookEditorDirty(editor);
  }
  if (typeof editor2 !== "undefined" && editor2) {
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
  hookEditorDirty
});
