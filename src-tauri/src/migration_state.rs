use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::atomic_replace::{self, AtomicReplaceError};

pub(crate) const MIGRATION_STATE_FILE: &str = "migration-v0.1.0.json";
const MIGRATION_ID: &str = "v0.0.5-to-v0.1.0";
const MAX_VERSIONED_SOURCE_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MigrationInventoryItem {
    id: String,
    location: String,
    disposition: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    schema_version: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    source_present: Option<bool>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct MigrationState {
    schema_version: u32,
    migration: String,
    status: String,
    inventory: Vec<MigrationInventoryItem>,
}

fn item(
    id: &str,
    location: &str,
    disposition: &str,
    schema_version: Option<u32>,
    source_present: Option<bool>,
) -> MigrationInventoryItem {
    MigrationInventoryItem {
        id: id.to_string(),
        location: location.to_string(),
        disposition: disposition.to_string(),
        schema_version,
        source_present,
    }
}

fn validate_versioned_source(path: &Path, label: &str) -> Result<bool, String> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
        Err(error) => return Err(format!("unable to inspect {label}: {error}")),
    };
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err(format!("{label} is not a regular file"));
    }
    if MAX_VERSIONED_SOURCE_BYTES < metadata.len() {
        return Err(format!("{label} exceeds the migration read limit"));
    }
    let source = fs::read(path).map_err(|error| format!("unable to read {label}: {error}"))?;
    let value: serde_json::Value = serde_json::from_slice(&source)
        .map_err(|error| format!("{label} is invalid JSON: {error}"))?;
    if value
        .get("schemaVersion")
        .and_then(serde_json::Value::as_u64)
        != Some(1)
    {
        return Err(format!("{label} has an unsupported schema"));
    }
    Ok(true)
}

fn expected_state(app_config: &Path, app_data: &Path) -> Result<MigrationState, String> {
    let runtime_present = validate_versioned_source(
        &app_config.join("runtime-mode.json"),
        "runtime mode settings",
    )?;
    let workspace_present = validate_versioned_source(
        &app_config.join("workspace-startup.json"),
        "workspace startup settings",
    )?;
    let recovery_present = match fs::symlink_metadata(app_data.join("document-recovery-v1")) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("document recovery root is not a regular directory".to_string());
            }
            true
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => false,
        Err(error) => return Err(format!("unable to inspect document recovery root: {error}")),
    };

    Ok(MigrationState {
        schema_version: 1,
        migration: MIGRATION_ID.to_string(),
        status: "complete".to_string(),
        inventory: vec![
            item(
                "runtime-mode",
                "app-config",
                "retain-versioned",
                Some(1),
                Some(runtime_present),
            ),
            item(
                "workspace-startup",
                "app-config",
                "retain-versioned",
                Some(1),
                Some(workspace_present),
            ),
            item(
                "document-recovery",
                "app-data",
                "v2-private-namespace",
                Some(1),
                Some(recovery_present),
            ),
            item(
                "window-state",
                "app-data",
                "absent-no-migration",
                None,
                Some(false),
            ),
            item(
                "legacy-local-storage",
                "webview-local-storage",
                "frontend-copy-old-keys-retained",
                Some(1),
                None,
            ),
            item(
                "official-plugin-storage",
                "webview-local-storage",
                "v2-private-namespace",
                Some(1),
                None,
            ),
        ],
    })
}

fn validate_existing_state(state: &MigrationState) -> Result<(), String> {
    if 1 != state.schema_version || MIGRATION_ID != state.migration || "complete" != state.status {
        return Err("app-data migration marker is incompatible".to_string());
    }
    let expected_ids = [
        "runtime-mode",
        "workspace-startup",
        "document-recovery",
        "window-state",
        "legacy-local-storage",
        "official-plugin-storage",
    ];
    if state.inventory.len() != expected_ids.len()
        || expected_ids
            .iter()
            .zip(&state.inventory)
            .any(|(expected, actual)| *expected != actual.id)
    {
        return Err("app-data migration inventory is incomplete".to_string());
    }
    Ok(())
}

fn atomic_error(error: AtomicReplaceError) -> String {
    match error {
        AtomicReplaceError::Metadata(message) => message,
        AtomicReplaceError::BeforeCommit(error) => {
            format!("unable to persist app-data migration marker: {error}")
        }
        AtomicReplaceError::AfterCommit(error) => {
            format!("unable to sync app-data migration marker: {error}")
        }
    }
}

