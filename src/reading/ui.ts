// @ts-nocheck
/// <reference path="../types/global.d.ts" />

// Reading: outline (TOC), frontmatter meta, read-only mode.
// parseFrontmatter / parseHeadings live in reading-parse.js (built from src/reading/parse.ts).

const READ_MODE_STORAGE_KEY = appStorageKey('read-mode');
const OUTLINE_COLLAPSED_KEY = appStorageKey('outline-collapsed');
const TOC_SKIP_PATHS = new Set(['/Chat.md']);

let readModeEnabled = localStorage.getItem(READ_MODE_STORAGE_KEY) === 'true';
let outlineCollapsed = localStorage.getItem(OUTLINE_COLLAPSED_KEY) === 'true';
let tocUpdateTimer = null;
let readingPanelActive = false;

function isReadMode() {
    return readModeEnabled;
}

function isOutlineVisible() {
    return !outlineCollapsed;
}

function setOutlineVisible(visible) {
    outlineCollapsed = !visible;
    localStorage.setItem(OUTLINE_COLLAPSED_KEY, outlineCollapsed ? 'true' : 'false');
    applyReadingPanelLayout();
}

function toggleOutlinePanel() {
    setOutlineVisible(!isOutlineVisible());
}

function setReadMode(enabled) {
    readModeEnabled = !!enabled;
    localStorage.setItem(READ_MODE_STORAGE_KEY, readModeEnabled ? 'true' : 'false');
    document.body.classList.toggle('read-mode', readModeEnabled);
    updateReadModeButton();

    applyReadModeToEditor(editor, readModeEnabled);
    if (typeof editor2 !== 'undefined') {
        applyReadModeToEditor(editor2, readModeEnabled);
    }
}

function toggleReadMode() {
    if (isChat) {
        return;
    }
    setReadMode(!readModeEnabled);
}

function applyReadModeToEditor(cm, enabled) {
    if (!cm || !cm.setOption) {
        return;
    }
    cm.setOption('readOnly', enabled);
    cm.getWrapperElement()?.classList.toggle('read-only-view', enabled);
    if (enabled) {
        cm.setOption('viewportMargin', Infinity);
    }
}

function updateReadModeButton() {
    const btn = document.getElementById('toggle-read-mode');
    if (!btn) {
        return;
    }
    btn.classList.toggle('active', readModeEnabled);
    btn.setAttribute('aria-pressed', readModeEnabled ? 'true' : 'false');
}

function updateOutlineToggleButtons() {
    const sidebarToggle = document.getElementById('doc-toc-toggle');
    const toolbarToggle = document.getElementById('toggle-outline');
    const visible = isOutlineVisible();

    if (sidebarToggle) {
        sidebarToggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
    }
    if (toolbarToggle) {
        toolbarToggle.classList.toggle('active', visible);
        toolbarToggle.setAttribute('aria-pressed', visible ? 'true' : 'false');
    }
}

function hideReadingPanel() {
    const panel = document.getElementById('reading-panel');
    if (panel) {
        panel.style.display = 'none';
    }
    readingPanelActive = false;
}

function applyReadingPanelLayout() {
    const panel = document.getElementById('reading-panel');
    const metaEl = document.getElementById('doc-meta');
    if (!panel || !readingPanelActive) {
        hideReadingPanel();
        return;
    }

    const hasMeta = metaEl && metaEl.style.display !== 'none' && metaEl.childElementCount > 0;
    const showOutline = isOutlineVisible();

    panel.classList.toggle('outline-collapsed', !showOutline);

    if (!showOutline && !hasMeta) {
        panel.style.display = 'none';
    } else {
        panel.style.display = 'block';
    }

    updateOutlineToggleButtons();
}

function renderDocMeta(meta) {
    const el = document.getElementById('doc-meta');
    if (!el) {
        return;
    }
    el.innerHTML = '';
    if (!meta) {
        el.style.display = 'none';
        return;
    }

    const preferred = ['title', 'status', 'tags', 'date', 'author', 'category'];
    const keys = [...new Set([...preferred, ...Object.keys(meta)])];

    for (const key of keys) {
        if (!(key in meta)) {
            continue;
        }
        const chip = document.createElement('span');
        chip.className = 'doc-meta-chip';
        chip.innerHTML = `<span class="doc-meta-key">${escapeHtml(key)}</span>${escapeHtml(meta[key])}`;
        el.appendChild(chip);
    }
    el.style.display = el.childElementCount ? 'flex' : 'none';
}

function renderDocToc(headings, activeEditor) {
    const el = document.getElementById('doc-toc');
    if (!el) {
        return;
    }
    el.innerHTML = '';

    if (!headings.length) {
        el.innerHTML = '<div class="doc-toc-empty">No headings</div>';
        return;
    }

    for (const heading of headings) {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'doc-toc-item';
        item.style.paddingLeft = `${(heading.level - 1) * 12 + 8}px`;
        item.textContent = heading.text;
        item.title = heading.text;
        item.addEventListener('click', () => {
            if (!activeEditor) {
                return;
            }
            activeEditor.setCursor({ line: heading.line, ch: 0 });
            activeEditor.scrollIntoView({ line: heading.line, ch: 0 }, 120);
            activeEditor.focus();
        });
        el.appendChild(item);
    }
}

function escapeHtml(text) {
    return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function updateReadingPanel(content, path, activeEditor) {
    const panel = document.getElementById('reading-panel');
    if (!panel) {
        return;
    }

    if (isChat || !path || TOC_SKIP_PATHS.has(path) || !path.endsWith('.md')) {
        hideReadingPanel();
        return;
    }

    readingPanelActive = true;
    const { meta } = parseFrontmatter(content);
    const headings = parseHeadings(content);
    renderDocMeta(meta);
    renderDocToc(headings, activeEditor || currentEditor);
    applyReadingPanelLayout();
}

function scheduleReadingPanelUpdate(cm) {
    if (!cm || cm.path === undefined || isChat) {
        return;
    }
    clearTimeout(tocUpdateTimer);
    tocUpdateTimer = setTimeout(() => {
        updateReadingPanel(cm.getValue(), cm.path, cm);
    }, 200);
}

function bindEditorForReading(cm) {
    if (!cm) {
        return;
    }
    cm.on('changes', () => scheduleReadingPanelUpdate(cm));
    applyReadModeToEditor(cm, readModeEnabled);
}

function initReading() {
    setReadMode(readModeEnabled);
    updateOutlineToggleButtons();

    const tocToggle = document.getElementById('doc-toc-toggle');
    if (tocToggle) {
        tocToggle.addEventListener('click', () => {
            toggleOutlinePanel();
        });
    }

    const toolbarOutline = document.getElementById('toggle-outline');
    if (toolbarOutline) {
        toolbarOutline.addEventListener('click', () => {
            toggleOutlinePanel();
        });
    }

    const readBtn = document.getElementById('toggle-read-mode');
    if (readBtn) {
        readBtn.addEventListener('click', toggleReadMode);
    }
}

function onDocumentOpened(content, path) {
    updateReadingPanel(content, path, currentEditor);
    if (readModeEnabled) {
        applyReadModeToEditor(currentEditor, true);
    }
}

Object.assign(globalThis, {
    isReadMode,
    isOutlineVisible,
    toggleOutlinePanel,
    setReadMode,
    toggleReadMode,
    initReading,
    bindEditorForReading,
    onDocumentOpened,
    hideReadingPanel,
    updateReadingPanel,
});
