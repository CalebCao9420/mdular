use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

mod tray;
mod updater;

struct AppState {
    workspace_path: Mutex<Option<PathBuf>>,
}

const WORKSPACE_STARTUP_SETTINGS_FILE: &str = "workspace-startup.json";

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct WorkspaceStartupSettings {
    schema_version: u32,
    default_path: Option<String>,
    open_on_startup: bool,
}

impl Default for WorkspaceStartupSettings {
    fn default() -> Self {
        Self {
            schema_version: 1,
            default_path: None,
            open_on_startup: false,
        }
    }
}

fn app_environment_variable_name(suffix: &str) -> String {
    let prefix: String = env!("CARGO_PKG_NAME")
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character.to_ascii_uppercase()
            } else {
                '_'
            }
        })
        .collect();
    format!("{prefix}_{suffix}")
}

fn app_environment_value(suffix: &str) -> Option<String> {
    std::env::var(app_environment_variable_name(suffix)).ok()
}

#[derive(Serialize)]
struct ListedFile {
    relative_path: String,
    last_modified_ms: u64,
}

fn normalize_relative(relative_path: &str) -> PathBuf {
    PathBuf::from(
        relative_path
            .trim()
            .trim_start_matches('/')
            .replace('/', std::path::MAIN_SEPARATOR_STR),
    )
}

fn checked_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let rel = normalize_relative(relative_path);
    if rel.as_os_str().is_empty() {
        return Err("path must not be empty".into());
    }

    for component in rel.components() {
        let Component::Normal(segment) = component else {
            return Err("path escapes workspace".into());
        };

        #[cfg(windows)]
        if segment.to_string_lossy().contains(':') {
            return Err("invalid Windows path component".into());
        }
    }

    Ok(rel)
}

fn canonical_workspace_root(root: &Path) -> Result<PathBuf, String> {
    root.canonicalize()
        .map_err(|e| format!("workspace root invalid: {e}"))
}

fn canonical_existing_workspace_root(candidate: &Path) -> Result<PathBuf, String> {
    if !candidate.is_dir() {
        return Err("workspace path must be an existing directory".into());
    }
    canonical_workspace_root(candidate)
}

fn bind_workspace_root(
    workspace_path: &Mutex<Option<PathBuf>>,
    candidate: &Path,
) -> Result<String, String> {
    let canonical = canonical_existing_workspace_root(candidate)?;
    let display_path = canonical.to_string_lossy().into_owned();
    *workspace_path.lock().map_err(|e| e.to_string())? = Some(canonical);
    Ok(display_path)
}

fn load_workspace_startup_settings(path: &Path) -> Result<WorkspaceStartupSettings, String> {
    let source = match std::fs::read_to_string(path) {
        Ok(source) => source,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(WorkspaceStartupSettings::default())
        }
        Err(error) => {
            return Err(format!(
                "unable to read workspace startup settings: {error}"
            ))
        }
    };
    serde_json::from_str(&source)
        .map_err(|error| format!("workspace startup settings invalid: {error}"))
}

fn save_workspace_startup_settings(
    path: &Path,
    settings: &WorkspaceStartupSettings,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "workspace startup settings path has no parent".to_string())?;
    std::fs::create_dir_all(parent)
        .map_err(|error| format!("unable to create app config directory: {error}"))?;
    let content = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("unable to encode workspace startup settings: {error}"))?;
    std::fs::write(path, format!("{content}\n"))
        .map_err(|error| format!("unable to save workspace startup settings: {error}"))
}

fn workspace_startup_settings_path<R: tauri::Runtime>(
    manager: &impl Manager<R>,
) -> Result<PathBuf, String> {
    manager
        .path()
        .app_config_dir()
        .map(|path| path.join(WORKSPACE_STARTUP_SETTINGS_FILE))
        .map_err(|error| format!("app config directory unavailable: {error}"))
}

fn bind_configured_startup_workspace(
    workspace_path: &Mutex<Option<PathBuf>>,
    settings: &WorkspaceStartupSettings,
) -> Result<Option<String>, String> {
    if !settings.open_on_startup {
        return Ok(None);
    }
    let path = settings
        .default_path
        .as_deref()
        .ok_or_else(|| "default workspace is not configured".to_string())?;
    bind_workspace_root(workspace_path, Path::new(path)).map(Some)
}

