use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const RECOVERY_SCHEMA_VERSION: u32 = 1;
const RECOVERY_DIRECTORY: &str = "document-recovery-v1";
const DEFAULT_WORKSPACE_QUOTA_BYTES: u64 = 256 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct RecoveryRecord {
    schema_version: u32,
    path: String,
    path_key: String,
    saved_revision: String,
    buffer: String,
    buffer_version: u64,
    captured_at: u64,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct RecoveryRemoveRequest {
    pub(crate) path_key: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RecoveryEnvelope {
    schema_version: u32,
    checksum: String,
    record: RecoveryRecord,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum RecoveryGeneration {
    Current,
    Previous,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LoadedRecoveryRecord {
    record: RecoveryRecord,
    generation: RecoveryGeneration,
    #[serde(skip_serializing_if = "Option::is_none")]
    diagnostic: Option<String>,
}

#[derive(Debug)]
pub(crate) struct RecoveryStore {
    directory: PathBuf,
    quota_bytes: u64,
}

impl RecoveryStore {
    pub(crate) fn open(app_data: &Path, workspace_root: &Path) -> Result<Self, String> {
        Self::open_with_quota(app_data, workspace_root, DEFAULT_WORKSPACE_QUOTA_BYTES)
    }

    fn open_with_quota(
        app_data: &Path,
        workspace_root: &Path,
        quota_bytes: u64,
    ) -> Result<Self, String> {
        let recovery_root = app_data.join(RECOVERY_DIRECTORY);
        ensure_private_directory(&recovery_root)?;
        let canonical_workspace = workspace_root
            .canonicalize()
            .map_err(|error| format!("workspace identity unavailable: {error}"))?;
        let directory = recovery_root.join(workspace_identity(&canonical_workspace));
        ensure_private_directory(&directory)?;
        Ok(Self {
            directory,
            quota_bytes,
        })
    }

    pub(crate) fn write(&self, record: RecoveryRecord) -> Result<(), String> {
        validate_record(&record)?;
        let session_id = session_identity(&record.path_key);
        let current_path = self.current_path(&session_id);
        let previous_path = self.previous_path(&session_id);
        let old_current = read_optional_bytes(&current_path)?;
        let old_current_valid = old_current
            .as_deref()
            .is_some_and(|bytes| decode_envelope(bytes).is_ok());
        let old_previous_len = file_len(&previous_path)?;
        let current_len = old_current.as_ref().map_or(0, |bytes| bytes.len() as u64);
        let new_current = encode_envelope(record)?;
        let planned_previous_len = if old_current_valid {
            current_len
        } else {
            old_previous_len
        };
        let existing_total = self.total_bytes()?;
        let projected_total = existing_total
            .saturating_sub(current_len)
            .saturating_sub(old_previous_len)
            .saturating_add(new_current.len() as u64)
            .saturating_add(planned_previous_len);
        if self.quota_bytes < projected_total {
            return Err(format!(
                "Recovery quota exceeded: {projected_total} bytes would exceed the {} byte workspace limit",
                self.quota_bytes
            ));
        }

        if old_current_valid {
            write_private(
                &previous_path,
                old_current.as_deref().expect("validated current exists"),
            )?;
        }
        write_private(&current_path, &new_current)
    }

    pub(crate) fn remove(&self, path_key: &str) -> Result<(), String> {
        validate_token(path_key, "recovery path key")?;
        let session_id = session_identity(path_key);
        remove_if_present(&self.current_path(&session_id))?;
        remove_if_present(&self.previous_path(&session_id))?;
        sync_directory(&self.directory)
    }

    pub(crate) fn load_all(&self) -> Result<Vec<LoadedRecoveryRecord>, String> {
        let mut sessions = BTreeSet::new();
        for entry in fs::read_dir(&self.directory)
            .map_err(|error| format!("unable to enumerate recovery records: {error}"))?
        {
            let entry =
                entry.map_err(|error| format!("unable to inspect recovery record: {error}"))?;
            let metadata = fs::symlink_metadata(entry.path())
                .map_err(|error| format!("unable to inspect recovery metadata: {error}"))?;
            if metadata.file_type().is_symlink() {
                return Err("Recovery directory contains an unexpected symbolic link".to_string());
            }
            if !metadata.is_file() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if let Some(session) = name
                .strip_suffix(".current.json")
                .or_else(|| name.strip_suffix(".previous.json"))
            {
                if is_session_id(session) {
                    sessions.insert(session.to_string());
                }
            }
        }

        let mut records = Vec::new();
        for session in sessions {
            let current = load_generation(&self.current_path(&session));
            match current {
                Ok(Some(record)) => records.push(LoadedRecoveryRecord {
                    record,
                    generation: RecoveryGeneration::Current,
                    diagnostic: None,
                }),
                Ok(None) => {
                    if let Some(record) = load_generation(&self.previous_path(&session))? {
                        records.push(LoadedRecoveryRecord {
                            record,
                            generation: RecoveryGeneration::Previous,
                            diagnostic: Some(
                                "Current recovery generation is missing; using previous"
                                    .to_string(),
                            ),
                        });
                    }
                }
                Err(current_error) => {
                    if let Some(record) = load_generation(&self.previous_path(&session))? {
                        records.push(LoadedRecoveryRecord {
                            record,
                            generation: RecoveryGeneration::Previous,
                            diagnostic: Some(format!(
                                "Current recovery generation is invalid; using previous: {current_error}"
                            )),
                        });
                    } else {
                        return Err(format!(
                            "Both recovery generations are unavailable: {current_error}"
                        ));
                    }
                }
            }
        }
        records.sort_by_key(|loaded| loaded.record.captured_at);
        Ok(records)
    }

    fn current_path(&self, session_id: &str) -> PathBuf {
        self.directory.join(format!("{session_id}.current.json"))
    }

    fn previous_path(&self, session_id: &str) -> PathBuf {
        self.directory.join(format!("{session_id}.previous.json"))
    }

    fn total_bytes(&self) -> Result<u64, String> {
        let mut total = 0_u64;
        for entry in fs::read_dir(&self.directory)
            .map_err(|error| format!("unable to inspect recovery quota: {error}"))?
        {
            let entry =
                entry.map_err(|error| format!("unable to inspect recovery quota: {error}"))?;
            let metadata = fs::symlink_metadata(entry.path())
                .map_err(|error| format!("unable to inspect recovery quota: {error}"))?;
            if metadata.file_type().is_symlink() {
                return Err("Recovery directory contains an unexpected symbolic link".to_string());
            }
            if metadata.is_file() {
                total = total.saturating_add(metadata.len());
            }
        }
        Ok(total)
    }
}

fn validate_record(record: &RecoveryRecord) -> Result<(), String> {
    if RECOVERY_SCHEMA_VERSION != record.schema_version {
        return Err(format!(
            "Unsupported recovery schema version: {}",
            record.schema_version
        ));
    }
    super::workspace_document::validate_workspace_path(&record.path)?;
    validate_token(&record.path_key, "recovery path key")?;
    validate_token(&record.saved_revision, "recovery saved revision")?;
    if record.buffer_version > 9_007_199_254_740_991 || record.captured_at > 9_007_199_254_740_991 {
        return Err("Recovery numeric values exceed JavaScript's safe integer range".to_string());
    }
    Ok(())
}

fn validate_token(value: &str, label: &str) -> Result<(), String> {
    if value.is_empty() || 1_024 < value.len() || value.contains('\0') {
        return Err(format!("Invalid {label}"));
    }
    Ok(())
}

fn encode_envelope(record: RecoveryRecord) -> Result<Vec<u8>, String> {
    let record_bytes = serde_json::to_vec(&record)
        .map_err(|error| format!("unable to encode recovery record: {error}"))?;
    let envelope = RecoveryEnvelope {
        schema_version: RECOVERY_SCHEMA_VERSION,
        checksum: sha256_token(&record_bytes),
        record,
    };
    let mut bytes = serde_json::to_vec(&envelope)
        .map_err(|error| format!("unable to encode recovery envelope: {error}"))?;
    bytes.push(b'\n');
    Ok(bytes)
}

fn decode_envelope(bytes: &[u8]) -> Result<RecoveryRecord, String> {
    let envelope: RecoveryEnvelope =
        serde_json::from_slice(bytes).map_err(|error| format!("invalid recovery JSON: {error}"))?;
    if RECOVERY_SCHEMA_VERSION != envelope.schema_version
        || RECOVERY_SCHEMA_VERSION != envelope.record.schema_version
    {
        return Err("unsupported recovery schema".to_string());
    }
    let record_bytes = serde_json::to_vec(&envelope.record)
        .map_err(|error| format!("unable to verify recovery record: {error}"))?;
    if envelope.checksum != sha256_token(&record_bytes) {
        return Err("recovery checksum mismatch".to_string());
    }
    validate_record(&envelope.record)?;
    Ok(envelope.record)
}

fn load_generation(path: &Path) -> Result<Option<RecoveryRecord>, String> {
    read_regular_optional(path, "recovery generation")?
        .map(|bytes| decode_envelope(&bytes))
        .transpose()
}

fn read_optional_bytes(path: &Path) -> Result<Option<Vec<u8>>, String> {
    read_regular_optional(path, "current recovery generation")
}

fn read_regular_optional(path: &Path, label: &str) -> Result<Option<Vec<u8>>, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_file() => {
            Err(format!("{label} must be a regular file"))
        }
        Ok(_) => fs::read(path)
            .map(Some)
            .map_err(|error| format!("unable to read {label}: {error}")),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(format!("unable to inspect {label}: {error}")),
    }
}

fn file_len(path: &Path) -> Result<u64, String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            Err("Recovery generation must not be a symbolic link".to_string())
        }
        Ok(metadata) if metadata.is_file() => Ok(metadata.len()),
        Ok(_) => Err("Recovery generation must be a regular file".to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(0),
        Err(error) => Err(format!("unable to inspect recovery generation: {error}")),
    }
}

