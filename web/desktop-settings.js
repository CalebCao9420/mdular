// Generated from src/ — edit TypeScript and run: npm run build

let desktopSettingsState = {
  schemaVersion: 1,
  defaultPath: null,
  openOnStartup: false
};
let desktopSettingsInitialized = false;
let desktopSettingsBusy = false;
let desktopSettingsStartupWorkspaceBound = false;
let desktopSettingsReturnFocus = null;
function desktopSettingsElement(id) {
  return document.getElementById(id);
}
function normalizeWorkspaceStartupSettings(value) {
  const source = value || {};
  return {
    schemaVersion: typeof source.schemaVersion === "number" ? source.schemaVersion : 1,
    defaultPath: typeof source.defaultPath === "string" && source.defaultPath.trim() ? source.defaultPath.trim() : null,
    openOnStartup: source.openOnStartup === true
  };
}
function desktopSettingsErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
function setDesktopSettingsStatus(message, error = false) {
  const status = desktopSettingsElement("desktop-settings-status");
  if (null === status) {
    return;
  }
  status.textContent = message;
  status.dataset.kind = error ? "error" : "info";
}
function renderDesktopSettings() {
  const path = desktopSettingsElement("desktop-settings-path");
  const choose = desktopSettingsElement("desktop-settings-choose");
  const clear = desktopSettingsElement("desktop-settings-clear");
  const startup = desktopSettingsElement("desktop-settings-open-on-startup");
  if (null !== path) {
    path.textContent = desktopSettingsState.defaultPath || "Not set";
    path.dataset.empty = desktopSettingsState.defaultPath ? "false" : "true";
  }
  if (null !== choose) {
    choose.disabled = desktopSettingsBusy;
  }
  if (null !== clear) {
    clear.disabled = desktopSettingsBusy || null === desktopSettingsState.defaultPath;
  }
  if (null !== startup) {
    startup.checked = desktopSettingsState.openOnStartup;
    startup.disabled = desktopSettingsBusy || null === desktopSettingsState.defaultPath;
  }
}
function setDesktopSettingsBusy(busy) {
  desktopSettingsBusy = busy;
  renderDesktopSettings();
}
function setDesktopSettingsSummary() {
  if (desktopSettingsState.openOnStartup && null !== desktopSettingsState.defaultPath && !desktopSettingsStartupWorkspaceBound) {
    setDesktopSettingsStatus(
      "Default workspace unavailable. Choose it again or use Open Folder.",
      true
    );
    return;
  }
  setDesktopSettingsStatus(
    null === desktopSettingsState.defaultPath ? "No default workspace selected." : "Saved for the next launch."
  );
}
async function refreshDesktopSettings() {
  desktopSettingsState = normalizeWorkspaceStartupSettings(
    await tauriInvoke("workspace_get_startup_settings")
  );
  renderDesktopSettings();
  setDesktopSettingsSummary();
}
async function chooseDesktopDefaultWorkspace() {
  setDesktopSettingsBusy(true);
  try {
    const selected = await tauriInvoke(
      "workspace_choose_default"
    );
    if (null === selected) {
      setDesktopSettingsStatus("Selection unchanged.");
      return;
    }
    desktopSettingsState = normalizeWorkspaceStartupSettings(selected);
    desktopSettingsStartupWorkspaceBound = true;
    renderDesktopSettings();
    setDesktopSettingsStatus("Default workspace saved for the next launch.");
  } catch (error) {
    setDesktopSettingsStatus("Unable to choose workspace: " + desktopSettingsErrorMessage(error), true);
  } finally {
    setDesktopSettingsBusy(false);
  }
}
async function clearDesktopDefaultWorkspace() {
  setDesktopSettingsBusy(true);
  try {
    desktopSettingsState = normalizeWorkspaceStartupSettings(
      await tauriInvoke("workspace_clear_default")
    );
    renderDesktopSettings();
    setDesktopSettingsStatus("Default workspace cleared.");
  } catch (error) {
    setDesktopSettingsStatus("Unable to clear workspace: " + desktopSettingsErrorMessage(error), true);
  } finally {
    setDesktopSettingsBusy(false);
  }
}
async function updateDesktopOpenOnStartup(enabled) {
  setDesktopSettingsBusy(true);
  try {
    desktopSettingsState = normalizeWorkspaceStartupSettings(
      await tauriInvoke("workspace_set_open_on_startup", { enabled })
    );
    renderDesktopSettings();
    setDesktopSettingsStatus(enabled ? "Workspace will open on startup." : "Startup opening disabled.");
  } catch (error) {
    renderDesktopSettings();
    setDesktopSettingsStatus("Unable to update startup setting: " + desktopSettingsErrorMessage(error), true);
  } finally {
    setDesktopSettingsBusy(false);
  }
}
async function openDesktopSettings() {
  if (!isTauriHost()) {
    return;
  }
  const overlay = desktopSettingsElement("desktop-settings");
  if (null === overlay) {
    return;
  }
  desktopSettingsReturnFocus = document.activeElement;
  overlay.style.display = "flex";
  desktopSettingsElement("desktop-settings-close")?.focus();
  try {
    await refreshDesktopSettings();
  } catch (error) {
    setDesktopSettingsStatus("Unable to load settings: " + desktopSettingsErrorMessage(error), true);
  }
}
function closeDesktopSettings() {
  const overlay = desktopSettingsElement("desktop-settings");
  if (null !== overlay) {
    overlay.style.display = "none";
  }
  desktopSettingsReturnFocus?.focus();
  desktopSettingsReturnFocus = null;
}
async function initDesktopSettings(workspaceBound) {
  if (!isTauriHost()) {
    return;
  }
  desktopSettingsStartupWorkspaceBound = workspaceBound;
  const button = desktopSettingsElement("desktop-settings-btn");
  if (null !== button) {
    button.style.display = "";
  }
  if (!desktopSettingsInitialized) {
    desktopSettingsInitialized = true;
    button?.addEventListener("click", () => {
      void openDesktopSettings();
    });
    desktopSettingsElement("desktop-settings-close")?.addEventListener("click", closeDesktopSettings);
    desktopSettingsElement("desktop-settings-choose")?.addEventListener("click", () => {
      void chooseDesktopDefaultWorkspace();
    });
    desktopSettingsElement("desktop-settings-clear")?.addEventListener("click", () => {
      void clearDesktopDefaultWorkspace();
    });
    desktopSettingsElement("desktop-settings-open-on-startup")?.addEventListener("change", (event) => {
      void updateDesktopOpenOnStartup(event.currentTarget.checked);
    });
    desktopSettingsElement("desktop-settings")?.addEventListener("click", (event) => {
      if (event.currentTarget === event.target) {
        closeDesktopSettings();
      }
    });
    document.addEventListener("keydown", (event) => {
      if ("Escape" !== event.key) {
        return;
      }
      const overlay = desktopSettingsElement("desktop-settings");
      if (null === overlay || "none" === overlay.style.display) {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      closeDesktopSettings();
    }, true);
  }
  try {
    await refreshDesktopSettings();
    if (desktopSettingsState.openOnStartup && null !== desktopSettingsState.defaultPath && !workspaceBound) {
      showToast("Default workspace unavailable. Open Folder or update it in Settings.");
    }
  } catch (error) {
    setDesktopSettingsStatus("Unable to load settings: " + desktopSettingsErrorMessage(error), true);
  }
}
Object.assign(globalThis, {
  initDesktopSettings,
  openDesktopSettings,
  closeDesktopSettings
});
