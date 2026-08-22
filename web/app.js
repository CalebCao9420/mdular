// Generated from src/ — edit TypeScript and run: npm run build

const sidebar = document.getElementById("sidebar");
const content = document.getElementById("content");
const CHAT_PATH = "/Chat.md";
const LATER_PATH = "/Later.md";
const READ_PATH = "/Read.md";
const SHOP_PATH = "/Shop.md";
const WATCH_PATH = "/Watch.md";
const LOG_PATH = "/archive/Log.txt";
const OPEN_CHAT_AFTER_IDLE = 60 * 60 * 1e3;
let openChatIdleTimer = null;
let isChat = false;
let isMemFS = false;
let debug = false;
async function init() {
  migrateLegacyStorage();
  if (location.hostname === "localhost" && navigator.serviceWorker?.getRegistrations) {
    void navigator.serviceWorker.getRegistrations().then((regs) => {
      for (const reg of regs) {
        void reg.unregister();
      }
    });
  }
  if (typeof isTauriHost === "function" && isTauriHost() && navigator.serviceWorker?.getRegistrations) {
    void navigator.serviceWorker.getRegistrations().then(async (regs) => {
      for (const reg of regs) {
        await reg.unregister();
      }
      if (typeof caches !== "undefined") {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    });
  }
  const shellWorkspaceBound = await initDesktopShell();
  if (navigator.storage && navigator.storage.persist) {
    const persisted = await navigator.storage.persist();
    log("Storage persisted:", persisted);
  }
  const savedDirHandle = await getSavedRootDirHandle();
  const hasSavedLocalDir = !shellWorkspaceBound && savedDirHandle instanceof FileSystemDirectoryHandle;
  if (shellWorkspaceBound || hasSavedLocalDir) {
    isMemFS = false;
    document.getElementById("open-folder").style.display = "none";
    const openFolderBtn = document.getElementById("open-folder-btn");
    if (openFolderBtn) {
      openFolderBtn.style.display = "none";
    }
  } else if (typeof window.showDirectoryPicker === "function") {
    document.getElementById("open-folder").style.display = "flex";
    isMemFS = true;
  } else {
    document.getElementById("open-folder").style.display = "none";
    isMemFS = true;
  }
  if (isMemFS) {
    prefetchWelcomeImages();
  }
  if (isChrome() && hasSavedLocalDir) {
    const permission = await (await getRootDirHandle()).queryPermission({ mode: "readwrite" });
    log("PERMISSION", permission);
    if (permission !== "granted") {
      document.getElementById("open-folder").style.display = "flex";
      await removeSavedRootDirHandle();
      alert(`Can't access folder.

Please, reopen the folder again and check "Allow on every visit" checkbox`);
    }
  }
  if (!shellWorkspaceBound) {
    let rootDirHandle = await getRootDirHandle();
    let perf2 = performance.now();
    files = await loadLocalFiles(rootDirHandle);
    log(`Files loaded in ${performance.now() - perf2}ms`);
  } else {
    let perf2 = performance.now();
    if (!await exists("/Help.md")) {
      await write("/Help.md", getToolkitHelpIntro() + getHelpContent());
    }
    files = await loadLocalFiles(null);
    log(`Tauri workspace loaded in ${performance.now() - perf2}ms`);
  }
  initChat();
  initVcsDirty();
  let perf = performance.now();
  renderSidebar();
  log(`Sidebar built in: ${(performance.now() - perf).toFixed(3)} milliseconds`);
  await loadWorkspaceConfig(true);
  await initPlugins();
  if (isMemFS) {
    await openFile("/?? Welcome.md");
  } else {
    await openChat();
  }
  if (typeof refreshChatArchiveUi === "function") {
    refreshChatArchiveUi();
  }
  scheduleEditorLayoutRefresh();
  log(`Files initialized in: ${(performance.now() - perf).toFixed(3)} milliseconds`);
}
function scheduleEditorLayoutRefresh() {
  bindEditorContainerResize();
  const refresh = () => {
    if (typeof isChat !== "undefined" && isChat && typeof fitChatLayout === "function") {
      fitChatLayout();
      return;
    }
    if (typeof fitEditorLayout === "function") {
      if (typeof editor !== "undefined") {
        fitEditorLayout(editor);
      }
      if (typeof editor2 !== "undefined") {
        fitEditorLayout(editor2);
      }
      return;
    }
    if (typeof editor !== "undefined") {
      editor.refresh();
    }
    if (typeof editor2 !== "undefined") {
      editor2.refresh();
    }
  };
  requestAnimationFrame(() => {
    refresh();
    requestAnimationFrame(refresh);
  });
}
function createAutocompleteDict() {
  const entries = [];
  const currentPath = currentEditor && currentEditor.path;
  walkFilesExcludingSystemDirs((path) => {
    if (path === CONFIG_PATH || path === CHAT_PATH || path === LATER_PATH || path === READ_PATH || path === WATCH_PATH || path === SHOP_PATH) {
      return;
    }
    if (path === currentPath) {
      return;
    }
    const filename = toFilename(path);
    const key = `${filename.replace(/\.md$/, "")}`;
    const url = path.replace(/ /g, "%20");
    const filePath = `${filename.replace(/\.md$/, "")}](${url})`;
    entries.push({
      key,
      filePath,
      lastModified: getMemFile(path).lastModified
    });
  });
  entries.sort((a, b) => b.lastModified - a.lastModified);
  const dict = {};
  entries.forEach((entry) => {
    dict[entry.key] = entry.filePath;
  });
  let lowPriorityEntries = [];
  ["_read_/", "_watch_/", "_shop_/", "today/", "later/", "journal/"].forEach((dir) => {
    if (!files[dir]) {
      return;
    }
    Object.keys(files[dir]).forEach((filename) => {
      if (filename === CONFIG_PATH || filename === CHAT_PATH) {
        return;
      }
      const key = `${filename.replace(/\.md$/, "")}`;
      const url = `${dir}/${filename}`.replace(/ /g, "%20");
      const filePath = `${filename.replace(/\.md$/, "")}](${url})`;
      lowPriorityEntries.push({
        key,
        filePath,
        lastModified: files[dir][filename].lastModified
      });
    });
  });
  lowPriorityEntries.sort((a, b) => b.lastModified - a.lastModified);
  lowPriorityEntries.forEach((entry) => {
    dict[entry.key] = entry.filePath;
  });
  return dict;
}
async function newFile(parentDir, forceTemplateChoice = false) {
  log("New file clicked");
  try {
    const template = await pickNewFileTemplate(forceTemplateChoice);
    if (!template) {
      return;
    }
    const dirPath = parentDir !== void 0 ? parentDir === "/" ? "/" : parentDir.replace(/\/$/, "") : "/";
    let filename = "New file.md";
    let num = 1;
    while (getMemFile(joinPath(dirPath, filename)) !== null) {
      log("file exists", joinPath(dirPath, filename));
      filename = `New file (${num}).md`;
      num++;
    }
    const path = joinPath(dirPath, filename);
    const titleHint = toHeader(filename);
    const body = getTemplateBody(template, titleHint);
    log("PATH", path, "template", template);
    await write(path, body);
    let handle = await getFileHandle(path, true);
    addMemFile(path, {
      isFile: true,
      content: body,
      lastModified: 0,
      handle,
      path,
      imageUrl: null
    });
    log("Creating new file", path);
    await openFile(path);
    log("CURRENT path after new", currentEditor.path);
    focusEditorAfterTemplate(template);
    editor.focus();
    await renderSidebar();
  } catch (err) {
    logError("newFile failed", err);
    alert("Create file failed: " + (err && err.message ? err.message : err));
  }
}
async function newFolder() {
  let folderName = prompt("Enter folder name:", "New Folder");
  if (folderName === null) {
    return;
  }
  folderName = folderName.trim();
  if (!folderName) {
    alert("Folder name cannot be empty");
    return;
  }
  let finalFolderName = folderName;
  let num = 1;
  while (files[finalFolderName + "/"]) {
    finalFolderName = `${folderName} (${num})`;
    num++;
  }
  const rootDirHandle = await getRootDirHandle();
  if (typeof isTauriWorkspaceBound === "function" && isTauriWorkspaceBound()) {
    await tauriCreateDir("/" + finalFolderName);
  } else {
    await rootDirHandle.getDirectoryHandle(finalFolderName, { create: true });
  }
  files[finalFolderName + "/"] = {};
  log("CREATED folder", finalFolderName);
  await renderSidebar(finalFolderName);
}
function isMetaKey(event) {
  return event.metaKey || event.ctrlKey || event.altKey;
}
function isSidebarToggleShortcut(event) {
  if (!isMetaKey(event)) {
    return false;
  }
  return event.code === "Backquote" || event.code === "IntlBackslash" || event.key === "`" || event.key === "~" || event.key === "?" || event.key === "?";
}
async function applyWorkspaceDirectory(dirHandle) {
  while (isLoadingLocalFiles) {
    await new Promise((r) => setTimeout(r, 50));
  }
  await saveDirectoryHandle(dirHandle);
  await write("/Help.md", getToolkitHelpIntro() + getHelpContent());
  files = await loadLocalFiles(dirHandle);
  isMemFS = false;
  document.getElementById("open-folder").style.display = "none";
  const openFolderBtn = document.getElementById("open-folder-btn");
  if (openFolderBtn) {
    openFolderBtn.style.display = "none";
  }
  if (typeof removeWorkspaceHintBanner === "function") {
    removeWorkspaceHintBanner();
  }
}
async function openDir() {
  let dirHandle = null;
  try {
    dirHandle = await window.showDirectoryPicker({ "mode": "readwrite" });
  } catch (error) {
    if (error instanceof TypeError) {
      alert("For now only Chrome browser supports local folders :(");
    }
    return;
  }
  await applyWorkspaceDirectory(dirHandle);
  renderSidebar();
  void loadWorkspaceConfig().then(() => detectVcsRepo());
  await initPlugins();
  await openChat();
  if (typeof refreshChatArchiveUi === "function") {
    refreshChatArchiveUi();
  }
}
function getCurrentContent() {
  let content2 = currentEditor.getValue();
  const header = toHeader(toFilename(currentEditor.path)).toLowerCase();
  if (content2.toLowerCase().startsWith(header)) {
    content2 = content2.slice(`${header}
`.length);
  } else if (content2.toLowerCase().startsWith("# ")) {
    content2 = content2.slice(`# 
`.length);
  }
  return content2;
}
function toHeader(filename) {
  let header = filename;
  if (filename.endsWith(".md")) {
    header = trimPostfix(filename, ".md");
  }
  return `# ${header}`;
}
function fromHeaderToFilename(header) {
  if (header.startsWith("# ")) {
    return header.slice(2).trim() + ".md";
  }
  return header.trim() + ".md";
}
function ucfirst(val) {
  return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}
async function getImageUrl(fileHandle) {
  const file = await fileHandle.getFile();
  return URL.createObjectURL(file);
}
function normNewLines(text) {
  return text.replace(/\r\n|\r/g, "\n");
}
function showToast(msg, ms = 1500) {
  const toast = document.createElement("div");
  toast.className = "app-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");
  if (msg instanceof Node) {
    toast.appendChild(msg);
  } else {
    toast.textContent = msg;
  }
  const editorContainer = document.getElementById("editor-container");
  const rect = editorContainer ? editorContainer.getBoundingClientRect() : null;
  const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
  toast.style.left = `${centerX}px`;
  toast.style.setProperty("--app-toast-duration", `${Math.max(ms, 300)}ms`);
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), ms);
}
function initDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("files", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("handles")) {
        db.createObjectStore("handles");
      }
    };
  });
}
async function saveDirectoryHandle(directoryHandle) {
  const db = await initDB();
  const transaction = db.transaction("handles", "readwrite");
  const store = transaction.objectStore("handles");
  return new Promise((resolve, reject) => {
    const request = store.put(directoryHandle, "savedDirectoryHandle");
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => resolve(void 0);
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error("Saving directory handle was aborted"));
  });
}
async function getSavedRootDirHandle() {
  const db = await initDB();
  const tx = db.transaction("handles", "readonly");
  const store = tx.objectStore("handles");
  return new Promise((resolve, reject) => {
    const req = store.get("savedDirectoryHandle");
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
    tx.onabort = () => reject(tx.error || new Error("Transaction aborted"));
  });
}
async function removeSavedRootDirHandle() {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("handles", "readwrite");
    const store = transaction.objectStore("handles");
    const request = store.delete("savedDirectoryHandle");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
async function getRootDirHandle() {
  const savedDirHandle = await getSavedRootDirHandle();
  if (!(savedDirHandle instanceof FileSystemDirectoryHandle) || !opfsIsFullyUsable()) {
    return await getTemporaryStorageDirHandle();
  }
  return savedDirHandle;
}
const resizeHandle = document.querySelector(".resize");
let isResizing = false;
resizeHandle.addEventListener("mousedown", initResize);
document.addEventListener("mousemove", doResize);
document.addEventListener("mouseup", stopResize);
function initResize(e) {
  isResizing = true;
  document.body.classList.add("dragging");
  e.preventDefault();
}
function doResize(e) {
  if (!isResizing) return;
  log(e);
  const width = e.clientX;
  const minWidth = 200;
  const maxWidth = 600;
  const constrainedWidth = Math.min(Math.max(width, minWidth), maxWidth);
  sidebar.style.setProperty("width", constrainedWidth + "px", "important");
  if (typeof fitEditorLayout === "function" && typeof editor !== "undefined") {
    fitEditorLayout(editor);
  }
}
function stopResize() {
  if (!isResizing) return;
  isResizing = false;
  document.body.classList.remove("dragging");
  if (typeof fitEditorLayout === "function") {
    if (typeof editor !== "undefined") {
      fitEditorLayout(editor);
    }
    if (typeof editor2 !== "undefined") {
      fitEditorLayout(editor2);
    }
  }
}
function toggleSidebar() {
  const sidebar2 = document.getElementById("sidebar");
  const openSidebar = document.getElementById("open-sidebar");
  const isHidden = sidebar2.style.display === "none" || getComputedStyle(sidebar2).display === "none";
  if (isHidden) {
    sidebar2.style.display = "flex";
    openSidebar.style.display = "none";
    document.body.classList.add("sidebar-open");
  } else {
    sidebar2.style.display = "none";
    openSidebar.style.display = "block";
    document.body.classList.remove("sidebar-open");
    if (isChat) {
      chatInput.focus();
    } else {
      currentEditor.focus();
    }
  }
  if (typeof isChat !== "undefined" && isChat && typeof fitChatLayout === "function") {
    fitChatLayout();
  } else if (typeof fitEditorLayout === "function") {
    if (typeof editor !== "undefined") {
      fitEditorLayout(editor);
    }
    if (typeof editor2 !== "undefined") {
      fitEditorLayout(editor2);
    }
  }
}
function trimPostfix(str, postfix) {
  if (str.endsWith(postfix)) {
    return str.slice(0, -postfix.length);
  }
  return str;
}
function trimPrefix(str, prefix) {
  if (str.startsWith(prefix)) {
    return str.slice(prefix.length);
  }
  return str;
}
function getCurrentVersion() {
  return window.COMMIT_HASH ? window.COMMIT_HASH.replace("?v=", "") : "";
}
const EDITOR2_MOTION_DURATION = 320;
const EDITOR2_MOTION_EASING = "cubic-bezier(0.22, 0.78, 0.24, 1)";
let editor2Motion = null;
let editor2MotionTarget = "hidden";
function prefersReducedMotion() {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
}
function finishEditor2Motion(editor2Container, shown) {
  editor2Motion?.cancel();
  editor2Motion = null;
  editor2Container.classList.remove("is-animating");
  if (shown) {
    editor2Container.classList.add("show");
    editor2Container.style.display = "flex";
    editor2Container.setAttribute("aria-hidden", "false");
    return;
  }
  editor2Container.classList.remove("show");
  editor2Container.style.display = "none";
  editor2Container.setAttribute("aria-hidden", "true");
  if (typeof fitEditorLayout === "function") {
    fitEditorLayout(editor);
  } else {
    editor.refresh();
  }
}
function setEditor2Visible(editor2Container, shown) {
  editor2MotionTarget = shown ? "shown" : "hidden";
  editor2Container.classList.toggle("show", shown);
  editor2Container.setAttribute("aria-hidden", shown ? "false" : "true");
  if (prefersReducedMotion() || typeof editor2Container.animate !== "function") {
    finishEditor2Motion(editor2Container, shown);
    return;
  }
  editor2Container.classList.add("is-animating");
  if (editor2Motion && editor2Motion.playState !== "finished") {
    const desiredRate = shown ? 1 : -1;
    if (Math.sign(editor2Motion.playbackRate) !== desiredRate) {
      editor2Motion.updatePlaybackRate(desiredRate);
    }
    editor2Motion.play();
    return;
  }
  editor2Motion?.cancel();
  editor2Motion = editor2Container.animate([
    { opacity: 0, transform: "translateX(24px) scale(0.992)" },
    { opacity: 1, transform: "translateX(0) scale(1)" }
  ], {
    duration: EDITOR2_MOTION_DURATION,
    easing: EDITOR2_MOTION_EASING,
    fill: "both"
  });
  if (!shown) {
    editor2Motion.pause();
    editor2Motion.currentTime = EDITOR2_MOTION_DURATION;
    editor2Motion.updatePlaybackRate(-1);
    editor2Motion.play();
  }
  editor2Motion.onfinish = () => {
    const arrivedShown = editor2MotionTarget === "shown";
    finishEditor2Motion(editor2Container, arrivedShown);
  };
}
function showEditor2() {
  const editor2Container = document.getElementById("editor2-container");
  const alreadyShown = editor2MotionTarget === "shown" && editor2Container.style.display !== "none";
  if (alreadyShown) {
    return;
  }
  rememberEditorPos();
  editor2Container.style.display = "flex";
  setEditor2Visible(editor2Container, true);
  if (typeof fitEditorLayout === "function") {
    fitEditorLayout(editor);
    fitEditorLayout(editor2);
  } else {
    editor.refresh();
  }
  editor2.focus();
  restoreEditorPos();
}
function hideEditor2() {
  if (typeof editor2 === "undefined") {
    return;
  }
  const editor2Container = document.getElementById("editor2-container");
  if (editor2Container.style.display !== "none" || editor2Container.classList.contains("show")) {
    setEditor2Visible(editor2Container, false);
  }
  restoreEditorPos();
  editor2.path = void 0;
  currentEditor = editor;
  selectSidebarItem(editor.path);
}
function isChrome() {
  var winNav = window.navigator;
  var vendorName = winNav.vendor;
  var isChromium = window.chrome;
  var isOpera = typeof window.opr !== "undefined";
  var isIEedge = winNav.userAgent.indexOf("Edg") > -1;
  var isIOSChrome = winNav.userAgent.match("CriOS");
  var isGoogleChrome = isChromium !== null && typeof isChromium !== "undefined" && vendorName === "Google Inc." && isOpera === false && isIEedge === false && (typeof winNav.userAgentData === "undefined" || winNav.userAgentData.brands.some((x) => x.brand === "Google Chrome"));
  if (isIOSChrome) {
    return true;
  } else if (isGoogleChrome) {
    return true;
  } else {
    return false;
  }
}
function goBack() {
  history.back();
}
function goForward() {
  history.forward();
}
function log(...args) {
  logf("", "#4CAF50", args);
}
function logError(...args) {
  logf("Error: ", "#F44336", args);
}
async function logf(prefix, color, args) {
  const stack = new Error().stack;
  const callerFull = stack.split("\n")[3].trim();
  const callerMatch = callerFull.match(/([^\/\\]+:\d+:\d+)/);
  let caller = callerMatch ? callerMatch[1] : callerFull;
  const callerFull2 = stack.split("\n")[4]?.trim();
  const caller2Match = callerFull2 ? callerFull2.match(/([^\/\\]+:\d+:\d+)/) : null;
  const caller2 = caller2Match ? caller2Match[1] : null;
  if (caller2) {
    caller += ` <- ${caller2}`;
  }
  const msg = args.map(
    (arg) => typeof arg === "object" ? JSON.stringify(arg) : String(arg)
  ).join(" ");
  const date = /* @__PURE__ */ new Date();
  const hours = date.getHours().toString().padStart(2, "0");
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const seconds = date.getSeconds().toString().padStart(2, "0");
  const time = `${hours}:${minutes}:${seconds}`;
  console.log(
    `%c[${time}]%c ${msg}%c ${caller}`,
    "color: #888; font-size: 0.9em",
    // Time in gray
    `color: ${color}; font-weight: bold`,
    // Message in specified color
    "color: #888; font-size: 0.9em"
    // Stack trace in gray
  );
  const day = date.getDate().toString().padStart(2, "0");
  const month = (date.getMonth() + 1).toString().padStart(2, "0");
  const year = date.getFullYear();
  const now = `${day}.${month}.${year} ${time}`;
  const logMsg = `${now} ${prefix}[${callerFull}] ${msg}
`;
  try {
    await writeAtEnd(LOG_PATH, logMsg);
  } catch (error) {
  }
}
let operationCounter = 0;
function opId() {
  return `${++operationCounter}`;
}
window.addEventListener("keydown", async (event) => {
  if (isMetaKey(event) && event.key == "w") {
    hideEditor2();
  }
  if (isMetaKey(event) && event.key === "p") {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById("search-input").value = "";
    searchModal.open();
  }
  if (isMetaKey(event) && event.key === "k") {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById("search-input").value = "";
    searchModal.open();
  }
  if (isMetaKey(event) && event.key === "m") {
    event.preventDefault();
    event.stopPropagation();
    document.getElementById("move-input").value = "";
    moveModal.open();
  }
  if (isMetaKey(event) && event.key === "d") {
    log("cmd+d");
    event.preventDefault();
    event.stopPropagation();
    removeCurrentFile();
  }
  if (isMetaKey(event) && event.shiftKey && (event.key === "r" || event.key === "R")) {
    event.preventDefault();
    event.stopPropagation();
    toggleReadMode();
  }
  if (handlePluginKeyboard(event)) {
    return;
  }
  if (isMetaKey(event) && event.key === "n") {
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    if (event.shiftKey) {
      await newFolder();
    } else if (event.altKey) {
      event.preventDefault();
      event.stopPropagation();
      await newFile(void 0, true);
    } else {
      await newFile();
    }
  }
}, true);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (handlePluginEscape()) {
      editor.focus();
      event.preventDefault();
      return;
    }
    if (chatContainer.style.display !== "none") {
      const selectedMessages = chat.querySelectorAll(".message.selected");
      if (selectedMessages.length > 0) {
        selectedMessages.forEach((message) => message.classList.remove("selected"));
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      closeChatModal();
      editor.focus();
      return;
    }
    hideEditor2();
    editor.focus();
    const allMessages = chat.querySelectorAll(".message");
    allMessages.forEach((message) => message.classList.remove("selected"));
    if (isChat) {
      chatInput.focus();
    }
  }
});
document.addEventListener("keydown", function(event) {
  if (event.shiftKey && isMetaKey(event) && event.key === "Enter") {
    event.preventDefault();
    if (isChat) {
      history.back();
    } else {
      event.preventDefault();
      toggleChatModal();
    }
    return;
  }
  if (isSidebarToggleShortcut(event)) {
    event.preventDefault();
    toggleSidebar();
  }
  if (isMetaKey(event) && event.key === "Enter") {
    openChat();
  }
});
document.addEventListener("keydown", (e) => {
  if (e.metaKey || e.ctrlKey) {
    document.body.classList.add("cmd-pressed");
  }
});
document.addEventListener("keyup", (e) => {
  if (!e.metaKey && !e.ctrlKey) {
    document.body.classList.remove("cmd-pressed");
  }
});
window.addEventListener("popstate", (event) => {
  const state = event.state;
  if (state) {
    openFile(state.path, false, state.el);
  }
});
window.addEventListener("focus", async () => {
  if (openChatIdleTimer) {
    clearTimeout(openChatIdleTimer);
    openChatIdleTimer = null;
  }
  if (isChat || isMemFS) {
    if (isChat) {
      document.getElementById("chat-input").focus();
    }
    return false;
  }
  log("FOCUS");
  if (currentEditor.path === void 0) {
    return;
  }
  document.getElementById("chat-input").focus();
  const savedDirectoryHandle = await getRootDirHandle();
  await syncCurrentFile();
  const start = performance.now();
  files = await loadLocalFiles(savedDirectoryHandle, true);
  const end = performance.now();
  log(`Files loaded in: ${(end - start).toFixed(3)} milliseconds`);
  await renderSidebar();
  log("Reload completed");
});
window.addEventListener("blur", async function() {
  log("BLUR");
  editor.refresh();
  openChatIdleTimer = setTimeout(() => {
    openChat();
  }, OPEN_CHAT_AFTER_IDLE);
  if (Object.keys(files).length === 0) {
    return;
  }
  await syncCurrentFile();
  const savedDirectoryHandle = await getRootDirHandle();
  const start = performance.now();
  files = await loadLocalFiles(savedDirectoryHandle);
  const end = performance.now();
  log(`Files loaded in: ${(end - start).toFixed(3)} milliseconds`);
  await renderSidebar();
  log("Save completed");
});
document.addEventListener("keydown", (e) => {
  if (document.getElementById("search").style.display !== "none" || document.getElementById("move").style.display !== "none") {
    return;
  }
  if (isChat) {
    return;
  }
}, true);
window.addEventListener("beforeunload", function() {
  clearInterval(window.saver);
});
window.saver = setInterval(() => {
  if (document.hasFocus()) {
    syncCurrentFile();
  }
}, CURRENT_FILE_SYNC_INTERVAL);
