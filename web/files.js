// Generated from src/ — edit TypeScript and run: npm run build

const CURRENT_FILE_SYNC_INTERVAL = 1e3;
const MAX_MEDIA_SIZE = 30 * 1024 * 1024;
let isSaving = false;
let isMessingWithCurrentEditor = false;
let isLoadingLocalFiles = false;
let files = {};
let mediaIndex = {};
const MAX_DIR_NESTING_LEVEL = 10;
const SUPPORTED_EXTENSIONS = ["md", "png", "jpg", "jpeg", "webp", "gif", "mp4", "webm", "mov", "mp3", "ogg", "oga", "wav"];
function isMediaPath(path) {
  return /\.(png|jpg|jpeg|gif|webp|mp4|webm|mov|mp3|ogg|oga|wav)$/i.test(path);
}
const SYSTEM_DIRS = ["media", "archive", "journal", "habits", "triggers", "insights"];
const CONFIG_PATH = "/config.json";
async function loadLocalFiles(rootDirHandle, slowMode = false) {
  if (typeof isTauriWorkspaceBound === "function" && isTauriWorkspaceBound()) {
    return loadLocalFilesViaTauri(slowMode);
  }
  if (isLoadingLocalFiles) {
    return files;
  }
  isLoadingLocalFiles = true;
  while (!editor.isClean()) {
    await new Promise((r) => setTimeout(r, 50));
  }
  let newFiles = {};
  mediaIndex = {};
  async function loadDir(dirHandle, path = "/", depth = 0) {
    const entries = [];
    for await (const entry of dirHandle.values()) {
      entries.push(entry);
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    const dirPromises = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const filename = entry.name.normalize("NFC");
      let isSupportedExtension = SUPPORTED_EXTENSIONS.includes(filename.split(".").pop().toLowerCase());
      let isConfig = filename === toFilename(CONFIG_PATH);
      let dirs = path.split("/");
      dirs = dirs.filter((d) => d !== "");
      let currentDir = newFiles;
      for (let dir of dirs) {
        dir += "/";
        if (!currentDir[dir]) {
          currentDir[dir] = {};
        }
        currentDir = currentDir[dir];
      }
      if (entry.kind === "directory") {
        if (filename.startsWith(".") || depth >= MAX_DIR_NESTING_LEVEL) continue;
        currentDir[filename + "/"] = {};
        const dir = `${path}${filename}/`;
        dirPromises.push({ handle: entry, path: dir, depth: depth + 1 });
      } else if (entry.kind === "file" && (isSupportedExtension || isConfig)) {
        let existingDir = files;
        for (let dir of dirs) {
          dir += "/";
          if (existingDir === void 0 || existingDir[dir] === void 0) {
            existingDir = void 0;
            break;
          }
          existingDir = existingDir[dir];
        }
        const fileWasPreviouslyLoaded = existingDir && existingDir[filename] !== void 0;
        if (fileWasPreviouslyLoaded) {
          currentDir[filename] = existingDir[filename];
        } else {
          currentDir[filename] = { path: `${path}${filename}`, isFile: true, handle: entry };
          entry.getFile().then((file) => {
            currentDir[filename].lastModified = file.lastModified;
          });
        }
        if (!isMediaPath(filename)) {
          continue;
        }
        if (!currentDir[filename].imageUrl) {
          getImageUrl(entry).then((imageUrl) => {
            currentDir[filename].imageUrl = imageUrl;
          });
        }
        if (!mediaIndex[filename]) {
          mediaIndex[filename] = currentDir[filename];
        }
      }
      if (slowMode && i % 50 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    if (debug) {
      if (!debug.loaded) {
        debug.loaded = true;
        await loadDir(rootDirHandle, debug.dir, 1);
      }
      return;
    }
    if (!slowMode) {
      await Promise.all(dirPromises.map(
        ({ handle, path: path2, depth: depth2 }) => loadDir(handle, path2, depth2)
      ));
      return;
    }
    const batchSize = 6;
    for (let i = 0; i < dirPromises.length; i += batchSize) {
      const batch = dirPromises.slice(i, i + batchSize);
      await Promise.all(batch.map(
        ({ handle, path: path2, depth: depth2 }) => loadDir(handle, path2, depth2)
      ));
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  try {
    await loadDir(rootDirHandle);
  } catch (error) {
    log("Load Local files: ", error);
    isLoadingLocalFiles = false;
    throw error;
  }
  isLoadingLocalFiles = false;
  return newFiles;
}
async function loadLocalFilesViaTauri(slowMode = false) {
  if (isLoadingLocalFiles) {
    return files;
  }
  isLoadingLocalFiles = true;
  while (!editor.isClean()) {
    await new Promise((r) => setTimeout(r, 50));
  }
  let newFiles = {};
  mediaIndex = {};
  try {
    const listings = await tauriListWorkspaceFiles();
    for (let i = 0; i < listings.length; i++) {
      const item = listings[i];
      const appPath = relativeToAppPath(item.relative_path);
      const parts = appPath.split("/").filter((p) => p !== "");
      const filename = parts.pop().normalize("NFC");
      let currentDir = newFiles;
      for (const seg of parts) {
        const dirKey = seg + "/";
        if (!currentDir[dirKey]) {
          currentDir[dirKey] = {};
        }
        currentDir = currentDir[dirKey];
      }
      const handle = new TauriFileHandle(item.relative_path);
      currentDir[filename] = {
        path: appPath,
        isFile: true,
        handle,
        lastModified: item.last_modified_ms
      };
      if (isMediaPath(filename)) {
        getImageUrl(handle).then((imageUrl) => {
          currentDir[filename].imageUrl = imageUrl;
        });
        if (!mediaIndex[filename]) {
          mediaIndex[filename] = currentDir[filename];
        }
      }
      if (slowMode && i % 50 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }
  } catch (error) {
    log("Load Tauri workspace files: ", error);
    isLoadingLocalFiles = false;
    throw error;
  }
  isLoadingLocalFiles = false;
  return newFiles;
}
async function saveMediaFile(path, blob) {
  const fileHandle = await getFileHandle(path, true);
  if (fileHandle === null) {
    log(`Malformed name for ${path}, skipping file...`);
    return;
  }
  try {
    const file = await fileHandle.getFile();
    if (file.size > 0) {
      log(`File ${path} already exists, skipping...`);
      return;
    }
  } catch (error) {
    log(`File ${path} doesn't exist or can't be read, will create it`);
  }
  try {
    const parts = path.split("/");
    const filename = parts.pop();
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    log(`Successfully wrote media file: ${path}`);
    if (!files["media/"]) {
      files["media/"] = {};
    }
    files["media/"][filename] = { isFile: true, handle: fileHandle };
    fileHandle.getFile().then((file) => {
      files["media/"][filename].lastModified = file.lastModified;
    });
    getImageUrl(fileHandle).then((imageUrl) => {
      files["media/"][filename].imageUrl = imageUrl;
    });
  } catch (error) {
    logError(`Error writing media file ${path}:`, error);
    throw error;
  }
}
async function isContentEqual(path, content) {
  let fileHandle = await getFileHandle(path);
  if (fileHandle === null) {
    console.warn("Malformed name, skipping file...");
    return false;
  }
  let file = await fileHandle.getFile();
  let clientHash = hash(normNewLines(await file.text()));
  let serverHash = hash(normNewLines(content));
  if (clientHash !== serverHash) {
    const clientContent = normNewLines(await file.text());
    const serverContent = normNewLines(content);
    const clientLines = clientContent.split("\n");
    const serverLines = serverContent.split("\n");
    const diff = [];
    for (let i = 0; i < Math.max(clientLines.length, serverLines.length); i++) {
      const clientLine = clientLines[i] || "";
      const serverLine = serverLines[i] || "";
      if (clientLine !== serverLine) {
        diff.push(`Line ${i + 1}: '${clientLine}' vs '${serverLine}'`);
      }
    }
    return false;
  } else {
    return true;
  }
}
function getImageExtension(mimeType) {
  const extensions = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/gif": "gif",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/webm": "webm"
  };
  return extensions[mimeType] || "png";
}
async function moveCurrentFile(toDir) {
  const oldPath = currentEditor.path;
  const newPath = joinPath("/", toDir, toFilename(currentEditor.path));
  if (oldPath === newPath) return;
  isMessingWithCurrentEditor = true;
  try {
    let content = getCurrentContent();
    await writeIfContentIsDifferent(newPath, content);
    removeMemFile(oldPath);
    log("MOVING to DIR:", toDir);
    addMemFile(newPath, {
      isFile: true,
      content,
      lastModified: 0,
      path: newPath,
      handle: await getFileHandle(newPath)
    });
    currentEditor.path = newPath;
    await remove(oldPath);
    await renderSidebar();
  } catch (error) {
    logError("Error moving file:", error);
  }
  isMessingWithCurrentEditor = false;
}
function addMemFile(path, memFile) {
  let dirs = path.split("/");
  dirs = dirs.filter((d) => d !== "");
  const filename = dirs.pop();
  let currentDir = files;
  for (let dir of dirs) {
    dir += "/";
    if (!currentDir[dir]) {
      currentDir[dir] = {};
    }
    currentDir = currentDir[dir];
  }
  currentDir[filename] = memFile;
}
async function moveFile(oldPath, newPath) {
  if (oldPath === newPath) {
    return;
  }
  try {
    let file = await (await getFileHandle(oldPath)).getFile();
    let content = await file.text();
    await writeIfContentIsDifferent(newPath, content);
    log("saving " + newPath);
    addMemFile(newPath, {
      isFile: true,
      content,
      lastModified: 0,
      path: newPath,
      handle: await getFileHandle(newPath)
    });
    await remove(oldPath);
    await renderSidebar();
    log(`Moved ${oldPath} to ${newPath}`);
  } catch (error) {
    logError("Error moving file:", error);
    throw error;
  }
}
async function openFile(path, saveToHistory = true, el = "editor-textarea") {
  while (isMessingWithCurrentEditor) {
    log("Waiting isMessingWithCurrentEditor...");
    await new Promise((r) => setTimeout(r, 50));
  }
  const id = opId();
  log(`Opening file: ${path} in element: ${el}, opId: ${id}`, id);
  path = path.normalize("NFC");
  const memFile = getMemFile(path);
  if (memFile === null) {
    return;
  }
  if (el === "editor-textarea") {
    currentEditor = editor;
  } else if (el === "editor2-textarea") {
    currentEditor = editor2;
  }
  let thereIsPreviousEditorToSync = !currentEditor.isClean() && currentEditor.path !== void 0;
  if (thereIsPreviousEditorToSync) {
    const syncStart = performance.now();
    log("Began syncing previous file");
    await syncCurrentFile(true);
    log(`Finished syncing previous file in ${(performance.now() - syncStart).toFixed(3)} ms`);
  }
  isMessingWithCurrentEditor = true;
  try {
    if (path === CHAT_PATH) {
      openChat();
      return;
    } else {
      if (typeof closePluginViews === "function") {
        closePluginViews();
      }
      hideChatView();
      chat.style.display = "none";
      chatInput.style.display = "none";
      isChat = false;
    }
    chatContainer.style.display = "none";
    closeChatModal();
    const start = performance.now();
    const isSameFile = currentEditor.path === path;
    let filename = toFilename(path);
    const header = toHeader(filename);
    let content = "";
    if (memFile.handle !== void 0) {
      const file = await memFile.handle.getFile();
      content = await file.text();
      content = `${header}
${content}`;
    } else {
      content = memFile.content;
    }
    currentEditor.path = path;
    if (saveToHistory) {
      const state = {
        path,
        el
      };
      history.pushState(state, "");
    }
    if (isSameFile) {
      if (el === "editor2-textarea") {
        showEditor2();
      }
      currentEditor.path = path;
      const oldContent = currentEditor.getValue();
      if (oldContent !== content) {
        let prefixEnd = 0;
        const minLen = Math.min(oldContent.length, content.length);
        while (prefixEnd < minLen && oldContent[prefixEnd] === content[prefixEnd]) {
          prefixEnd++;
        }
        let oldEnd = oldContent.length;
        let newEnd = content.length;
        while (oldEnd > prefixEnd && newEnd > prefixEnd && oldContent[oldEnd - 1] === content[newEnd - 1]) {
          oldEnd--;
          newEnd--;
        }
        currentEditor.replaceRange(
          content.substring(prefixEnd, newEnd),
          currentEditor.posFromIndex(prefixEnd),
          currentEditor.posFromIndex(oldEnd)
        );
      }
      currentEditor.markClean();
    } else {
      if (el === "editor-textarea") {
        editor = initEditor(document.getElementById(el));
        currentEditor = editor;
        hideEditor2();
      } else if (el === "editor2-textarea") {
        editor2 = initEditor(document.getElementById(el));
        currentEditor = editor2;
        showEditor2();
      }
      currentEditor.path = path;
      currentEditor.getDoc().setValue(content);
      currentEditor.clearHistory();
      currentEditor.markClean();
      focusLastLine();
    }
    const end = performance.now();
    log(`File ${path} opened in: ${(end - start).toFixed(3)} milliseconds, opId: ${id}`);
    setTimeout(() => {
      currentEditor.setOption("viewportMargin", Infinity);
      currentEditor.scrollTo(null, 0);
    }, 200);
    selectSidebarItem(path);
    onDocumentOpened(content, path);
    if (typeof syncDirtyFromEditor === "function") {
      syncDirtyFromEditor();
    }
    if (typeof fitEditorLayout === "function") {
      requestAnimationFrame(() => {
        fitEditorLayout(currentEditor, { resetScroll: true });
      });
    }
  } catch (err) {
    logError("openFile:", err);
    throw err;
  } finally {
    isMessingWithCurrentEditor = false;
  }
}
async function syncCurrentFile(switchAwayEditor = false) {
  if (files === void 0 || debug || currentEditor.path === void 0) {
    return;
  }
  const savedDirHandle = await getRootDirHandle();
  const hasSavedDir = isBrowserDirectoryHandle(savedDirHandle) || typeof isTauriWorkspaceBound === "function" && isTauriWorkspaceBound();
  if (!hasSavedDir && !isMemFS) {
    return;
  }
  if (isSaving) {
    return;
  }
  if (isMessingWithCurrentEditor) {
    return;
  }
  isMessingWithCurrentEditor = true;
  const path = currentEditor.path;
  let isCurrentEditorSame = () => {
    return path === window.currentEditor.path;
  };
  if (path === CHAT_PATH) {
    if (chatIsClean) {
      try {
        let inMemoryLastModified = getMemFile(path)?.lastModified;
        let file = await (await getFileHandle(CHAT_PATH)).getFile();
        let memFile = getMemFile(path);
        if (memFile !== null) {
          memFile.lastModified = file.lastModified;
          addMemFile(path, memFile);
        }
        let localLastModified = file.lastModified;
        if (inMemoryLastModified !== localLastModified) {
          isMessingWithCurrentEditor = false;
          if (!switchAwayEditor) {
            await openFile(CHAT_PATH);
          }
          return;
        }
      } catch (e) {
        logError("Error opening file:", e);
        isMessingWithCurrentEditor = false;
        return;
      }
    }
    isMessingWithCurrentEditor = false;
    return;
  }
  const filename = toFilename(path);
  try {
    const firstLine = currentEditor.getValue().split("\n")[0];
    const rawFromHeader = ucfirst(fromHeaderToFilename(firstLine));
    const badHeaderChar = findForbiddenChar(rawFromHeader);
    if (badHeaderChar !== null) {
      showToast(`Filename cannot contain "${badHeaderChar}"`);
    }
    let newFilename = sanitizeFilename(rawFromHeader);
    let hasEmptyName = newFilename.trim() === ".md";
    if (hasEmptyName) {
      let hasOldName = !filename.startsWith("Untitled");
      if (hasOldName) {
        newFilename = "Untitled.md";
        let counter = 1;
      } else {
        newFilename = filename;
      }
    }
    const hasFilenameChanged = newFilename.toLowerCase() !== filename.toLowerCase();
    if (hasFilenameChanged) {
      log("Filename has changed from ", filename, "to", newFilename);
      const newPath = joinPath(toDirPath(path), newFilename);
      const content2 = getCurrentContent();
      if (await exists(newPath)) {
        showToast(`A file named "${newFilename}" already exists`);
        isMessingWithCurrentEditor = false;
        return;
      }
      let newHandle;
      try {
        await write(newPath, content2);
        newHandle = await getFileHandle(newPath);
      } catch (error) {
        logError("Cannot rename, filesystem rejected new name:", newPath, error);
        alert(`Cannot rename file to "${newFilename}": ${error.message || error.name}`);
        isMessingWithCurrentEditor = false;
        return;
      }
      currentEditor.path = newPath;
      addMemFile(newPath, {
        isFile: true,
        content: content2,
        lastModified: 0,
        path: newPath,
        handle: newHandle
      });
      log("Created", newPath);
      await remove(path);
      log("Removed due to filename change", path);
      await renderSidebar();
      isMessingWithCurrentEditor = false;
      return;
    }
  } catch (error) {
    logError("Error during filename change:", error);
    isMessingWithCurrentEditor = false;
    return;
  }
  const content = getCurrentContent();
  let contentWasModifiedLocally = false;
  try {
    contentWasModifiedLocally = !await isContentEqual(path, content);
  } catch (error) {
    logError("Error checking content equality:", error);
    isMessingWithCurrentEditor = false;
    return;
  }
  if (!isCurrentEditorSame()) {
    isMessingWithCurrentEditor = false;
    return;
  }
  if (contentWasModifiedLocally && currentEditor.isClean()) {
    log("Was modified locally, and the editor is clean", path);
    try {
      if (!switchAwayEditor) {
        isMessingWithCurrentEditor = false;
        const el = currentEditor === editor2 ? "editor2-textarea" : "editor-textarea";
        await openFile(path, false, el);
      }
    } catch (error) {
      logError("Error opening file:", error);
      isMessingWithCurrentEditor = false;
      return;
    }
  } else if (!currentEditor.isClean()) {
    log("Editor is not clean", path);
    isSaving = true;
    try {
      const file = getMemFile(path);
      if (file && file.handle) {
        const freshContent = getCurrentContent();
        if (!currentEditor.isClean() && contentWasModifiedLocally) {
        }
        currentEditor.markClean();
        if (typeof markPathClean === "function") {
          markPathClean(path);
        }
        const writable = await file.handle.createWritable();
        await writable.write(freshContent);
        await writable.close();
      } else {
        if (file.handle) {
          logError(`Cannot save ${path}. No file handle found.`);
        }
      }
    } catch (error) {
      logError("Error during save:", error);
      isSaving = false;
      if (isCurrentEditorSame()) {
        editor.replaceRange(" ", editor.getCursor());
        editor.undo();
      }
      isMessingWithCurrentEditor = false;
      return;
    }
    isSaving = false;
  }
  isMessingWithCurrentEditor = false;
}
function hash(str) {
  let hash2 = 0;
  for (let i = 0, len = str.length; i < len; i++) {
    let chr = str.charCodeAt(i);
    hash2 = (hash2 << 5) - hash2 + chr;
    hash2 |= 0;
  }
  return hash2;
}
function walk(obj, callback, path = "/") {
  const stack = [{ obj, path }];
  const maxAllowedIterations = 1e5;
  let iterations = 0;
  while (stack.length > 0) {
    const { obj: currentObj, path: currentPath } = stack.pop();
    iterations++;
    if (iterations > maxAllowedIterations) {
      log(currentPath);
      alert("An infinite loop during files walk");
      return;
    }
    if (currentObj.isFile) {
      if (callback(currentPath, true) === false) {
        return;
      }
      continue;
    }
    const isDir = path.endsWith("/");
    if (!isDir) {
      return;
    }
    const keys = Object.keys(currentObj);
    const files2 = [];
    const dirs = [];
    for (const key of keys) {
      if (currentObj[key].isFile) {
        files2.push(key);
      } else {
        dirs.push(key);
      }
    }
    for (const key of files2) {
      const fullPath = currentPath + key;
      if (callback(fullPath, true) === false) {
        return;
      }
    }
    for (const key of dirs) {
      const fullPath = currentPath + key;
      if (callback(fullPath, false) === false) {
        return;
      }
    }
    for (let i = dirs.length - 1; i >= 0; i--) {
      const key = dirs[i];
      const item = currentObj[key];
      const fullPath = currentPath + key;
      stack.push({ obj: item, path: fullPath });
    }
  }
}
function walkFilesExcludingSystemDirs(callback) {
  walk(files, (path, isFile) => {
    if (!isFile) {
      return;
    }
    const rootDir = toRootDirName(path);
    if (SYSTEM_DIRS.includes(rootDir) && toRootDirName !== "/") {
      return;
    }
    callback(path);
  });
}
function toFilename(path) {
  if (path === "/") {
    return "/";
  }
  const { filename } = toDirPathAndFilename(path);
  return filename;
}
function toDirPath(path) {
  const { dirPath } = toDirPathAndFilename(path);
  return dirPath;
}
function toRootDirName(path) {
  const root = toRootPath(path);
  if (root === "/") {
    return root;
  }
  return trimPrefix(root, "/");
}
function removeTrailingSlash(path) {
  if (path === "/") {
    return "/";
  }
  if (path.endsWith("/")) {
    return path.slice(0, -1);
  }
  return path;
}
function joinPath(...parts) {
  const joined = parts.join("/");
  return joined.replace(/\/+/g, "/");
}
function toDirPathAndFilename(path) {
  let parts = path.split("/");
  parts = parts.filter((p) => p !== "");
  const filename = parts.pop();
  let dirPath = "/" + parts.join("/");
  return { dirPath, filename };
}
function excludeDirs(excludedDirs) {
  const filteredDirs = ["/"];
  for (const dir in files) {
    if (files[dir].isFile === true) {
      continue;
    }
    const dirName = toRootDirName(dir);
    if (!excludedDirs.includes(dirName)) {
      filteredDirs.push(dir);
    }
  }
  return filteredDirs;
}
function toRootPath(path) {
  const parts = path.split("/").filter((p) => p !== "");
  if (parts.length <= 1) {
    return "/";
  }
  return "/" + parts[0];
}
function getMemFile(path) {
  if (files === void 0) {
    return null;
  }
  if (path === "/") {
    return files;
  }
  let dirs = path.split("/");
  dirs = dirs.filter((d) => d !== "");
  const filename = dirs.pop();
  let currentDir = files;
  for (let dir of dirs) {
    dir += "/";
    if (!currentDir[dir]) {
      return null;
    }
    currentDir = currentDir[dir];
  }
  return currentDir[filename] || null;
}
function removeMemFile(path) {
  if (files === void 0) {
    return;
  }
  if (path === "/") {
    console.warn("Trying to remove /");
    return;
  }
  let dirs = path.split("/");
  dirs = dirs.filter((d) => d !== "");
  const filename = dirs.pop();
  let currentDir = files;
  for (let dir of dirs) {
    dir += "/";
    if (!currentDir[dir]) {
      return;
    }
    currentDir = currentDir[dir];
  }
  if (currentDir[filename] !== void 0) {
    delete currentDir[filename];
  }
}
function findSiblingPath(path) {
  const allFiles = [];
  let foundDesiredPath = false;
  let nextPath = null;
  walk(files, (filePath, isFile) => {
    if (filePath === CONFIG_PATH || filePath === CHAT_PATH) {
      return;
    }
    if (filePath.startsWith("/media")) {
      return;
    }
    if (!isFile) {
      return;
    }
    if (foundDesiredPath && nextPath === null) {
      log("NEXT path", filePath);
      nextPath = filePath;
      return;
    }
    if (filePath === path) {
      log("FOUND desired", filePath);
      foundDesiredPath = true;
    }
  });
  return nextPath;
}
async function removeCurrentFile() {
  const path = currentEditor.path;
  if (path === CHAT_PATH) {
    return;
  }
  const nextFilePath = findSiblingPath(path);
  let oldPath = path;
  let newPath = "/archive/" + toFilename(path);
  currentEditor.path = void 0;
  if (toDirPath(path) === "/archive") {
    log("Removing file permanently", path);
    await remove(oldPath);
  } else {
    log("Moving file to archive", path);
    await moveFile(oldPath, newPath);
  }
  await renderSidebar();
  if (nextFilePath) {
    await openFile(nextFilePath);
  } else {
    openRandomFile();
  }
}
async function openRandomFile() {
  if (debug) {
    await openFile(debug.dir, debug.file);
    return;
  }
  const allFiles = [];
  walkFilesExcludingSystemDirs((path) => {
    if (path === CONFIG_PATH) {
      return;
    }
    allFiles.push(path);
  });
  if (allFiles.length === 0) {
    logError("No files found to open.");
    return;
  }
  const randomPath = allFiles[Math.floor(Math.random() * allFiles.length)];
  try {
    await openFile(randomPath);
  } catch (error) {
    logError("Failed to open random file:", error);
  }
}
