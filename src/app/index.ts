// @ts-nocheck
/// <reference path="../types/global.d.ts" />

const sidebar = document.getElementById('sidebar');
const content = document.getElementById('content')

const CHAT_PATH = '/Chat.md';
const LATER_PATH = '/Later.md';
const READ_PATH = '/Read.md';
const SHOP_PATH = '/Shop.md';
const WATCH_PATH = '/Watch.md';
const LOG_PATH = '/archive/Log.txt';
const OPEN_CHAT_AFTER_IDLE = 60 * 60 * 1000; // ms

let openChatIdleTimer = null;
let isChat = false;
let isMemFS = false;
let debug = false;
// let debug = {dir: '', file: 'File.md', loaded: false};

async function init() {
    migrateLegacyStorage();

    if (location.hostname === 'localhost' && navigator.serviceWorker?.getRegistrations) {
        void navigator.serviceWorker.getRegistrations().then((regs) => {
            for (const reg of regs) {
                void reg.unregister();
            }
        });
    }

    // Tauri / desktop shell: SW caches stale editor.js and breaks layout fixes.
    if (typeof isTauriHost === 'function' && isTauriHost() && navigator.serviceWorker?.getRegistrations) {
        void navigator.serviceWorker.getRegistrations().then(async (regs) => {
            for (const reg of regs) {
                await reg.unregister();
            }
            if (typeof caches !== 'undefined') {
                const keys = await caches.keys();
                await Promise.all(keys.map((key) => caches.delete(key)));
            }
        });
    }

    const shellWorkspaceBound = await initDesktopShell();
    await initDesktopSettings(shellWorkspaceBound);

    if (navigator.storage && navigator.storage.persist) {
        const persisted = await navigator.storage.persist();
        log('Storage persisted:', persisted);
    }

    const savedDirHandle = await getSavedRootDirHandle();
    const hasSavedLocalDir = !shellWorkspaceBound && isBrowserDirectoryHandle(savedDirHandle);
    if (shellWorkspaceBound || hasSavedLocalDir) {
        isMemFS = false;
        hideWorkspaceOpenControls();
    } else if ((typeof isTauriHost === 'function' && isTauriHost())
        || typeof window.showDirectoryPicker === 'function') {
        document.getElementById('open-folder').style.display = 'flex';
        isMemFS = true;
    } else {
        // Safari/Firefox have no File System Access API for now, hide CTA.
        document.getElementById('open-folder').style.display = 'none';
        isMemFS = true;
    }

    // Let's create local-first like experience by preloading images.
    if (isMemFS) {
        prefetchWelcomeImages();
    }

    // Alert if there's no "Allow on every visit" check.
    if (isChrome() && hasSavedLocalDir) {
        const permission = await (await getRootDirHandle()).queryPermission({ mode: 'readwrite' });
        log('PERMISSION', permission);
        if (permission !== 'granted') {
            document.getElementById('open-folder').style.display = 'flex';
            // TODO maybe ask user to check "Allow on every visit" on left part of the sidebar
            await removeSavedRootDirHandle();
            alert('Can\'t access folder.\n\nPlease, reopen the folder again and check "Allow on every visit" checkbox');
        }
    }

    if (!shellWorkspaceBound) {
        let rootDirHandle = await getRootDirHandle();

        let perf = performance.now();
        files = await loadLocalFiles(rootDirHandle);
        log(`Files loaded in ${performance.now() - perf}ms`);
    } else {
        let perf = performance.now();
        await ensureWorkspaceHelpFile();
        files = await loadLocalFiles(null);
        log(`Tauri workspace loaded in ${performance.now() - perf}ms`);
    }

    initChat();

    initVcsDirty();

    let perf = performance.now();
    renderSidebar();
    log(`Sidebar built in: ${(performance.now() - perf).toFixed(3)} milliseconds`);

    await loadWorkspaceConfig(true);
    await initPlugins();

    if (isMemFS) {
        await openFile('/?? Welcome.md');
    } else {
        await openChat();
    }

    if (typeof refreshChatArchiveUi === 'function') {
        refreshChatArchiveUi();
    }

    scheduleEditorLayoutRefresh();

    log(`Files initialized in: ${(performance.now() - perf).toFixed(3)} milliseconds`);

}