fn remove_if_present(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("unable to remove recovery generation: {error}")),
    }
}

fn write_private(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let prepared = super::atomic_replace::prepare_private(path, bytes)
        .map_err(atomic_replace_error_message)?;
    prepared.commit().map_err(atomic_replace_error_message)
}

fn atomic_replace_error_message(error: super::atomic_replace::AtomicReplaceError) -> String {
    match error {
        super::atomic_replace::AtomicReplaceError::Metadata(message) => message,
        super::atomic_replace::AtomicReplaceError::BeforeCommit(error) => {
            format!("recovery write failed before commit: {error}")
        }
        super::atomic_replace::AtomicReplaceError::AfterCommit(error) => {
            format!("recovery committed but directory sync failed: {error}")
        }
    }
}

fn ensure_private_directory(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() || !metadata.is_dir() => {
            return Err("Recovery storage path must be a real directory".to_string());
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            fs::create_dir_all(path)
                .map_err(|error| format!("unable to create recovery directory: {error}"))?;
        }
        Err(error) => return Err(format!("unable to inspect recovery directory: {error}")),
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))
            .map_err(|error| format!("unable to secure recovery directory: {error}"))?;
    }
    Ok(())
}

#[cfg(unix)]
fn canonical_path_bytes(path: &Path) -> Vec<u8> {
    use std::os::unix::ffi::OsStrExt;
    path.as_os_str().as_bytes().to_vec()
}

