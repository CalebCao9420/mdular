use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const SCHEMA_VERSION: u32 = 1;
const MAX_FILE_BYTES: usize = 16 * 1024 * 1024;
const MAX_ENCODED_BYTES: usize = MAX_FILE_BYTES.div_ceil(3) * 4;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MediaWriteRequest {
    schema_version: u32,
    path: String,
    mime_type: String,
    content_base64: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MediaReceipt {
    path: String,
    revision: String,
    bytes: usize,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct MediaRollbackRequest {
    schema_version: u32,
    receipt: MediaReceipt,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum MediaWriteResult {
    Written { receipt: MediaReceipt },
    Failed { kind: String, message: String },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum MediaRollbackResult {
    Removed {
        path: String,
    },
    Missing {
        path: String,
    },
    Retained {
        path: String,
        kind: String,
        message: String,
    },
}

fn revision(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn failed(kind: &str, message: impl Into<String>) -> MediaWriteResult {
    MediaWriteResult::Failed {
        kind: kind.into(),
        message: message.into(),
    }
}

fn media_path(path: &str) -> Result<PathBuf, String> {
    let relative = super::checked_relative_path(path)?;
    let components = relative.components().collect::<Vec<_>>();
    if 2 != components.len()
        || !matches!(components[0], Component::Normal(value) if value == "media")
    {
        return Err("media assets must be direct children of media/".into());
    }
    if 1024 < path.len() {
        return Err("media path exceeds the length limit".into());
    }
    Ok(relative)
}

fn mime_allows_extension(mime_type: &str, extension: &str) -> bool {
    match mime_type {
        "audio/mpeg" | "audio/mp3" => "mp3" == extension,
        "audio/ogg" => matches!(extension, "oga" | "ogg"),
        "audio/wav" | "audio/x-wav" => "wav" == extension,
        "audio/webm" => "weba" == extension,
        "image/avif" => "avif" == extension,
        "image/bmp" => "bmp" == extension,
        "image/gif" => "gif" == extension,
        "image/jpeg" => matches!(extension, "jpeg" | "jpg"),
        "image/png" => "png" == extension,
        "image/webp" => "webp" == extension,
        "video/mp4" => "mp4" == extension,
        "video/quicktime" => "mov" == extension,
        "video/webm" => "webm" == extension,
        _ => false,
    }
}

fn validate_path_and_mime(path: &str, mime_type: &str) -> Result<(), String> {
    let relative = media_path(path)?;
    let extension = relative
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !mime_allows_extension(mime_type, &extension) {
        return Err("media MIME type and extension do not match".into());
    }
    Ok(())
}

fn decode_content(value: &str) -> Result<Vec<u8>, String> {
    if value.is_empty() || value.len() > MAX_ENCODED_BYTES || !value.len().is_multiple_of(4) {
        return Err("media payload is empty, malformed, or exceeds the limit".into());
    }
    let decoded = BASE64
        .decode(value)
        .map_err(|_| "media payload is malformed".to_string())?;
    if decoded.is_empty() || decoded.len() > MAX_FILE_BYTES {
        return Err("media payload is empty or exceeds the file limit".into());
    }
    Ok(decoded)
}

fn prepare_path(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let initial = super::resolve_write_path(root, relative_path)?;
    let parent = initial
        .parent()
        .ok_or_else(|| "media path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    // Re-resolve after creation so linked or reparse ancestors fail closed.
    super::resolve_write_path(root, relative_path)
}

fn sync_parent(path: &Path) -> Result<(), String> {
    #[cfg(unix)]
    {
        let parent = path
            .parent()
            .ok_or_else(|| "media path has no parent".to_string())?;
        fs::File::open(parent)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub fn write(root: &Path, request: MediaWriteRequest) -> MediaWriteResult {
    if request.schema_version != SCHEMA_VERSION {
        return failed(
            "invalid-request",
            "unsupported media request schema version",
        );
    }
    if let Err(message) = validate_path_and_mime(&request.path, &request.mime_type) {
        return failed("invalid-request", message);
    }
    let bytes = match decode_content(&request.content_base64) {
        Ok(bytes) => bytes,
        Err(message) => return failed("invalid-request", message),
    };
    let path = match prepare_path(root, &request.path) {
        Ok(path) => path,
        Err(message) => return failed("invalid-path", message),
    };
    let mut file = match OpenOptions::new().write(true).create_new(true).open(&path) {
        Ok(file) => file,
        Err(error) => {
            return failed(
                if error.kind() == std::io::ErrorKind::AlreadyExists {
                    "already-exists"
                } else {
                    "io-error"
                },
                error.to_string(),
            )
        }
    };
    let persisted = file
        .write_all(&bytes)
        .and_then(|()| file.flush())
        .and_then(|()| file.sync_all());
    drop(file);
    if let Err(error) = persisted {
        let _ = fs::remove_file(&path);
        return failed("io-error", error.to_string());
    }
    if let Err(message) = sync_parent(&path) {
        let _ = fs::remove_file(&path);
        return failed("io-error", message);
    }
    MediaWriteResult::Written {
        receipt: MediaReceipt {
            path: request.path,
            revision: revision(&bytes),
            bytes: bytes.len(),
        },
    }
}

fn valid_receipt(receipt: &MediaReceipt) -> bool {
    media_path(&receipt.path).is_ok()
        && receipt.bytes > 0
        && receipt.bytes <= MAX_FILE_BYTES
        && 71 == receipt.revision.len()
        && receipt.revision.starts_with("sha256:")
        && receipt.revision[7..]
            .chars()
            .all(|character| character.is_ascii_hexdigit())
}

fn retained(path: String, kind: &str, message: impl Into<String>) -> MediaRollbackResult {
    MediaRollbackResult::Retained {
        path,
        kind: kind.into(),
        message: message.into(),
    }
}

pub fn rollback(root: &Path, request: MediaRollbackRequest) -> MediaRollbackResult {
    let receipt = request.receipt;
    if request.schema_version != SCHEMA_VERSION || !valid_receipt(&receipt) {
        return retained(
            receipt.path,
            "invalid-request",
            "media rollback receipt is malformed",
        );
    }
    let candidate = match super::resolve_write_path(root, &receipt.path) {
        Ok(path) => path,
        Err(message) => return retained(receipt.path, "invalid-path", message),
    };
    match fs::symlink_metadata(&candidate) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return MediaRollbackResult::Missing { path: receipt.path }
        }
        Err(error) => return retained(receipt.path, "io-error", error.to_string()),
        Ok(metadata) if !metadata.is_file() || super::metadata_is_link_or_reparse(&metadata) => {
            return retained(
                receipt.path,
                "invalid-path",
                "media asset is not a regular file",
            )
        }
        Ok(metadata) if metadata.len() != receipt.bytes as u64 => {
            return retained(
                receipt.path,
                "changed",
                "media asset changed after creation and was retained",
            )
        }
        Ok(_) => {}
    }
    let path = match super::resolve_in_workspace(root, &receipt.path) {
        Ok(path) => path,
        Err(message) => return retained(receipt.path, "invalid-path", message),
    };
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return MediaRollbackResult::Missing { path: receipt.path }
        }
        Err(error) => return retained(receipt.path, "io-error", error.to_string()),
    };
    if bytes.len() != receipt.bytes || revision(&bytes) != receipt.revision {
        return retained(
            receipt.path,
            "changed",
            "media asset changed after creation and was retained",
        );
    }
    match fs::remove_file(&path) {
        Ok(()) => match sync_parent(&path) {
            Ok(()) => MediaRollbackResult::Removed { path: receipt.path },
            Err(message) => retained(receipt.path, "io-error", message),
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            MediaRollbackResult::Missing { path: receipt.path }
        }
        Err(error) => retained(receipt.path, "io-error", error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        root: PathBuf,
    }

    impl Fixture {
        fn new(name: &str) -> Self {
            let unique = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir().join(format!(
                "workspace-media-{name}-{}-{unique}",
                std::process::id()
            ));
            fs::create_dir_all(&root).unwrap();
            Self { root }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.root);
        }
    }

    fn request(path: &str, mime_type: &str, bytes: &[u8]) -> MediaWriteRequest {
        MediaWriteRequest {
            schema_version: 1,
            path: path.into(),
            mime_type: mime_type.into(),
            content_base64: BASE64.encode(bytes),
        }
    }

    #[test]
    fn media_create_and_idempotent_hash_safe_rollback() {
        let fixture = Fixture::new("create");
        let result = write(
            &fixture.root,
            request("media/asset.png", "image/png", b"png"),
        );
        let MediaWriteResult::Written { receipt } = result else {
            panic!("expected media write");
        };
        assert_eq!(
            fs::read(fixture.root.join("media/asset.png")).unwrap(),
            b"png"
        );
        let rollback_request = MediaRollbackRequest {
            schema_version: 1,
            receipt: receipt.clone(),
        };
        assert!(matches!(
            rollback(&fixture.root, rollback_request.clone()),
            MediaRollbackResult::Removed { .. }
        ));
        assert!(matches!(
            rollback(&fixture.root, rollback_request),
            MediaRollbackResult::Missing { .. }
        ));
    }

    #[test]
    fn media_write_is_create_new_and_changed_asset_is_retained() {
        let fixture = Fixture::new("conflict");
        let MediaWriteResult::Written { receipt } = write(
            &fixture.root,
            request("media/asset.mp3", "audio/mpeg", b"original"),
        ) else {
            panic!("expected media write");
        };
        assert!(matches!(
            write(
                &fixture.root,
                request("media/asset.mp3", "audio/mpeg", b"collision")
            ),
            MediaWriteResult::Failed { kind, .. } if "already-exists" == kind
        ));
        fs::write(fixture.root.join("media/asset.mp3"), b"changed").unwrap();
        assert!(matches!(
            rollback(
                &fixture.root,
                MediaRollbackRequest { schema_version: 1, receipt }
            ),
            MediaRollbackResult::Retained { kind, .. } if "changed" == kind
        ));
    }

    #[test]
    fn media_rejects_traversal_nested_paths_mime_mismatch_and_limits() {
        let fixture = Fixture::new("invalid");
        for candidate in [
            request("../escape.png", "image/png", b"x"),
            request("media/nested/asset.png", "image/png", b"x"),
            request("media/asset.png", "video/mp4", b"x"),
            request("asset.png", "image/png", b"x"),
        ] {
            assert!(matches!(
                write(&fixture.root, candidate),
                MediaWriteResult::Failed { kind, .. } if "invalid-request" == kind
            ));
        }
        let oversized = MediaWriteRequest {
            schema_version: 1,
            path: "media/large.png".into(),
            mime_type: "image/png".into(),
            content_base64: "A".repeat(MAX_ENCODED_BYTES + 4),
        };
        assert!(matches!(
            write(&fixture.root, oversized),
            MediaWriteResult::Failed { kind, .. } if "invalid-request" == kind
        ));
        assert!(!fixture.root.join("escape.png").exists());
    }

    #[cfg(unix)]
    #[test]
    fn media_rejects_linked_media_directory() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new("symlink");
        let outside = Fixture::new("outside");
        symlink(&outside.root, fixture.root.join("media")).unwrap();
        assert!(matches!(
            write(
                &fixture.root,
                request("media/escape.png", "image/png", b"x")
            ),
            MediaWriteResult::Failed { kind, .. } if "invalid-path" == kind
        ));
        assert!(!outside.root.join("escape.png").exists());
    }
}