/** CodeMirror measures its wrapper at init; flex layout may not be final yet. */
function scheduleEditorLayoutRefresh(): void {
    bindEditorContainerResize();
    const refresh = () => {
        if (typeof isChat !== 'undefined' && isChat && typeof fitChatLayout === 'function') {
            fitChatLayout();
            return;
        }
        if (typeof fitEditorLayout === 'function') {
            if (typeof editor !== 'undefined') {
                fitEditorLayout(editor);
            }
            if (typeof editor2 !== 'undefined') {
                fitEditorLayout(editor2);
            }
            return;
        }
        if (typeof editor !== 'undefined') {
            editor.refresh();
        }
        if (typeof editor2 !== 'undefined') {
            editor2.refresh();
        }
    };
    requestAnimationFrame(() => {
        refresh();
        requestAnimationFrame(refresh);
    });
}

// Logic for click-handling is in click.js => isWikiLink
function createAutocompleteDict() {
    const entries = [];
    const currentPath = currentEditor && currentEditor.path;

    // Collect all files with their metadata
    walkFilesExcludingSystemDirs((path) => {
        if (path === CONFIG_PATH || path === CHAT_PATH || path === LATER_PATH || path === READ_PATH || path === WATCH_PATH || path === SHOP_PATH) {
            return;
        }
        if (path === currentPath) {
            return;
        }

        const filename = toFilename(path);
        const key = `${filename.replace(/\.md$/, '')}`;
        const url = path.replace(/ /g, '%20');
        const filePath = `${filename.replace(/\.md$/, '')}](${url})`;

        entries.push({
            key,
            filePath,
            lastModified: getMemFile(path).lastModified
        });

    });

    // Sort by last modified (most recent first)
    entries.sort((a, b) => b.lastModified - a.lastModified);
    const dict = {};
    entries.forEach(entry => {
        dict[entry.key] = entry.filePath;
    });

    let lowPriorityEntries = [];
    ['_read_/', '_watch_/', '_shop_/', 'today/', 'later/', 'journal/'].forEach(dir => {
        if (!files[dir]) {
            return;
        }

        Object.keys(files[dir]).forEach(filename => {
            if (filename === CONFIG_PATH || filename === CHAT_PATH) {
                return;
            }
            const key = `${filename.replace(/\.md$/, '')}`;
            const url = `${dir}/${filename}`.replace(/ /g, '%20');
            const filePath = `${filename.replace(/\.md$/, '')}](${url})`;

            lowPriorityEntries.push({
                key,
                filePath,
                lastModified: files[dir][filename].lastModified
            });
        });
    });

    lowPriorityEntries.sort((a, b) => b.lastModified - a.lastModified);
    lowPriorityEntries.forEach(entry => {
        dict[entry.key] = entry.filePath;
    });

    return dict;
}

async function newFile(parentDir, forceTemplateChoice = false) {
    log('New file clicked');

    try {
        const template = await pickNewFileTemplate(forceTemplateChoice);
        if (!template) {
            return;
        }

        // New files always land at the root. The `parentDir` parameter is still
        // honored (sidebar right-click ??New file inside a specific folder).
        const dirPath = parentDir !== undefined
            ? (parentDir === '/' ? '/' : parentDir.replace(/\/$/, ''))
            : '/';

        let filename = 'New file.md';
        let num = 1;
        while (getMemFile(joinPath(dirPath, filename)) !== null) {
            log('file exists', joinPath(dirPath, filename));
            filename = `New file (${num}).md`;
            num++;
        }

        const path = joinPath(dirPath, filename);
        const titleHint = toHeader(filename);
        const body = getTemplateBody(template, titleHint);

        log('PATH', path, 'template', template);
        await write(path, body);

        let handle = await getFileHandle(path, true);
        addMemFile(path, {
            isFile: true,
            content: body,
            lastModified: 0,
            handle: handle,
            path: path,
            imageUrl: null
        });

        log('Creating new file', path);
        await openFile(path);
        log('CURRENT path after new', currentEditor.path);
        focusEditorAfterTemplate(template);
        editor.focus();

        await renderSidebar();
    } catch (err) {
        logError('newFile failed', err);
        alert('Create file failed: ' + (err && err.message ? err.message : err));
    }
}