#[cfg(windows)]
fn canonical_path_bytes(path: &Path) -> Vec<u8> {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str()
        .encode_wide()
        .flat_map(u16::to_le_bytes)
        .collect()
}

#[cfg(not(any(unix, windows)))]
fn canonical_path_bytes(path: &Path) -> Vec<u8> {
    path.to_string_lossy().into_owned().into_bytes()
}

fn workspace_identity(path: &Path) -> String {
    format!("workspace-{}", sha256_hex(&canonical_path_bytes(path)))
}

fn session_identity(path_key: &str) -> String {
    sha256_hex(path_key.as_bytes())
}

fn is_session_id(value: &str) -> bool {
    64 == value.len() && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn sha256_token(bytes: &[u8]) -> String {
    format!("sha256:{}", sha256_hex(bytes))
}

#[cfg(unix)]
fn sync_directory(path: &Path) -> Result<(), String> {
    fs::File::open(path)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| format!("unable to sync recovery directory: {error}"))
}

#[cfg(not(unix))]
fn sync_directory(_path: &Path) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        root: PathBuf,
        workspace: PathBuf,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "workspace-recovery-{label}-{}-{nonce}",
                std::process::id()
            ));
            let workspace = root.join("workspace");
            fs::create_dir_all(&workspace).unwrap();
            Self { root, workspace }
        }

        fn app_data(&self) -> PathBuf {
            self.root.join("app-data")
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }

    fn record(buffer: &str, buffer_version: u64, captured_at: u64) -> RecoveryRecord {
        RecoveryRecord {
            schema_version: 1,
            path: "notes/example.md".to_string(),
            path_key: "workspace-path-sha256:fixture".to_string(),
            saved_revision: "sha256:saved".to_string(),
            buffer: buffer.to_string(),
            buffer_version,
            captured_at,
        }
    }

    #[test]
    fn current_and_previous_generations_round_trip_with_checksums() {
        let fixture = Fixture::new("generations");
        let store = RecoveryStore::open(&fixture.app_data(), &fixture.workspace).unwrap();

        store.write(record("first", 1, 10)).unwrap();
        store.write(record("second", 2, 20)).unwrap();

        let loaded = store.load_all().unwrap();
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].record.buffer, "second");
        assert_eq!(loaded[0].generation, RecoveryGeneration::Current);
        let session = session_identity("workspace-path-sha256:fixture");
        let previous = load_generation(&store.previous_path(&session))
            .unwrap()
            .unwrap();
        assert_eq!(previous.buffer, "first");
    }

    #[test]
    fn corrupted_current_generation_falls_back_to_previous() {
        let fixture = Fixture::new("fallback");
        let store = RecoveryStore::open(&fixture.app_data(), &fixture.workspace).unwrap();
        store.write(record("first", 1, 10)).unwrap();
        store.write(record("second", 2, 20)).unwrap();
        let session = session_identity("workspace-path-sha256:fixture");
        fs::write(store.current_path(&session), b"{corrupt\n").unwrap();

        let loaded = store.load_all().unwrap();

        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].record.buffer, "first");
        assert_eq!(loaded[0].generation, RecoveryGeneration::Previous);
        assert!(loaded[0].diagnostic.is_some());
    }

    #[test]
    fn quota_failure_keeps_existing_generations_unchanged() {
        let fixture = Fixture::new("quota");
        let store =
            RecoveryStore::open_with_quota(&fixture.app_data(), &fixture.workspace, 1).unwrap();

        let result = store.write(record("buffer", 1, 10));

        assert!(result.unwrap_err().contains("quota"));
        assert!(store.load_all().unwrap().is_empty());
    }

    #[test]
    fn remove_deletes_both_generations() {
        let fixture = Fixture::new("remove");
        let store = RecoveryStore::open(&fixture.app_data(), &fixture.workspace).unwrap();
        store.write(record("first", 1, 10)).unwrap();
        store.write(record("second", 2, 20)).unwrap();

        store.remove("workspace-path-sha256:fixture").unwrap();

        assert!(store.load_all().unwrap().is_empty());
    }

    #[test]
    #[cfg(unix)]
    fn recovery_directory_and_files_are_private() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = Fixture::new("permissions");
        let store = RecoveryStore::open(&fixture.app_data(), &fixture.workspace).unwrap();
        store.write(record("buffer", 1, 10)).unwrap();
        let session = session_identity("workspace-path-sha256:fixture");

        assert_eq!(
            fs::metadata(&store.directory).unwrap().permissions().mode() & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(store.current_path(&session))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o600
        );
    }
}
