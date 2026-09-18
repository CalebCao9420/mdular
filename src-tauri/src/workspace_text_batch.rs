use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

const SCHEMA_VERSION: u32 = 1;
const MAX_OPERATIONS: usize = 128;
const MAX_FILE_BYTES: usize = 2 * 1024 * 1024;
const MAX_TOTAL_BYTES: usize = 8 * 1024 * 1024;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextBatchOperation {
    path: String,
    content: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextBatchRequest {
    schema_version: u32,
    operations: Vec<TextBatchOperation>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextBatchReceipt {
    path: String,
    revision: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct TextBatchRollbackRequest {
    schema_version: u32,
    receipts: Vec<TextBatchReceipt>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextBatchFailure {
    index: usize,
    path: String,
    kind: String,
    message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum TextBatchApplyResult {
    Complete {
        created: Vec<TextBatchReceipt>,
    },
    Partial {
        created: Vec<TextBatchReceipt>,
        failed: TextBatchFailure,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextBatchRollbackFailure {
    path: String,
    kind: String,
    message: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TextBatchRollbackResult {
    removed: Vec<String>,
    retained: Vec<TextBatchRollbackFailure>,
}

fn allowed_text_path(path: &str) -> bool {
    let extension = Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    matches!(extension.as_str(), "md" | "json" | "txt" | "yaml" | "yml")
}

fn revision(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn failure(index: usize, path: &str, kind: &str, message: impl Into<String>) -> TextBatchFailure {
    TextBatchFailure {
        index,
        path: path.to_string(),
        kind: kind.to_string(),
        message: message.into(),
    }
}

fn validate_request(request: &TextBatchRequest) -> Result<(), TextBatchFailure> {
    if request.schema_version != SCHEMA_VERSION {
        return Err(failure(
            0,
            "",
            "invalid-request",
            "unsupported schema version",
        ));
    }
    if request.operations.is_empty() || request.operations.len() > MAX_OPERATIONS {
        return Err(failure(
            0,
            "",
            "invalid-request",
            "text batch operation count is outside the allowed range",
        ));
    }
    let mut seen = HashSet::new();
    let mut total_bytes = 0usize;
    for (index, operation) in request.operations.iter().enumerate() {
        if let Err(message) = super::checked_relative_path(&operation.path) {
            return Err(failure(index, &operation.path, "invalid-path", message));
        }
        if !allowed_text_path(&operation.path) {
            return Err(failure(
                index,
                &operation.path,
                "invalid-path",
                "text batch path has an unsupported extension",
            ));
        }
        if !seen.insert(operation.path.to_lowercase()) {
            return Err(failure(
                index,
                &operation.path,
                "invalid-request",
                "text batch path is duplicated",
            ));
        }
        let bytes = operation.content.len();
        if bytes > MAX_FILE_BYTES {
            return Err(failure(
                index,
                &operation.path,
                "limit",
                "text batch file exceeds the per-file limit",
            ));
        }
        total_bytes = total_bytes.saturating_add(bytes);
        if total_bytes > MAX_TOTAL_BYTES {
            return Err(failure(
                index,
                &operation.path,
                "limit",
                "text batch exceeds the total content limit",
            ));
        }
    }
    Ok(())
}

fn prepare_parent(root: &Path, path: &str) -> Result<PathBuf, String> {
    let initial = super::resolve_write_path(root, path)?;
    if let Some(parent) = initial.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    // Re-resolve after directory creation so a linked/reparse ancestor fails closed.
    super::resolve_write_path(root, path)
}

fn create_one(
    root: &Path,
    operation: &TextBatchOperation,
) -> Result<TextBatchReceipt, (&'static str, String)> {
    let path =
        prepare_parent(root, &operation.path).map_err(|message| ("invalid-path", message))?;
    let bytes = operation.content.as_bytes();
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| {
            let kind = if error.kind() == std::io::ErrorKind::AlreadyExists {
                "already-exists"
            } else {
                "io-error"
            };
            (kind, error.to_string())
        })?;
    let result = file
        .write_all(bytes)
        .and_then(|()| file.flush())
        .and_then(|()| file.sync_all());
    drop(file);
    if let Err(error) = result {
        let _ = fs::remove_file(&path);
        return Err(("io-error", error.to_string()));
    }
    Ok(TextBatchReceipt {
        path: operation.path.clone(),
        revision: revision(bytes),
    })
}

pub fn apply(root: &Path, request: TextBatchRequest) -> TextBatchApplyResult {
    if let Err(failed) = validate_request(&request) {
        return TextBatchApplyResult::Partial {
            created: Vec::new(),
            failed,
        };
    }
    let mut created = Vec::new();
    for (index, operation) in request.operations.iter().enumerate() {
        match create_one(root, operation) {
            Ok(receipt) => created.push(receipt),
            Err((kind, message)) => {
                return TextBatchApplyResult::Partial {
                    created,
                    failed: failure(index, &operation.path, kind, message),
                };
            }
        }
    }
    TextBatchApplyResult::Complete { created }
}

pub fn rollback(root: &Path, request: TextBatchRollbackRequest) -> TextBatchRollbackResult {
    let mut removed = Vec::new();
    let mut retained = Vec::new();
    if request.schema_version != SCHEMA_VERSION || request.receipts.len() > MAX_OPERATIONS {
        retained.push(TextBatchRollbackFailure {
            path: String::new(),
            kind: "invalid-request".into(),
            message: "rollback request is malformed".into(),
        });
        return TextBatchRollbackResult { removed, retained };
    }
    for receipt in request.receipts {
        if !allowed_text_path(&receipt.path)
            || !receipt.revision.starts_with("sha256:")
            || 71 != receipt.revision.len()
            || !receipt.revision[7..]
                .chars()
                .all(|character| character.is_ascii_hexdigit())
        {
            retained.push(TextBatchRollbackFailure {
                path: receipt.path,
                kind: "invalid-request".into(),
                message: "rollback receipt is malformed".into(),
            });
            continue;
        }
        let candidate = match super::resolve_write_path(root, &receipt.path) {
            Ok(path) => path,
            Err(message) => {
                retained.push(TextBatchRollbackFailure {
                    path: receipt.path,
                    kind: "invalid-path".into(),
                    message,
                });
                continue;
            }
        };
        if !candidate.exists() {
            removed.push(receipt.path);
            continue;
        }
        let path = match super::resolve_in_workspace(root, &receipt.path) {
            Ok(path) => path,
            Err(message) => {
                retained.push(TextBatchRollbackFailure {
                    path: receipt.path,
                    kind: "invalid-path".into(),
                    message,
                });
                continue;
            }
        };
        let bytes = match fs::read(&path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                removed.push(receipt.path);
                continue;
            }
            Err(error) => {
                retained.push(TextBatchRollbackFailure {
                    path: receipt.path,
                    kind: "io-error".into(),
                    message: error.to_string(),
                });
                continue;
            }
        };
        if revision(&bytes) != receipt.revision {
            retained.push(TextBatchRollbackFailure {
                path: receipt.path,
                kind: "changed".into(),
                message: "created file changed after the batch and was retained".into(),
            });
            continue;
        }
        match fs::remove_file(&path) {
            Ok(()) => removed.push(receipt.path),
            Err(error) => retained.push(TextBatchRollbackFailure {
                path: receipt.path,
                kind: "io-error".into(),
                message: error.to_string(),
            }),
        }
    }
    TextBatchRollbackResult { removed, retained }
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
                "workspace-text-batch-{name}-{}-{unique}",
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

    fn operation(path: &str, content: &str) -> TextBatchOperation {
        TextBatchOperation {
            path: path.into(),
            content: content.into(),
        }
    }

    #[test]
    fn batch_stops_at_conflict_and_rolls_back_only_unchanged_creations() {
        let fixture = Fixture::new("partial");
        fs::write(fixture.root.join("existing.md"), "keep").unwrap();
        let result = apply(
            &fixture.root,
            TextBatchRequest {
                schema_version: 1,
                operations: vec![
                    operation("docs/new.md", "new"),
                    operation("existing.md", "replace"),
                    operation("never.md", "never"),
                ],
            },
        );
        let TextBatchApplyResult::Partial { created, failed } = result else {
            panic!("expected partial result");
        };
        assert_eq!(created.len(), 1);
        assert_eq!(failed.path, "existing.md");
        assert_eq!(
            fs::read_to_string(fixture.root.join("existing.md")).unwrap(),
            "keep"
        );
        fs::write(fixture.root.join("docs/new.md"), "user changed").unwrap();
        let rollback = rollback(
            &fixture.root,
            TextBatchRollbackRequest {
                schema_version: 1,
                receipts: created,
            },
        );
        assert!(rollback.removed.is_empty());
        assert_eq!(rollback.retained[0].kind, "changed");
        assert_eq!(
            fs::read_to_string(fixture.root.join("docs/new.md")).unwrap(),
            "user changed"
        );
    }

    #[test]
    fn complete_batch_can_be_rolled_back_idempotently() {
        let fixture = Fixture::new("complete");
        let result = apply(
            &fixture.root,
            TextBatchRequest {
                schema_version: 1,
                operations: vec![
                    operation("docs/a.md", "a"),
                    operation("config/data.json", "{}"),
                ],
            },
        );
        let TextBatchApplyResult::Complete { created } = result else {
            panic!("expected complete result");
        };
        let request = TextBatchRollbackRequest {
            schema_version: 1,
            receipts: created.clone(),
        };
        let first = rollback(&fixture.root, request.clone());
        assert_eq!(first.removed, vec!["docs/a.md", "config/data.json"]);
        assert!(first.retained.is_empty());
        let second = rollback(&fixture.root, request);
        assert_eq!(second.removed, vec!["docs/a.md", "config/data.json"]);
        assert!(second.retained.is_empty());
    }

    #[test]
    fn batch_rejects_traversal_duplicates_binary_extensions_and_limits() {
        let fixture = Fixture::new("invalid");
        for operations in [
            vec![operation("../escape.md", "bad")],
            vec![
                operation("must-not-be-created.md", "safe-looking"),
                operation("../late-escape.md", "bad"),
            ],
            vec![operation("same.md", "a"), operation("same.md", "b")],
            vec![operation("asset.png", "bad")],
            vec![operation("huge.md", &"x".repeat(MAX_FILE_BYTES + 1))],
        ] {
            let result = apply(
                &fixture.root,
                TextBatchRequest {
                    schema_version: 1,
                    operations,
                },
            );
            assert!(
                matches!(result, TextBatchApplyResult::Partial { created, .. } if created.is_empty())
            );
        }
        assert!(!fixture.root.join("escape.md").exists());
        assert!(!fixture.root.join("must-not-be-created.md").exists());
    }
}