async function newFolder() {
    let folderName = prompt('Enter folder name:', 'New Folder');
    if (folderName === null) {
        return;
    }

    folderName = folderName.trim();
    if (!folderName) {
        alert('Folder name cannot be empty');
        return;
    }

    let finalFolderName = folderName;
    let num = 1;
    while (files[finalFolderName + '/']) {
        finalFolderName = `${folderName} (${num})`;
        num++;
    }

    const rootDirHandle = await getRootDirHandle();
    if (typeof isTauriWorkspaceBound === 'function' && isTauriWorkspaceBound()) {
        await tauriCreateDir('/' + finalFolderName);
    } else {
        await rootDirHandle.getDirectoryHandle(finalFolderName, { create: true });
    }
    files[finalFolderName + '/'] = {};

    log('CREATED folder', finalFolderName);

    await renderSidebar(finalFolderName);
}

function isMetaKey(event) {
    return event.metaKey || event.ctrlKey || event.altKey;
}

function isSidebarToggleShortcut(event) {
    if (!isMetaKey(event)) {
        return false;
    }

    // Match the physical shortcut key across ANSI/ISO keyboard layouts.
    return event.code === 'Backquote'
        || event.code === 'IntlBackslash'
        || event.key === '`'
        || event.key === '~'
        || event.key === '?'
        || event.key === '?';
}

async function applyWorkspaceDirectory(dirHandle) {
    while (isLoadingLocalFiles) {
        await new Promise(r => setTimeout(r, 50));
    }

    await saveDirectoryHandle(dirHandle);
    await ensureWorkspaceHelpFile();
    // loadLocalFiles owns the loading flag. Setting it here made the loader
    // return the previous workspace immediately instead of reading dirHandle.
    files = await loadLocalFiles(dirHandle);

    isMemFS = false;
    hideWorkspaceOpenControls();
}

function hideWorkspaceOpenControls() {
    document.getElementById('open-folder').style.display = 'none';
    const openFolderBtn = document.getElementById('open-folder-btn');
    if (openFolderBtn) {
        // Keep the toolbar action available so a bound or broken default
        // workspace can always be switched without going through Settings.
        openFolderBtn.style.display = '';
    }
    if (typeof removeWorkspaceHintBanner === 'function') {
        removeWorkspaceHintBanner();
    }
}

async function ensureWorkspaceHelpFile() {
    try {
        if (await exists('/Help.md')) {
            return;
        }
        await write('/Help.md', getAppHelpIntro() + getHelpContent());
    } catch (error) {
        // Help.md is a convenience seed, not a condition for opening a
        // workspace. Read-only folders must still load their existing files.
        logError('Unable to initialize workspace Help.md:', error);
        showToast('Workspace opened, but Help.md could not be initialized.');
    }
}

async function applyTauriWorkspaceDirectory(path) {
    while (isLoadingLocalFiles) {
        await new Promise(r => setTimeout(r, 50));
    }
    await ensureWorkspaceHelpFile();
    files = await loadLocalFiles(null);
    isMemFS = false;
    hideWorkspaceOpenControls();
    showToast('已绑定工作区：' + path);
}

async function openDir() {
    const tauriHost = typeof isTauriHost === 'function' && isTauriHost();
    try {
        if (tauriHost) {
            const path = await selectTauriWorkspaceDirectory();
            if (path === null) {
                return;
            }
            await applyTauriWorkspaceDirectory(path);
        } else {
            if (typeof window.showDirectoryPicker !== 'function') {
                throw new TypeError('Browser directory picker unavailable');
            }
            const dirHandle = await window.showDirectoryPicker({ 'mode': 'readwrite' });
            await applyWorkspaceDirectory(dirHandle);
        }
    } catch (error) {
        if (error?.name === 'AbortError') {
            return;
        }
        if (tauriHost) {
            logError('Unable to open Tauri workspace:', error);
            const detail = error instanceof Error ? error.message : String(error);
            alert('Unable to open folder.\n\n' + detail);
        } else if (error instanceof TypeError) {
            alert('For now only Chrome browser supports local folders :(');
        }
        return;
    }

    renderSidebar();
    void loadWorkspaceConfig().then(() => detectVcsRepo());
    await initPlugins();
    await openChat();
    if (typeof refreshChatArchiveUi === 'function') {
        refreshChatArchiveUi();
    }
}