fn ensure_private_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => {
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err("app-data root is not a regular directory".to_string());
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path)
                .map_err(|error| format!("unable to create app-data root: {error}"))?;
        }
        Err(error) => return Err(format!("unable to inspect app-data root: {error}")),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("unable to protect app-data root: {error}"))?;
    }
    Ok(())
}

pub(crate) fn migrate_v0_0_5(app_config: &Path, app_data: &Path) -> Result<(), String> {
    ensure_private_directory(app_data)?;
    let marker_path = app_data.join(MIGRATION_STATE_FILE);
    match fs::read(&marker_path) {
        Ok(source) => {
            let state: MigrationState = serde_json::from_slice(&source)
                .map_err(|error| format!("app-data migration marker is invalid: {error}"))?;
            validate_existing_state(&state)
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let state = expected_state(app_config, app_data)?;
            let mut source = serde_json::to_vec_pretty(&state)
                .map_err(|error| format!("unable to encode app-data migration marker: {error}"))?;
            source.push(b'\n');
            atomic_replace::prepare_private(&marker_path, &source)
                .map_err(atomic_error)?
                .commit()
                .map_err(atomic_error)
        }
        Err(error) => Err(format!("unable to read app-data migration marker: {error}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn fixture(name: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "app-migration-{name}-{}-{nonce}",
            std::process::id()
        ));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn migration_is_idempotent_and_preserves_v0_0_5_files_byte_for_byte() {
        let root = fixture("idempotent");
        let app_config = root.join("config");
        let app_data = root.join("data");
        fs::create_dir_all(&app_config).unwrap();
        let runtime = b"{\"schemaVersion\":1,\"mode\":\"v2\"}\n";
        let workspace = b"{\"schemaVersion\":1,\"defaultPath\":null,\"openOnStartup\":false}\n";
        fs::write(app_config.join("runtime-mode.json"), runtime).unwrap();
        fs::write(app_config.join("workspace-startup.json"), workspace).unwrap();

        migrate_v0_0_5(&app_config, &app_data).unwrap();
        let first_marker = fs::read(app_data.join(MIGRATION_STATE_FILE)).unwrap();
        migrate_v0_0_5(&app_config, &app_data).unwrap();

        assert_eq!(
            fs::read(app_config.join("runtime-mode.json")).unwrap(),
            runtime
        );
        assert_eq!(
            fs::read(app_config.join("workspace-startup.json")).unwrap(),
            workspace
        );
        assert_eq!(
            fs::read(app_data.join(MIGRATION_STATE_FILE)).unwrap(),
            first_marker
        );
        let marker: MigrationState = serde_json::from_slice(&first_marker).unwrap();
        assert_eq!(marker.status, "complete");
        assert!(marker.inventory[0].source_present.unwrap());
        assert!(marker.inventory[1].source_present.unwrap());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn invalid_legacy_schema_fails_without_rewriting_the_source() {
        let root = fixture("invalid-source");
        let app_config = root.join("config");
        let app_data = root.join("data");
        fs::create_dir_all(&app_config).unwrap();
        let original = b"{\"mode\":\"v2\"}\n";
        fs::write(app_config.join("runtime-mode.json"), original).unwrap();

        let error = migrate_v0_0_5(&app_config, &app_data).unwrap_err();

        assert!(error.contains("unsupported schema"));
        assert_eq!(
            fs::read(app_config.join("runtime-mode.json")).unwrap(),
            original
        );
        assert!(!app_data.join(MIGRATION_STATE_FILE).exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn existing_invalid_marker_fails_closed_instead_of_being_overwritten() {
        let root = fixture("invalid-marker");
        let app_config = root.join("config");
        let app_data = root.join("data");
        fs::create_dir_all(&app_config).unwrap();
        fs::create_dir_all(&app_data).unwrap();
        let marker_path = app_data.join(MIGRATION_STATE_FILE);
        fs::write(&marker_path, b"{}\n").unwrap();

        assert!(migrate_v0_0_5(&app_config, &app_data).is_err());
        assert_eq!(fs::read(&marker_path).unwrap(), b"{}\n");
        fs::remove_dir_all(root).unwrap();
    }
}