fn pick_workspace_directory(
    window: &tauri::Window,
    title: &str,
) -> Result<Option<PathBuf>, String> {
    let dialog = window.dialog().file().set_title(title);
    #[cfg(any(windows, target_os = "macos"))]
    let dialog = dialog.set_parent(window);

    let Some(selected) = dialog.blocking_pick_folder() else {
        return Ok(None);
    };
    selected
        .into_path()
        .map(Some)
        .map_err(|_| "selected workspace must be a local directory".to_string())
}

fn ensure_workspace_target(
    canonical_root: &Path,
    canonical_target: &Path,
    allow_root: bool,
) -> Result<(), String> {
    if !canonical_target.starts_with(canonical_root) {
        return Err("path escapes workspace".into());
    }
    if !allow_root && canonical_target == canonical_root {
        return Err("refusing to operate on workspace root".into());
    }
    Ok(())
}

fn metadata_is_link_or_reparse(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }

    false
}

fn reject_link_components(canonical_root: &Path, rel: &Path) -> Result<(), String> {
    let mut current = canonical_root.to_path_buf();
    for component in rel.components() {
        let Component::Normal(segment) = component else {
            return Err("path escapes workspace".into());
        };
        current.push(segment);

        match std::fs::symlink_metadata(&current) {
            Ok(metadata) if metadata_is_link_or_reparse(&metadata) => {
                return Err("symbolic links and reparse points are not allowed".into());
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(())
}

fn resolve_in_workspace(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let rel = checked_relative_path(relative_path)?;
    let canonical_root = canonical_workspace_root(root)?;
    reject_link_components(&canonical_root, &rel)?;

    let joined = canonical_root.join(&rel);
    let canonical_joined = joined.canonicalize().map_err(|e| e.to_string())?;
    ensure_workspace_target(&canonical_root, &canonical_joined, false)?;
    Ok(joined)
}

fn workspace_root(state: &State<AppState>) -> Result<PathBuf, String> {
    state
        .workspace_path
        .lock()
        .map_err(|e| e.to_string())?
        .clone()
        .ok_or_else(|| {
            format!(
                "No workspace bound (set {} or -Folder)",
                app_environment_variable_name("WORKSPACE")
            )
        })
}

fn resolve_write_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let rel = checked_relative_path(relative_path)?;
    let canonical_root = canonical_workspace_root(root)?;
    reject_link_components(&canonical_root, &rel)?;

    let joined = canonical_root.join(&rel);
    let mut existing_ancestor = joined.as_path();
    while !existing_ancestor.exists() {
        existing_ancestor = existing_ancestor
            .parent()
            .ok_or_else(|| "path has no existing ancestor".to_string())?;
    }

    let canonical_ancestor = existing_ancestor
        .canonicalize()
        .map_err(|e| e.to_string())?;
    ensure_workspace_target(&canonical_root, &canonical_ancestor, true)?;
    Ok(joined)
}

fn file_modified_ms(path: &Path) -> u64 {
    path.metadata()
        .ok()
        .and_then(|m| m.modified().ok())
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn is_supported_file(name: &str) -> bool {
    if name == "config.json" {
        return true;
    }
    let ext = name.rsplit('.').next().unwrap_or("").to_lowercase();
    matches!(
        ext.as_str(),
        "md" | "png"
            | "jpg"
            | "jpeg"
            | "webp"
            | "gif"
            | "mp4"
            | "webm"
            | "mov"
            | "mp3"
            | "ogg"
            | "oga"
            | "wav"
    )
}

fn walk_workspace_files(
    dir: &Path,
    rel_prefix: &Path,
    depth: usize,
    out: &mut Vec<ListedFile>,
) -> Result<(), String> {
    if depth > 10 {
        return Ok(());
    }

    let read_dir = match std::fs::read_dir(dir) {
        Ok(rd) => rd,
        Err(e) => return Err(e.to_string()),
    };

    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().into_owned();
        let path = entry.path();
        let metadata = std::fs::symlink_metadata(&path).map_err(|e| e.to_string())?;

        // Do not follow links or Windows reparse points while walking. Without
        // this guard, a linked directory inside a workspace could expose files
        // from anywhere on disk through workspace_list_files.
        if metadata_is_link_or_reparse(&metadata) {
            continue;
        }

        if metadata.is_dir() {
            if name.starts_with('.') {
                continue;
            }
            let mut next_prefix = rel_prefix.to_path_buf();
            next_prefix.push(&name);
            walk_workspace_files(&path, &next_prefix, depth + 1, out)?;
        } else if metadata.is_file() && is_supported_file(&name) {
            let mut rel = rel_prefix.to_path_buf();
            rel.push(&name);
            out.push(ListedFile {
                relative_path: rel.to_string_lossy().replace('\\', "/"),
                last_modified_ms: file_modified_ms(&path),
            });
        }
    }

    Ok(())
}

#[tauri::command]
fn workspace_get_path(state: State<AppState>) -> Option<String> {
    state
        .workspace_path
        .lock()
        .ok()
        .and_then(|guard| guard.as_ref().map(|p| p.to_string_lossy().into_owned()))
}

#[tauri::command]
async fn workspace_pick_and_bind(
    window: tauri::Window,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    let Some(path) = pick_workspace_directory(&window, "Open folder")? else {
        return Ok(None);
    };
    bind_workspace_root(&state.workspace_path, &path).map(Some)
}

#[tauri::command]
fn workspace_get_startup_settings(
    app: tauri::AppHandle,
) -> Result<WorkspaceStartupSettings, String> {
    let path = workspace_startup_settings_path(&app)?;
    load_workspace_startup_settings(&path)
}

#[tauri::command]
async fn workspace_choose_default(
    window: tauri::Window,
) -> Result<Option<WorkspaceStartupSettings>, String> {
    let Some(selected) = pick_workspace_directory(&window, "Choose default workspace")? else {
        return Ok(None);
    };
    let canonical = canonical_existing_workspace_root(&selected)?;
    let path = workspace_startup_settings_path(window.app_handle())?;
    let mut settings = load_workspace_startup_settings(&path).unwrap_or_default();
    settings.schema_version = 1;
    settings.default_path = Some(canonical.to_string_lossy().into_owned());
    save_workspace_startup_settings(&path, &settings)?;
    Ok(Some(settings))
}

#[tauri::command]
fn workspace_set_open_on_startup(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<WorkspaceStartupSettings, String> {
    let path = workspace_startup_settings_path(&app)?;
    let mut settings = load_workspace_startup_settings(&path)?;
    if enabled {
        let default_path = settings
            .default_path
            .as_deref()
            .ok_or_else(|| "choose a default workspace first".to_string())?;
        let canonical = canonical_existing_workspace_root(Path::new(default_path))?;
        settings.default_path = Some(canonical.to_string_lossy().into_owned());
    }
    settings.open_on_startup = enabled;
    save_workspace_startup_settings(&path, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn workspace_clear_default(app: tauri::AppHandle) -> Result<WorkspaceStartupSettings, String> {
    let path = workspace_startup_settings_path(&app)?;
    let settings = WorkspaceStartupSettings::default();
    save_workspace_startup_settings(&path, &settings)?;
    Ok(settings)
}

#[tauri::command]
fn workspace_list_files(state: State<AppState>) -> Result<Vec<ListedFile>, String> {
    let root = workspace_root(&state)?;
    let root = canonical_workspace_root(&root)?;
    let mut files = Vec::new();
    walk_workspace_files(&root, Path::new(""), 0, &mut files)?;
    files.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    Ok(files)
}

#[tauri::command]
fn workspace_exists(state: State<AppState>, relative_path: String) -> Result<bool, String> {
    let root = workspace_root(&state)?;
    let path = resolve_write_path(&root, &relative_path)?;
    Ok(path.exists())
}

#[tauri::command]
fn workspace_is_dir(state: State<AppState>, relative_path: String) -> Result<bool, String> {
    let root = workspace_root(&state)?;
    let path = resolve_write_path(&root, &relative_path)?;
    Ok(path.is_dir())
}

#[tauri::command]
fn workspace_read_file(state: State<AppState>, relative_path: String) -> Result<String, String> {
    let root = workspace_root(&state)?;
    let path = resolve_in_workspace(&root, &relative_path)?;
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn workspace_read_file_base64(
    state: State<AppState>,
    relative_path: String,
) -> Result<String, String> {
    let root = workspace_root(&state)?;
    let path = resolve_in_workspace(&root, &relative_path)?;
    let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
    Ok(BASE64.encode(bytes))
}

#[tauri::command]
fn workspace_write_file(
    state: State<AppState>,
    relative_path: String,
    content: String,
) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let path = resolve_write_path(&root, &relative_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn workspace_write_file_base64(
    state: State<AppState>,
    relative_path: String,
    content_base64: String,
) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let path = resolve_write_path(&root, &relative_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes = BASE64
        .decode(content_base64.trim())
        .map_err(|e| format!("invalid base64: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| e.to_string())
}

#[tauri::command]
fn workspace_file_mtime(state: State<AppState>, relative_path: String) -> Result<u64, String> {
    let root = workspace_root(&state)?;
    let path = resolve_in_workspace(&root, &relative_path)?;
    Ok(file_modified_ms(&path))
}

#[tauri::command]
fn workspace_ensure_parent_dirs(
    state: State<AppState>,
    relative_path: String,
) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let path = resolve_write_path(&root, &relative_path)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn workspace_create_dir(state: State<AppState>, relative_path: String) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let path = resolve_write_path(&root, &relative_path)?;
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn workspace_delete_file(state: State<AppState>, relative_path: String) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let path = resolve_in_workspace(&root, &relative_path)?;
    if path.is_dir() {
        return Err("not a file".into());
    }
    std::fs::remove_file(&path).map_err(|e| e.to_string())
}

#[tauri::command]
fn workspace_remove_dir(state: State<AppState>, relative_path: String) -> Result<(), String> {
    let root = workspace_root(&state)?;
    let path = resolve_in_workspace(&root, &relative_path)?;
    if !path.is_dir() {
        return Err("not a directory".into());
    }
    std::fs::remove_dir_all(&path).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_test_directory(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "workspace-startup-{label}-{}-{nonce}",
            std::process::id()
        ))
    }

    #[test]
    fn relative_path_rejects_empty_and_parent_components() {
        assert!(checked_relative_path("").is_err());
        assert!(checked_relative_path("/").is_err());
        assert!(checked_relative_path("notes/../secret.md").is_err());
    }

    #[test]
    fn relative_path_accepts_app_style_leading_slash() {
        assert_eq!(
            checked_relative_path("/notes/file.md").unwrap(),
            PathBuf::from("notes").join("file.md")
        );
    }

    #[test]
    fn workspace_target_must_be_a_descendant_for_destructive_operations() {
        let root = PathBuf::from("workspace");
        assert!(ensure_workspace_target(&root, &root.join("notes"), false).is_ok());
        assert!(ensure_workspace_target(&root, &root, false).is_err());
        assert!(ensure_workspace_target(&root, Path::new("workspace-sibling"), false).is_err());
    }

    #[test]
    fn workspace_bind_accepts_an_existing_directory_and_stores_its_canonical_path() {
        let workspace_path = Mutex::new(None);
        let candidate = Path::new(env!("CARGO_MANIFEST_DIR"));
        let expected = candidate.canonicalize().unwrap();

        let display_path = bind_workspace_root(&workspace_path, candidate).unwrap();

        assert_eq!(PathBuf::from(display_path), expected);
        assert_eq!(*workspace_path.lock().unwrap(), Some(expected));
    }

    #[test]
    fn workspace_bind_rejects_a_file_without_replacing_the_current_workspace() {
        let original = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let workspace_path = Mutex::new(Some(original.clone()));
        let candidate = original.join("Cargo.toml");

        assert!(bind_workspace_root(&workspace_path, &candidate).is_err());
        assert_eq!(*workspace_path.lock().unwrap(), Some(original));
    }

    #[test]
    fn workspace_startup_settings_round_trip_through_json_file() {
        let directory = unique_test_directory("round-trip");
        let path = directory.join(WORKSPACE_STARTUP_SETTINGS_FILE);
        let settings = WorkspaceStartupSettings {
            schema_version: 1,
            default_path: Some(
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .canonicalize()
                    .unwrap()
                    .to_string_lossy()
                    .into_owned(),
            ),
            open_on_startup: true,
        };

        save_workspace_startup_settings(&path, &settings).unwrap();

        assert_eq!(load_workspace_startup_settings(&path).unwrap(), settings);
        std::fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn disabled_startup_setting_does_not_bind_the_default_workspace() {
        let workspace_path = Mutex::new(None);
        let settings = WorkspaceStartupSettings {
            default_path: Some(env!("CARGO_MANIFEST_DIR").to_string()),
            ..WorkspaceStartupSettings::default()
        };

        assert_eq!(
            bind_configured_startup_workspace(&workspace_path, &settings).unwrap(),
            None
        );
        assert_eq!(*workspace_path.lock().unwrap(), None);
    }

    #[test]
    fn enabled_startup_setting_binds_the_existing_default_workspace() {
        let workspace_path = Mutex::new(None);
        let expected = Path::new(env!("CARGO_MANIFEST_DIR"))
            .canonicalize()
            .unwrap();
        let settings = WorkspaceStartupSettings {
            default_path: Some(expected.to_string_lossy().into_owned()),
            open_on_startup: true,
            ..WorkspaceStartupSettings::default()
        };

        let bound = bind_configured_startup_workspace(&workspace_path, &settings)
            .unwrap()
            .unwrap();

        assert_eq!(PathBuf::from(bound), expected);
        assert_eq!(*workspace_path.lock().unwrap(), Some(expected));
    }

    #[test]
    fn missing_default_workspace_does_not_replace_the_current_workspace() {
        let original = Path::new(env!("CARGO_MANIFEST_DIR"))
            .canonicalize()
            .unwrap();
        let workspace_path = Mutex::new(Some(original.clone()));
        let missing = unique_test_directory("missing");
        let settings = WorkspaceStartupSettings {
            default_path: Some(missing.to_string_lossy().into_owned()),
            open_on_startup: true,
            ..WorkspaceStartupSettings::default()
        };

        assert!(bind_configured_startup_workspace(&workspace_path, &settings).is_err());
        assert_eq!(*workspace_path.lock().unwrap(), Some(original));
    }
}

/// `--folder "D:\notes"` or `-Folder "D:\notes"` (matches launch.ps1 / start-tauri.bat).
fn workspace_from_cli() -> Option<PathBuf> {
    let args: Vec<String> = std::env::args().collect();
    let mut i = 0;
    while i < args.len() {
        let arg = args[i].as_str();
        if arg == "--folder" || arg == "-Folder" || arg == "--Folder" {
            if let Some(path_str) = args.get(i + 1) {
                let path = PathBuf::from(path_str);
                if path.is_dir() {
                    return Some(path);
                }
            }
            return None;
        }
        i += 1;
    }
    None
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let workspace_path = workspace_from_cli()
        .or_else(|| app_environment_value("WORKSPACE").map(PathBuf::from))
        .filter(|p| p.is_dir());

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(AppState {
            workspace_path: Mutex::new(workspace_path),
        })
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_updater::Builder::new().build())?;
                app.handle().plugin(tauri_plugin_dialog::init())?;
                app.handle().plugin(tauri_plugin_process::init())?;
                updater::schedule_startup_check(app.handle());

                let state = app.state::<AppState>();
                let already_bound = state
                    .workspace_path
                    .lock()
                    .map(|workspace| workspace.is_some())
                    .unwrap_or(true);
                if !already_bound {
                    let startup_result = workspace_startup_settings_path(app.handle())
                        .and_then(|path| load_workspace_startup_settings(&path))
                        .and_then(|settings| {
                            bind_configured_startup_workspace(&state.workspace_path, &settings)
                        });
                    if let Err(error) = startup_result {
                        eprintln!("Default workspace not opened: {error}");
                    }
                }
            }
            tray::setup_tray(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| tray::on_window_event(window, event))
        .invoke_handler(tauri::generate_handler![
            workspace_get_path,
            workspace_pick_and_bind,
            workspace_get_startup_settings,
            workspace_choose_default,
            workspace_set_open_on_startup,
            workspace_clear_default,
            workspace_list_files,
            workspace_exists,
            workspace_is_dir,
            workspace_read_file,
            workspace_read_file_base64,
            workspace_write_file,
            workspace_write_file_base64,
            workspace_file_mtime,
            workspace_ensure_parent_dirs,
            workspace_create_dir,
            workspace_delete_file,
            workspace_remove_dir,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