function getCurrentContent() {
    let content = currentEditor.getValue();
    const header = toHeader(toFilename(currentEditor.path)).toLowerCase();
    // Remove header if it exists.
    if (content.toLowerCase().startsWith(header)) {
        content = content.slice(`${header}\n`.length);
    } else if (content.toLowerCase().startsWith('# ')) {
        // Skip header placeholder.
        // What is the case when starts with # '? Empty filename? Header not equal to original header?
        // TODO but do we always have \n?
        content = content.slice(`# \n`.length);
    }

    return content;
}

function toHeader(filename) {
    let header = filename;
    if (filename.endsWith('.md')) {
        header = trimPostfix(filename, '.md');
    }

    return `# ${header}`;
}

function fromHeaderToFilename(header) {
    if (header.startsWith('# ')) {
        return header.slice(2).trim() + '.md';
    }
    return header.trim() + '.md';
}

function ucfirst(val) {
    return String(val).charAt(0).toUpperCase() + String(val).slice(1);
}

async function getImageUrl(fileHandle) {
    const file = await fileHandle.getFile();
    return URL.createObjectURL(file);
}

// Normalize text to use only \n as line endings
function normNewLines(text) {
    return text.replace(/\r\n|\r/g, '\n');
}

function showToast(msg, ms = 1500) {
    const toast = document.createElement('div');
    toast.className = 'app-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    if (msg instanceof Node) {
        toast.appendChild(msg);
    } else {
        toast.textContent = msg;
    }
    // Center over the editor area (not the whole viewport) so the toast
    // sits above the content rather than drifting onto the sidebar.
    const editorContainer = document.getElementById('editor-container');
    const rect = editorContainer ? editorContainer.getBoundingClientRect() : null;
    const centerX = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
    toast.style.left = `${centerX}px`;
    toast.style.setProperty('--app-toast-duration', `${Math.max(ms, 300)}ms`);
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), ms);
}

function initDB() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open('files', 1);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('handles')) {
                db.createObjectStore('handles');
            }
        };
    });
}

async function saveDirectoryHandle(directoryHandle) {
    const db = await initDB();
    const transaction = db.transaction('handles', 'readwrite');
    const store = transaction.objectStore('handles');
    return new Promise((resolve, reject) => {
        const request = store.put(directoryHandle, 'savedDirectoryHandle');
        request.onerror = () => reject(request.error);
        transaction.oncomplete = () => resolve(undefined);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('Saving directory handle was aborted'));
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
        const transaction = db.transaction('handles', 'readwrite');
        const store = transaction.objectStore('handles');
        const request = store.delete('savedDirectoryHandle');
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
    });
}

async function getRootDirHandle() {
    const savedDirHandle = await getSavedRootDirHandle();
    // If the saved handle is from a browser missing createWritable or
    // remove (Safari OPFS, older Chromium), fall back to the in-memory FS
    // instead of letting later writes/deletes blow up.
    if (!isBrowserDirectoryHandle(savedDirHandle) || !opfsIsFullyUsable()) {
        return await getTemporaryStorageDirHandle();
    }

    return savedDirHandle;
}

const resizeHandle = document.querySelector('.resize');
let isResizing = false;
resizeHandle.addEventListener('mousedown', initResize);
document.addEventListener('mousemove', doResize);
document.addEventListener('mouseup', stopResize);

function initResize(e) {
    isResizing = true;
    document.body.classList.add('dragging');
    e.preventDefault();
}

function doResize(e) {
    if (!isResizing) return;

    log(e);
    const width = e.clientX;
    const minWidth = 200;
    const maxWidth = 600;

    const constrainedWidth = Math.min(Math.max(width, minWidth), maxWidth);
    sidebar.style.setProperty('width', constrainedWidth + 'px', 'important');
    if (typeof fitEditorLayout === 'function' && typeof editor !== 'undefined') {
        fitEditorLayout(editor);
    }
}

