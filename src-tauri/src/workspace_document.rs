use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const UTF8_BOM: &[u8; 3] = b"\xef\xbb\xbf";
const WATCH_DOCUMENT_MAX_BYTES: u64 = 16 * 1024 * 1024;
const READ_ONLY_ENCODING_MESSAGE: &str =
    "The file is not valid UTF-8. It is read-only until the user explicitly converts it.";

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct WorkspaceDocumentRequest {
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub(crate) struct WorkspaceDocumentWriteRequest {
    path: String,
    path_key: String,
    expected_revision: String,
    content: String,
    format: DocumentTextFormat,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum WorkspaceReadErrorKind {
    NotFound,
    OutsideWorkspace,
    PermissionDenied,
    IoError,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspaceReadError {
    kind: WorkspaceReadErrorKind,
    message: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WorkspaceDocumentFingerprint {
    pub(crate) path_key: String,
    pub(crate) revision: String,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum DocumentBom {
    None,
    Utf8,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum DocumentEol {
    Lf,
    Crlf,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DocumentTextFormat {
    bom: DocumentBom,
    main_eol: DocumentEol,
    trailing_newline: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
enum DocumentReadOnlyReason {
    UnsupportedEncoding,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum DocumentAccess {
    ReadWrite,
    ReadOnly {
        reason: DocumentReadOnlyReason,
        message: String,
    },
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DocumentSnapshot {
    path: String,
    path_key: String,
    content: String,
    revision: String,
    byte_hash: String,
    format: DocumentTextFormat,
    access: DocumentAccess,
    captured_at: u64,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub(crate) enum WorkspaceReadResult {
    Ok { snapshot: DocumentSnapshot },
    Error { error: WorkspaceReadError },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub(crate) enum WorkspaceWriteErrorKind {
    NotFound,
    OutsideWorkspace,
    ReadOnly,
    PermissionDenied,
    MetadataNotPreserved,
    IoError,
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub(crate) enum WorkspaceWriteResult {
    Ok {
        snapshot: DocumentSnapshot,
    },
    Conflict {
        current: DocumentSnapshot,
    },
    Error {
        kind: WorkspaceWriteErrorKind,
        message: String,
    },
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub(crate) enum WorkspaceStat {
    File {
        path: String,
        path_key: String,
        revision: String,
    },
    Directory {
        path: String,
        path_key: String,
    },
    Missing {
        path: String,
    },
}

#[derive(Debug, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub(crate) enum WorkspaceStatResult {
    Ok { stat: WorkspaceStat },
    Error { error: WorkspaceReadError },
}

fn read_error(kind: WorkspaceReadErrorKind, message: impl Into<String>) -> WorkspaceReadError {
    WorkspaceReadError {
        kind,
        message: message.into(),
    }
}

fn io_error(error: std::io::Error, path: &str) -> WorkspaceReadError {
    let kind = match error.kind() {
        std::io::ErrorKind::NotFound => WorkspaceReadErrorKind::NotFound,
        std::io::ErrorKind::PermissionDenied => WorkspaceReadErrorKind::PermissionDenied,
        _ => WorkspaceReadErrorKind::IoError,
    };
    read_error(kind, format!("Unable to access {path}: {error}"))
}

pub(crate) fn root_error(message: impl Into<String>) -> WorkspaceReadError {
    read_error(WorkspaceReadErrorKind::IoError, message)
}

pub(crate) fn write_root_error(message: impl Into<String>) -> WorkspaceWriteResult {
    WorkspaceWriteResult::Error {
        kind: WorkspaceWriteErrorKind::IoError,
        message: message.into(),
    }
}

fn validated_relative_path(path: &str) -> Result<PathBuf, WorkspaceReadError> {
    let invalid = || {
        read_error(
            WorkspaceReadErrorKind::OutsideWorkspace,
            format!("Invalid workspace-relative path: {path}"),
        )
    };

    let bytes = path.as_bytes();
    let windows_absolute =
        3 <= bytes.len() && bytes[0].is_ascii_alphabetic() && b':' == bytes[1] && b'/' == bytes[2];
    if path.is_empty()
        || path.starts_with('/')
        || path.contains('\\')
        || path.contains('\0')
        || windows_absolute
        || path
            .split('/')
            .any(|segment| segment.is_empty() || matches!(segment, "." | ".."))
    {
        return Err(invalid());
    }

    let relative = PathBuf::from(path);
    if relative
        .components()
        .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(invalid());
    }
    Ok(relative)
}

pub(crate) fn validate_workspace_path(path: &str) -> Result<(), String> {
    validated_relative_path(path)
        .map(|_| ())
        .map_err(|error| error.message)
}

fn canonical_root(root: &Path) -> Result<PathBuf, WorkspaceReadError> {
    root.canonicalize()
        .map_err(|error| io_error(error, "the workspace root"))
}

fn reject_link_components(
    root: &Path,
    relative: &Path,
    display_path: &str,
) -> Result<(), WorkspaceReadError> {
    let mut current = root.to_path_buf();
    for component in relative.components() {
        let Component::Normal(segment) = component else {
            return Err(read_error(
                WorkspaceReadErrorKind::OutsideWorkspace,
                format!("Invalid workspace-relative path: {display_path}"),
            ));
        };
        current.push(segment);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if super::metadata_is_link_or_reparse(&metadata) => {
                return Err(read_error(
                    WorkspaceReadErrorKind::OutsideWorkspace,
                    format!("Symbolic links and reparse points are not allowed: {display_path}"),
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(io_error(error, display_path)),
        }
    }
    Ok(())
}

fn ensure_descendant(
    root: &Path,
    target: &Path,
    display_path: &str,
) -> Result<(), WorkspaceReadError> {
    if target == root || !target.starts_with(root) {
        return Err(read_error(
            WorkspaceReadErrorKind::OutsideWorkspace,
            format!("Path escapes the workspace: {display_path}"),
        ));
    }
    Ok(())
}

fn resolve_existing(root: &Path, path: &str) -> Result<(PathBuf, PathBuf), WorkspaceReadError> {
    let relative = validated_relative_path(path)?;
    let canonical_root = canonical_root(root)?;
    reject_link_components(&canonical_root, &relative, path)?;
    let joined = canonical_root.join(relative);
    let canonical_target = joined
        .canonicalize()
        .map_err(|error| io_error(error, path))?;
    ensure_descendant(&canonical_root, &canonical_target, path)?;
    Ok((joined, canonical_target))
}

fn sha256_token(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    format!("sha256:{digest:x}")
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

fn path_key(canonical_path: &Path) -> String {
    format!(
        "workspace-path-sha256:{}",
        sha256_token(&canonical_path_bytes(canonical_path))
            .strip_prefix("sha256:")
            .expect("SHA-256 token has its prefix")
    )
}

fn captured_at_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

fn document_format(text: &str, bom: DocumentBom) -> DocumentTextFormat {
    let bytes = text.as_bytes();
    let mut crlf_count = 0;
    let mut lf_count = 0;
    for (index, byte) in bytes.iter().enumerate() {
        if b'\n' != *byte {
            continue;
        }
        if 0 < index && b'\r' == bytes[index - 1] {
            crlf_count += 1;
        } else {
            lf_count += 1;
        }
    }
    DocumentTextFormat {
        bom,
        main_eol: if 0 < crlf_count && crlf_count > lf_count {
            DocumentEol::Crlf
        } else {
            DocumentEol::Lf
        },
        trailing_newline: text.ends_with(['\n', '\r']),
    }
}

fn normalize_logical_lines(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\r', "\n")
}

fn encode_utf8_document(content: &str, format: &DocumentTextFormat) -> Vec<u8> {
    let logical = normalize_logical_lines(content);
    let encoded = match format.main_eol {
        DocumentEol::Lf => logical,
        DocumentEol::Crlf => logical.replace('\n', "\r\n"),
    };
    let mut bytes = Vec::with_capacity(
        encoded.len()
            + if DocumentBom::Utf8 == format.bom {
                UTF8_BOM.len()
            } else {
                0
            },
    );
    if DocumentBom::Utf8 == format.bom {
        bytes.extend_from_slice(UTF8_BOM);
    }
    bytes.extend_from_slice(encoded.as_bytes());
    bytes
}

fn snapshot_from_bytes(path: String, canonical_path: &Path, bytes: &[u8]) -> DocumentSnapshot {
    let (bom, payload) = if bytes.starts_with(UTF8_BOM) {
        (DocumentBom::Utf8, &bytes[UTF8_BOM.len()..])
    } else {
        (DocumentBom::None, bytes)
    };
    let (decoded, access) = match std::str::from_utf8(payload) {
        Ok(text) => (text.to_owned(), DocumentAccess::ReadWrite),
        Err(_) => (
            String::from_utf8_lossy(payload).into_owned(),
            DocumentAccess::ReadOnly {
                reason: DocumentReadOnlyReason::UnsupportedEncoding,
                message: READ_ONLY_ENCODING_MESSAGE.to_string(),
            },
        ),
    };
    let hash = sha256_token(bytes);
    DocumentSnapshot {
        path,
        path_key: path_key(canonical_path),
        content: normalize_logical_lines(&decoded),
        revision: hash.clone(),
        byte_hash: hash,
        format: document_format(&decoded, bom),
        access,
        captured_at: captured_at_ms(),
    }
}

fn read_snapshot(root: &Path, path: String) -> Result<DocumentSnapshot, WorkspaceReadError> {
    let (_, canonical_path) = resolve_existing(root, &path)?;
    match fs::metadata(&canonical_path) {
        Ok(metadata) if !metadata.is_file() => {
            return Err(read_error(
                WorkspaceReadErrorKind::IoError,
                format!("Workspace path is not a file: {path}"),
            ));
        }
        Ok(_) => {}
        Err(error) => return Err(io_error(error, &path)),
    }
    match fs::read(&canonical_path) {
        Ok(bytes) => Ok(snapshot_from_bytes(path, &canonical_path, &bytes)),
        Err(error) => Err(io_error(error, &path)),
    }
}

pub(crate) fn read_document(root: &Path, request: WorkspaceDocumentRequest) -> WorkspaceReadResult {
    match read_snapshot(root, request.path) {
        Ok(snapshot) => WorkspaceReadResult::Ok { snapshot },
        Err(error) => WorkspaceReadResult::Error { error },
    }
}

pub(crate) fn document_fingerprint(
    root: &Path,
    path: &str,
) -> Result<Option<WorkspaceDocumentFingerprint>, String> {
    let relative = validated_relative_path(path).map_err(|error| error.message)?;
    let canonical_root = canonical_root(root).map_err(|error| error.message)?;
    reject_link_components(&canonical_root, &relative, path).map_err(|error| error.message)?;
    let joined = canonical_root.join(relative);
    let metadata = match fs::symlink_metadata(&joined) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(io_error(error, path).message),
    };
    if super::metadata_is_link_or_reparse(&metadata) || !metadata.is_file() {
        return Err("watched document is not a regular workspace file".into());
    }
    if WATCH_DOCUMENT_MAX_BYTES < metadata.len() {
        return Err("watched document exceeds the 16 MiB polling limit".into());
    }
    let canonical_path = joined
        .canonicalize()
        .map_err(|error| io_error(error, path).message)?;
    ensure_descendant(&canonical_root, &canonical_path, path).map_err(|error| error.message)?;
    let bytes = fs::read(&canonical_path).map_err(|error| io_error(error, path).message)?;
    if WATCH_DOCUMENT_MAX_BYTES < bytes.len() as u64 {
        return Err("watched document changed beyond the 16 MiB polling limit".into());
    }
    Ok(Some(WorkspaceDocumentFingerprint {
        path_key: path_key(&canonical_path),
        revision: sha256_token(&bytes),
    }))
}

fn write_error_from_read(error: WorkspaceReadError) -> WorkspaceWriteResult {
    let kind = match error.kind {
        WorkspaceReadErrorKind::NotFound => WorkspaceWriteErrorKind::NotFound,
        WorkspaceReadErrorKind::OutsideWorkspace => WorkspaceWriteErrorKind::OutsideWorkspace,
        WorkspaceReadErrorKind::PermissionDenied => WorkspaceWriteErrorKind::PermissionDenied,
        WorkspaceReadErrorKind::IoError => WorkspaceWriteErrorKind::IoError,
    };
    WorkspaceWriteResult::Error {
        kind,
        message: error.message,
    }
}

fn write_error_from_io(error: std::io::Error, message: &str) -> WorkspaceWriteResult {
    WorkspaceWriteResult::Error {
        kind: if error.kind() == std::io::ErrorKind::PermissionDenied {
            WorkspaceWriteErrorKind::PermissionDenied
        } else if error.kind() == std::io::ErrorKind::NotFound {
            WorkspaceWriteErrorKind::NotFound
        } else {
            WorkspaceWriteErrorKind::IoError
        },
        message: format!("{message}: {error}"),
    }
}

pub(crate) fn write_document(
    root: &Path,
    request: WorkspaceDocumentWriteRequest,
) -> WorkspaceWriteResult {
    write_document_with_hook(root, request, |_| {})
}

fn write_document_with_hook(
    root: &Path,
    request: WorkspaceDocumentWriteRequest,
    before_revision_check: impl FnOnce(&Path),
) -> WorkspaceWriteResult {
    let initial = match read_snapshot(root, request.path.clone()) {
        Ok(snapshot) => snapshot,
        Err(error) => return write_error_from_read(error),
    };
    if initial.path_key != request.path_key {
        return WorkspaceWriteResult::Error {
            kind: WorkspaceWriteErrorKind::OutsideWorkspace,
            message: "The host path identity does not match the open document".to_string(),
        };
    }
    if initial.revision != request.expected_revision {
        return WorkspaceWriteResult::Conflict { current: initial };
    }
    if let DocumentAccess::ReadOnly { message, .. } = initial.access {
        return WorkspaceWriteResult::Error {
            kind: WorkspaceWriteErrorKind::ReadOnly,
            message,
        };
    }

    let (_, canonical_path) = match resolve_existing(root, &request.path) {
        Ok(paths) => paths,
        Err(error) => return write_error_from_read(error),
    };
    if path_key(&canonical_path) != request.path_key {
        return WorkspaceWriteResult::Error {
            kind: WorkspaceWriteErrorKind::OutsideWorkspace,
            message: "The host path identity changed before save".to_string(),
        };
    }
    let bytes = encode_utf8_document(&request.content, &request.format);
    let intended_revision = sha256_token(&bytes);
    let prepared = match super::atomic_replace::prepare_existing(&canonical_path, &bytes) {
        Ok(prepared) => prepared,
        Err(super::atomic_replace::AtomicReplaceError::Metadata(message)) => {
            return WorkspaceWriteResult::Error {
                kind: WorkspaceWriteErrorKind::MetadataNotPreserved,
                message,
            };
        }
        Err(super::atomic_replace::AtomicReplaceError::BeforeCommit(error)) => {
            return write_error_from_io(error, "Unable to prepare atomic replacement");
        }
        Err(super::atomic_replace::AtomicReplaceError::AfterCommit(_)) => {
            unreachable!("preparing an atomic replacement cannot commit it")
        }
    };

    before_revision_check(&canonical_path);
    let verified = match read_snapshot(root, request.path.clone()) {
        Ok(snapshot) => snapshot,
        Err(error) => return write_error_from_read(error),
    };
    if verified.path_key != request.path_key || verified.revision != request.expected_revision {
        return WorkspaceWriteResult::Conflict { current: verified };
    }

    match prepared.commit() {
        Ok(()) => {}
        Err(super::atomic_replace::AtomicReplaceError::Metadata(message)) => {
            return WorkspaceWriteResult::Error {
                kind: WorkspaceWriteErrorKind::MetadataNotPreserved,
                message,
            };
        }
        Err(super::atomic_replace::AtomicReplaceError::BeforeCommit(error)) => {
            return write_error_from_io(error, "Atomic replacement failed before commit");
        }
        Err(super::atomic_replace::AtomicReplaceError::AfterCommit(error)) => {
            return write_error_from_io(
                error,
                "The replacement committed but its parent directory could not be synchronized",
            );
        }
    }

    match read_snapshot(root, request.path) {
        Ok(snapshot) if snapshot.revision == intended_revision => {
            WorkspaceWriteResult::Ok { snapshot }
        }
        Ok(current) => WorkspaceWriteResult::Conflict { current },
        Err(error) => write_error_from_read(error),
    }
}

pub(crate) fn stat_document(root: &Path, request: WorkspaceDocumentRequest) -> WorkspaceStatResult {
    let path = request.path;
    let relative = match validated_relative_path(&path) {
        Ok(relative) => relative,
        Err(error) => return WorkspaceStatResult::Error { error },
    };
    let canonical_root = match canonical_root(root) {
        Ok(root) => root,
        Err(error) => return WorkspaceStatResult::Error { error },
    };
    if let Err(error) = reject_link_components(&canonical_root, &relative, &path) {
        return WorkspaceStatResult::Error { error };
    }
    let joined = canonical_root.join(relative);
    let metadata = match fs::symlink_metadata(&joined) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return WorkspaceStatResult::Ok {
                stat: WorkspaceStat::Missing { path },
            };
        }
        Err(error) => {
            return WorkspaceStatResult::Error {
                error: io_error(error, &path),
            };
        }
    };
    if super::metadata_is_link_or_reparse(&metadata) {
        return WorkspaceStatResult::Error {
            error: read_error(
                WorkspaceReadErrorKind::OutsideWorkspace,
                format!("Symbolic links and reparse points are not allowed: {path}"),
            ),
        };
    }
    let canonical_path = match joined.canonicalize() {
        Ok(target) => target,
        Err(error) => {
            return WorkspaceStatResult::Error {
                error: io_error(error, &path),
            };
        }
    };
    if let Err(error) = ensure_descendant(&canonical_root, &canonical_path, &path) {
        return WorkspaceStatResult::Error { error };
    }
    let host_key = path_key(&canonical_path);
    let stat = if metadata.is_dir() {
        WorkspaceStat::Directory {
            path,
            path_key: host_key,
        }
    } else if metadata.is_file() {
        match fs::read(&canonical_path) {
            Ok(bytes) => WorkspaceStat::File {
                path,
                path_key: host_key,
                revision: sha256_token(&bytes),
            },
            Err(error) => {
                return WorkspaceStatResult::Error {
                    error: io_error(error, &path),
                };
            }
        }
    } else {
        return WorkspaceStatResult::Error {
            error: read_error(
                WorkspaceReadErrorKind::IoError,
                format!("Workspace path is not a regular file or directory: {path}"),
            ),
        };
    };
    WorkspaceStatResult::Ok { stat }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "workspace-document-{label}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&root).unwrap();
            Self { root }
        }

        fn write(&self, path: &str, bytes: &[u8]) {
            let destination = self.root.join(path);
            fs::create_dir_all(destination.parent().unwrap()).unwrap();
            fs::write(destination, bytes).unwrap();
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }

    fn request(path: &str) -> WorkspaceDocumentRequest {
        WorkspaceDocumentRequest {
            path: path.to_string(),
        }
    }

    fn expect_snapshot(result: WorkspaceReadResult) -> DocumentSnapshot {
        match result {
            WorkspaceReadResult::Ok { snapshot } => snapshot,
            WorkspaceReadResult::Error { error } => panic!("unexpected read error: {error:?}"),
        }
    }

    fn write_request(snapshot: &DocumentSnapshot, content: &str) -> WorkspaceDocumentWriteRequest {
        WorkspaceDocumentWriteRequest {
            path: snapshot.path.clone(),
            path_key: snapshot.path_key.clone(),
            expected_revision: snapshot.revision.clone(),
            content: content.to_string(),
            format: snapshot.format,
        }
    }

    #[test]
    fn sha256_revision_uses_raw_bytes() {
        assert_eq!(
            sha256_token(b"abc"),
            "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn read_preserves_bom_and_crlf_format_while_normalizing_content() {
        let fixture = Fixture::new("bom-crlf");
        fixture.write("notes/example.md", b"\xef\xbb\xbffirst\r\nsecond\r\n");

        let snapshot = expect_snapshot(read_document(&fixture.root, request("notes/example.md")));

        assert_eq!(snapshot.path, "notes/example.md");
        assert_eq!(snapshot.content, "first\nsecond\n");
        assert_eq!(snapshot.format.bom, DocumentBom::Utf8);
        assert_eq!(snapshot.format.main_eol, DocumentEol::Crlf);
        assert!(snapshot.format.trailing_newline);
        assert_eq!(snapshot.access, DocumentAccess::ReadWrite);
        assert_eq!(snapshot.revision, snapshot.byte_hash);
        assert!(snapshot.revision.starts_with("sha256:"));
        assert!(snapshot.path_key.starts_with("workspace-path-sha256:"));
    }

    #[test]
    fn read_handles_empty_and_lf_without_trailing_newline() {
        let fixture = Fixture::new("empty-lf");
        fixture.write("empty.md", b"");
        fixture.write("plain.md", b"first\nsecond");

        let empty = expect_snapshot(read_document(&fixture.root, request("empty.md")));
        assert_eq!(empty.content, "");
        assert_eq!(empty.format.main_eol, DocumentEol::Lf);
        assert!(!empty.format.trailing_newline);

        let plain = expect_snapshot(read_document(&fixture.root, request("plain.md")));
        assert_eq!(plain.content, "first\nsecond");
        assert_eq!(plain.format.main_eol, DocumentEol::Lf);
        assert!(!plain.format.trailing_newline);
    }

    #[test]
    fn invalid_utf8_returns_a_read_only_replacement_preview() {
        let fixture = Fixture::new("invalid-utf8");
        fixture.write("invalid.md", b"prefix\xffsuffix");

        let snapshot = expect_snapshot(read_document(&fixture.root, request("invalid.md")));

        assert_eq!(snapshot.content, "prefix\u{fffd}suffix");
        assert!(matches!(
            snapshot.access,
            DocumentAccess::ReadOnly {
                reason: DocumentReadOnlyReason::UnsupportedEncoding,
                ..
            }
        ));
    }

    #[test]
    fn conditional_write_preserves_bom_and_crlf_and_returns_the_disk_snapshot() {
        let fixture = Fixture::new("write-format");
        fixture.write("notes/example.md", b"\xef\xbb\xbfold\r\n");
        let initial = expect_snapshot(read_document(&fixture.root, request("notes/example.md")));

        let result = write_document(&fixture.root, write_request(&initial, "new\nline\n"));

        let WorkspaceWriteResult::Ok { snapshot } = result else {
            panic!("expected a successful write: {result:?}");
        };
        assert_eq!(
            fs::read(fixture.root.join("notes/example.md")).unwrap(),
            b"\xef\xbb\xbfnew\r\nline\r\n"
        );
        assert_eq!(snapshot.content, "new\nline\n");
        assert_eq!(snapshot.format.bom, DocumentBom::Utf8);
        assert_eq!(snapshot.format.main_eol, DocumentEol::Crlf);
        assert!(snapshot.format.trailing_newline);
        assert_ne!(snapshot.revision, initial.revision);
        assert_eq!(snapshot.path_key, initial.path_key);
    }

    #[test]
    fn stale_revision_returns_a_conflict_without_touching_the_file() {
        let fixture = Fixture::new("write-stale");
        fixture.write("example.md", b"current\n");
        let initial = expect_snapshot(read_document(&fixture.root, request("example.md")));
        let mut stale = write_request(&initial, "local\n");
        stale.expected_revision = "sha256:stale".to_string();

        let result = write_document(&fixture.root, stale);

        assert!(matches!(result, WorkspaceWriteResult::Conflict { .. }));
        assert_eq!(
            fs::read(fixture.root.join("example.md")).unwrap(),
            b"current\n"
        );
    }

    #[test]
    fn change_during_prepare_returns_conflict_and_cleans_the_sibling_temp() {
        let fixture = Fixture::new("write-race");
        fixture.write("example.md", b"initial\n");
        let initial = expect_snapshot(read_document(&fixture.root, request("example.md")));

        let result = write_document_with_hook(
            &fixture.root,
            write_request(&initial, "local\n"),
            |target| fs::write(target, b"external\n").unwrap(),
        );

        let WorkspaceWriteResult::Conflict { current } = result else {
            panic!("expected conflict: {result:?}");
        };
        assert_eq!(current.content, "external\n");
        assert_eq!(
            fs::read(fixture.root.join("example.md")).unwrap(),
            b"external\n"
        );
        let leftovers = fs::read_dir(&fixture.root)
            .unwrap()
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(".workspace-write-")
            })
            .count();
        assert_eq!(leftovers, 0);
    }

    #[test]
    fn invalid_utf8_write_is_rejected_before_a_temp_is_created() {
        let fixture = Fixture::new("write-read-only");
        fixture.write("invalid.md", b"prefix\xffsuffix");
        let initial = expect_snapshot(read_document(&fixture.root, request("invalid.md")));

        let result = write_document(&fixture.root, write_request(&initial, "replacement"));

        assert!(matches!(
            result,
            WorkspaceWriteResult::Error {
                kind: WorkspaceWriteErrorKind::ReadOnly,
                ..
            }
        ));
        assert_eq!(
            fs::read(fixture.root.join("invalid.md")).unwrap(),
            b"prefix\xffsuffix"
        );
    }

    #[test]
    fn stat_reports_file_directory_and_missing_with_host_identity() {
        let fixture = Fixture::new("stat");
        fixture.write("notes/example.md", b"content\n");

        let file = stat_document(&fixture.root, request("notes/example.md"));
        let directory = stat_document(&fixture.root, request("notes"));
        let missing = stat_document(&fixture.root, request("notes/missing.md"));

        assert!(matches!(
            file,
            WorkspaceStatResult::Ok {
                stat: WorkspaceStat::File { .. }
            }
        ));
        assert!(matches!(
            directory,
            WorkspaceStatResult::Ok {
                stat: WorkspaceStat::Directory { .. }
            }
        ));
        assert!(matches!(
            missing,
            WorkspaceStatResult::Ok {
                stat: WorkspaceStat::Missing { .. }
            }
        ));
    }

    #[test]
    fn v2_paths_reject_absolute_backslash_and_traversal_forms() {
        let fixture = Fixture::new("invalid-paths");
        for path in [
            "",
            "/absolute.md",
            "C:/absolute.md",
            "notes\\windows.md",
            "notes//empty.md",
            "notes/../escape.md",
        ] {
            let result = read_document(&fixture.root, request(path));
            assert!(matches!(
                result,
                WorkspaceReadResult::Error {
                    error: WorkspaceReadError {
                        kind: WorkspaceReadErrorKind::OutsideWorkspace,
                        ..
                    }
                }
            ));
        }
    }

    #[test]
    fn wire_shape_matches_the_desktop_adapter_contract() {
        let fixture = Fixture::new("wire-shape");
        fixture.write("example.md", b"content\n");
        let value = serde_json::to_value(read_document(&fixture.root, request("example.md")))
            .expect("read result serializes");

        assert_eq!(value["status"], "ok");
        assert_eq!(value["snapshot"]["path"], "example.md");
        assert_eq!(value["snapshot"]["format"]["mainEol"], "lf");
        assert_eq!(value["snapshot"]["access"]["kind"], "read-write");
        assert!(value["snapshot"]["capturedAt"].is_u64());

        let stat = serde_json::to_value(stat_document(&fixture.root, request("example.md")))
            .expect("stat result serializes");
        assert_eq!(stat["status"], "ok");
        assert_eq!(stat["stat"]["kind"], "file");
        assert_eq!(stat["stat"]["path"], "example.md");
        assert!(stat["stat"]["pathKey"]
            .as_str()
            .unwrap()
            .starts_with("workspace-path-sha256:"));
        assert!(stat["stat"]["revision"]
            .as_str()
            .unwrap()
            .starts_with("sha256:"));

        let current = expect_snapshot(read_document(&fixture.root, request("example.md")));
        let mut stale = write_request(&current, "replacement\n");
        stale.expected_revision = "sha256:stale".to_string();
        let conflict = serde_json::to_value(write_document(&fixture.root, stale))
            .expect("write result serializes");
        assert_eq!(conflict["status"], "conflict");
        assert_eq!(conflict["current"]["pathKey"], current.path_key);
    }
}
