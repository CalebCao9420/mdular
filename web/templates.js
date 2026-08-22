// Generated from src/ — edit TypeScript and run: npm run build

const TEMPLATE_PREF_KEY = appStorageKey("default-template");
function getSavedTemplateChoice() {
  const value = localStorage.getItem(TEMPLATE_PREF_KEY);
  return value === "plain" || value === "frontmatter" ? value : null;
}
function saveTemplateChoice(template) {
  localStorage.setItem(TEMPLATE_PREF_KEY, template);
}
function clearSavedTemplateChoice() {
  localStorage.removeItem(TEMPLATE_PREF_KEY);
}
function todayIsoDate() {
  return (/* @__PURE__ */ new Date()).toISOString().slice(0, 10);
}
function buildPlainTemplateBody() {
  return "";
}
function buildFrontmatterTemplateBody(title) {
  const safeTitle = String(title || "").replace(/\n/g, " ").trim();
  return [
    "---",
    "status: draft",
    `title: ${safeTitle}`,
    "tags:",
    `date: ${todayIsoDate()}`,
    "---",
    "",
    ""
  ].join("\n");
}
function getTemplateBody(template, titleHint) {
  if (template === "frontmatter") {
    return buildFrontmatterTemplateBody(titleHint);
  }
  return buildPlainTemplateBody();
}
function focusAfterFrontmatter(cm) {
  if (!cm) {
    return;
  }
  const lines = cm.getValue().split("\n");
  let dashCount = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== "---") {
      continue;
    }
    dashCount++;
    if (dashCount === 2) {
      cm.setCursor({ line: Math.min(i + 1, cm.lastLine()), ch: 0 });
      return;
    }
  }
  cm.setCursor({ line: 1, ch: 0 });
}
function focusEditorAfterTemplate(template) {
  if (template === "frontmatter") {
    focusAfterFrontmatter(currentEditor);
    return;
  }
  currentEditor?.setCursor({ line: 1, ch: 0 });
}
class NewFileTemplateModal {
  constructor() {
    this.focusedIndex = 0;
    this.resolve = null;
    this.ignoreOutsideClickUntil = 0;
    this.modal = document.getElementById("new-file-template");
    this.options = document.getElementById("new-file-template-options");
    this.rememberCheckbox = document.getElementById(
      "new-file-template-remember"
    );
    this.init();
  }
  init() {
    if (!this.modal || !this.options) {
      logError("New file template modal elements missing");
      return;
    }
    this.options.querySelectorAll("li").forEach((item, index) => {
      item.addEventListener(
        "click",
        () => this.choose(item.getAttribute("data-template"))
      );
      item.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          this.choose(item.getAttribute("data-template"));
        }
        if (event.key === "ArrowDown") {
          event.preventDefault();
          this.focusedIndex = (index + 1) % this.options.children.length;
          this.updateFocusedItem();
        }
        if (event.key === "ArrowUp") {
          event.preventDefault();
          this.focusedIndex = (index - 1 + this.options.children.length) % this.options.children.length;
          this.updateFocusedItem();
        }
      });
    });
    document.addEventListener("keydown", (event) => {
      if (!this.modal || this.modal.style.display === "none") {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        this.cancel();
      }
    });
    document.addEventListener("click", (event) => {
      if (!this.modal || this.modal.style.display === "none") {
        return;
      }
      if (Date.now() < this.ignoreOutsideClickUntil) {
        return;
      }
      if (!this.modal.contains(event.target)) {
        this.cancel();
      }
    });
  }
  pick() {
    return new Promise((resolve) => {
      if (!this.modal) {
        resolve("plain");
        return;
      }
      this.resolve = resolve;
      this.rememberCheckbox.checked = getSavedTemplateChoice() !== null;
      this.focusedIndex = 0;
      this.updateFocusedItem();
      this.ignoreOutsideClickUntil = Date.now() + 250;
      setTimeout(() => {
        this.modal.style.display = "flex";
        this.modal.style.position = "fixed";
        this.modal.style.top = "30%";
        this.modal.style.left = "50%";
        this.modal.style.transform = "translate(-50%, 0)";
        this.modal.style.zIndex = "10001";
        this.options.children[this.focusedIndex]?.focus();
      }, 0);
    });
  }
  choose(template) {
    if (!template) {
      return;
    }
    if (this.rememberCheckbox.checked) {
      saveTemplateChoice(template);
    } else {
      clearSavedTemplateChoice();
    }
    this.close();
    if (this.resolve) {
      this.resolve(template);
      this.resolve = null;
    }
  }
  cancel() {
    this.close();
    if (this.resolve) {
      this.resolve(null);
      this.resolve = null;
    }
  }
  close() {
    if (this.modal) {
      this.modal.style.display = "none";
    }
  }
  updateFocusedItem() {
    const items = this.options.querySelectorAll("li");
    items.forEach((item, index) => {
      item.classList.toggle("focused", index === this.focusedIndex);
      if (index === this.focusedIndex) {
        item.focus();
      }
    });
  }
}
let newFileTemplateModal = null;
function getNewFileTemplateModal() {
  if (!newFileTemplateModal) {
    newFileTemplateModal = new NewFileTemplateModal();
  }
  return newFileTemplateModal;
}
async function pickNewFileTemplate(forceChoose = false) {
  const saved = getSavedTemplateChoice();
  if (saved && !forceChoose) {
    return saved;
  }
  return await getNewFileTemplateModal().pick();
}
function initNewFileTemplates() {
  getNewFileTemplateModal();
}
Object.assign(globalThis, {
  getSavedTemplateChoice,
  saveTemplateChoice,
  clearSavedTemplateChoice,
  todayIsoDate,
  buildPlainTemplateBody,
  buildFrontmatterTemplateBody,
  getTemplateBody,
  focusAfterFrontmatter,
  focusEditorAfterTemplate,
  NewFileTemplateModal,
  getNewFileTemplateModal,
  pickNewFileTemplate,
  initNewFileTemplates
});