function stopResize() {
    if (!isResizing) return;
    isResizing = false;
    document.body.classList.remove('dragging');
    if (typeof fitEditorLayout === 'function') {
        if (typeof editor !== 'undefined') {
            fitEditorLayout(editor);
        }
        if (typeof editor2 !== 'undefined') {
            fitEditorLayout(editor2);
        }
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('sidebar');
    const openSidebar = document.getElementById('open-sidebar');

    const isHidden = sidebar.style.display === 'none'
        || getComputedStyle(sidebar).display === 'none';

    if (isHidden) {
        sidebar.style.display = 'flex';
        openSidebar.style.display = 'none';
        // Suppresses the mobile media-query that hides the sidebar.
        document.body.classList.add('sidebar-open');
    } else {
        sidebar.style.display = 'none';
        openSidebar.style.display = 'block';
        document.body.classList.remove('sidebar-open');
        if (isChat) {
            chatInput.focus();
        } else {
            currentEditor.focus();
        }
    }
    if (typeof isChat !== 'undefined' && isChat && typeof fitChatLayout === 'function') {
        fitChatLayout();
    } else if (typeof fitEditorLayout === 'function') {
        if (typeof editor !== 'undefined') {
            fitEditorLayout(editor);
        }
        if (typeof editor2 !== 'undefined') {
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
    return window.COMMIT_HASH ? window.COMMIT_HASH.replace('?v=', '') : '';
}

const EDITOR2_MOTION_DURATION = 320;
const EDITOR2_MOTION_EASING = 'cubic-bezier(0.22, 0.78, 0.24, 1)';
let editor2Motion: Animation | null = null;
let editor2MotionTarget: 'shown' | 'hidden' = 'hidden';

function prefersReducedMotion(): boolean {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

function finishEditor2Motion(editor2Container: HTMLElement, shown: boolean) {
    editor2Motion?.cancel();
    editor2Motion = null;
    editor2Container.classList.remove('is-animating');

    if (shown) {
        editor2Container.classList.add('show');
        editor2Container.style.display = 'flex';
        editor2Container.setAttribute('aria-hidden', 'false');
        return;
    }

    editor2Container.classList.remove('show');
    editor2Container.style.display = 'none';
    editor2Container.setAttribute('aria-hidden', 'true');
    if (typeof fitEditorLayout === 'function') {
        fitEditorLayout(editor);
    } else {
        editor.refresh();
    }
}

/**
 * Editor2 uses one persistent pair of keyframes in both directions. Reversing
 * an in-flight animation keeps the panel attached to the pointer instead of
 * restarting from either edge when open/close is clicked quickly.
 */
function setEditor2Visible(editor2Container: HTMLElement, shown: boolean) {
    editor2MotionTarget = shown ? 'shown' : 'hidden';
    editor2Container.classList.toggle('show', shown);
    editor2Container.setAttribute('aria-hidden', shown ? 'false' : 'true');

    if (prefersReducedMotion() || typeof editor2Container.animate !== 'function') {
        finishEditor2Motion(editor2Container, shown);
        return;
    }

    editor2Container.classList.add('is-animating');

    if (editor2Motion && editor2Motion.playState !== 'finished') {
        const desiredRate = shown ? 1 : -1;
        if (Math.sign(editor2Motion.playbackRate) !== desiredRate) {
            editor2Motion.updatePlaybackRate(desiredRate);
        }
        editor2Motion.play();
        return;
    }

    editor2Motion?.cancel();
    editor2Motion = editor2Container.animate([
        { opacity: 0, transform: 'translateX(24px) scale(0.992)' },
        { opacity: 1, transform: 'translateX(0) scale(1)' },
    ], {
        duration: EDITOR2_MOTION_DURATION,
        easing: EDITOR2_MOTION_EASING,
        fill: 'both',
    });

    if (!shown) {
        editor2Motion.pause();
        editor2Motion.currentTime = EDITOR2_MOTION_DURATION;
        editor2Motion.updatePlaybackRate(-1);
        editor2Motion.play();
    }

    editor2Motion.onfinish = () => {
        const arrivedShown = editor2MotionTarget === 'shown';
        finishEditor2Motion(editor2Container, arrivedShown);
    };
}

function showEditor2() {
    const editor2Container = document.getElementById('editor2-container') as HTMLElement;
    const alreadyShown = editor2MotionTarget === 'shown'
        && editor2Container.style.display !== 'none';
    if (alreadyShown) {
        return;
    }

    rememberEditorPos();

    editor2Container.style.display = 'flex';
    setEditor2Visible(editor2Container, true);

    if (typeof fitEditorLayout === 'function') {
        fitEditorLayout(editor);
        fitEditorLayout(editor2);
    } else {
        editor.refresh();
    }
    editor2.focus();
    restoreEditorPos();
}

function hideEditor2() {
    if (typeof editor2 === 'undefined') {
        return
    }

    const editor2Container = document.getElementById('editor2-container') as HTMLElement;

    if (editor2Container.style.display !== 'none' || editor2Container.classList.contains('show')) {
        setEditor2Visible(editor2Container, false);
    }
    restoreEditorPos();

    // Clear editor2's path so a subsequent openFile for the same path
    // doesn't take the isSameFile short-circuit (which skips re-init and
    // would leave the panel visually empty after editor1 re-init nuked
    // editor2's wrapper).
    editor2.path = undefined;
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
    var isGoogleChrome = isChromium !== null
        && typeof isChromium !== "undefined"
        && vendorName === "Google Inc."
        && isOpera === false
        && isIEedge === false
        && (typeof winNav.userAgentData === "undefined" || winNav.userAgentData.brands.some(x => x.brand === "Google Chrome"));

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

// Custom global log() function that display immediate values and writes to a file.
// Logging a JavaScript object to the console isn't logging that object's state, it is logging an object reference.
// We make a deep copy of the object at the moment of calling so to display its true value.
function log(...args) {
    logf('', '#4CAF50', args);
}

function logError(...args) {
    logf('Error: ', '#F44336', args);
}

async function logf(prefix, color, args) {
    // Capture real caller from stack (skip 2 levels: _logInternal and log/error)
    const stack = new Error().stack;

    // Extract 3 and 4 lines from stack trace
    const callerFull = stack.split('\n')[3].trim(); // Real caller line
    // Extract only the last path segment
    const callerMatch = callerFull.match(/([^\/\\]+:\d+:\d+)/);
    let caller = callerMatch ? callerMatch[1] : callerFull;

    // Extract 4 if exists
    const callerFull2 = stack.split('\n')[4]?.trim();
    const caller2Match = callerFull2 ? callerFull2.match(/([^\/\\]+:\d+:\d+)/) : null;
    const caller2 = caller2Match ? caller2Match[1] : null;
    if (caller2) {
        // Append second caller for better context
        caller += ` <- ${caller2}`;
    }

    // Format message
    const msg = args.map(arg =>
        typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
    ).join(' ');

    // Get time for console
    const date = new Date();
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    const time = `${hours}:${minutes}:${seconds}`;

    // Compact console output with colors
    console.log(
        `%c[${time}]%c ${msg}%c ${caller}`,
        'color: #888; font-size: 0.9em',      // Time in gray
        `color: ${color}; font-weight: bold`, // Message in specified color
        'color: #888; font-size: 0.9em'       // Stack trace in gray
    );

    // File logging with full timestamp
    const day = date.getDate().toString().padStart(2, '0');
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const year = date.getFullYear();

    const now = `${day}.${month}.${year} ${time}`;
    const logMsg = `${now} ${prefix}[${callerFull}] ${msg}\n`;

    try {
        await writeAtEnd(LOG_PATH, logMsg);
    } catch (error) {
    }
}

let operationCounter = 0;
function opId() {
    return `${++operationCounter}`;
}

// Event listeners

// Hotkeys
window.addEventListener('keydown', async (event) => {
    if (isMetaKey(event) && event.key == 'w') {
        hideEditor2();
    }

    if (isMetaKey(event) && event.key === 'p') {
        event.preventDefault();
        event.stopPropagation();
        document.getElementById('search-input').value = ''
        searchModal.open();
    }

    if (isMetaKey(event) && event.key === 'k') {
        event.preventDefault();
        event.stopPropagation();
        document.getElementById('search-input').value = ''
        searchModal.open();
    }

    if (isMetaKey(event) && event.key === 'm') {
        event.preventDefault();
        event.stopPropagation();
        document.getElementById('move-input').value = ''
        moveModal.open();
    }

    if (isMetaKey(event) && event.key === 'd') {
        log('cmd+d');
        event.preventDefault();
        event.stopPropagation();
        removeCurrentFile();
    }

    if (isMetaKey(event) && event.shiftKey && (event.key === 'r' || event.key === 'R')) {
        event.preventDefault();
        event.stopPropagation();
        toggleReadMode();
    }

    if (handlePluginKeyboard(event)) {
        return;
    }

    if (isMetaKey(event) && event.key === 'n') {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();

        if (event.shiftKey) {
            await newFolder();
        } else if (event.altKey) {
            event.preventDefault();
            event.stopPropagation();
            await newFile(undefined, true);
        } else {
            await newFile();
        }
    }
}, true);

document.addEventListener('keydown', (event) => {
    // TODO cursor shouldn't jump to top once we hit "esc".
    if (event.key === 'Escape') {
        if (handlePluginEscape()) {
            editor.focus();
            event.preventDefault();
            return;
        }

        if (chatContainer.style.display !== 'none') {
            const selectedMessages = chat.querySelectorAll('.message.selected');
            if (selectedMessages.length > 0) {
                selectedMessages.forEach(message => message.classList.remove('selected'));
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

        const allMessages = chat.querySelectorAll('.message');
        allMessages.forEach(message => message.classList.remove('selected'));
        // If in chat, focus chat input
        if (isChat) {
            chatInput.focus();
        }
    }
});

// Toggle focus mode
document.addEventListener('keydown', function(event) {
    // Cmd+shift+enter toggle chat modal.
    if (event.shiftKey && isMetaKey(event) && event.key === 'Enter') {
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
    if (isMetaKey(event) && event.key === 'Enter') {
        openChat();
    }
});

document.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey) {
        document.body.classList.add('cmd-pressed');
    }
});

document.addEventListener('keyup', (e) => {
    if (!e.metaKey && !e.ctrlKey) {
        document.body.classList.remove('cmd-pressed');
    }
});

window.addEventListener('popstate', (event) => {
    const state = event.state;
    if (state) {
        openFile(state.path, false, state.el);
    }
});

// Reload files once the app gains focus.
window.addEventListener('focus', async () => {
    // Clear any pending chat open timer.
    if (openChatIdleTimer) {
        clearTimeout(openChatIdleTimer);
        openChatIdleTimer = null;
    }

    // We don't want to reload files when chat is open.
    if (isChat || isMemFS) {
        if (isChat) {
            document.getElementById('chat-input').focus();
        }
        return false;
    }

    log('FOCUS');

    if (currentEditor.path === undefined) {
        return;
    }

    document.getElementById('chat-input').focus();

    const savedDirectoryHandle = await getRootDirHandle();

    await syncCurrentFile();

    const start = performance.now();
    files = await loadLocalFiles(savedDirectoryHandle, true);
    const end = performance.now();
    log(`Files loaded in: ${(end - start).toFixed(3)} milliseconds`);
    await renderSidebar();
    log('Reload completed');
});

// Sync files on chat focus lose.
window.addEventListener('blur', async function() {
    log('BLUR');
    editor.refresh();

    // Start timer to open chat after idle.
    openChatIdleTimer = setTimeout(() => {
        openChat();
    }, OPEN_CHAT_AFTER_IDLE);

    // Sync media first, so that new images for current file would be loaded
    // if files is not empty object
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
    log('Save completed');
});

document.addEventListener('keydown', (e) => {
    // If search or move dialog is focused - return
    if (document.getElementById('search').style.display !== 'none' ||
        document.getElementById('move').style.display !== 'none') {
        return;
    }

    if (isChat) {
        return;
    }
}, true);

window.addEventListener('beforeunload', function() {
    clearInterval(window.saver);
});

// Worker to process the saving queue
window.saver = setInterval(() => {
    if (document.hasFocus()) {
        syncCurrentFile();
    }
}, CURRENT_FILE_SYNC_INTERVAL);
