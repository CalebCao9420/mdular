use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, SystemTime};

use serde::Serialize;
use tauri::{Emitter, Manager};

use super::workspace_document::{document_fingerprint, WorkspaceDocumentFingerprint};

const WATCH_INTERVAL: Duration = Duration::from_millis(750);
const MAX_TRACKED_DOCUMENTS: usize = 128;
const MAX_DOCUMENTS_PER_POLL: usize = 4;
const STALE_TEMP_GRACE: Duration = Duration::from_secs(7 * 24 * 60 * 60);

#[derive(Clone, Debug)]
struct TrackedDocument {
    references: usize,
    fingerprint: Option<WorkspaceDocumentFingerprint>,
}

#[derive(Default)]
pub(crate) struct WorkspaceWatchState {
    tracked: Mutex<HashMap<String, TrackedDocument>>,
    poll_cursor: Mutex<usize>,
    cleaned_root: Mutex<Option<std::path::PathBuf>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
enum WorkspaceChangeKind {
    Created,
    Changed,
    Deleted,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceDocumentChange {
    path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    path_key: Option<String>,
    kind: WorkspaceChangeKind,
}

impl WorkspaceWatchState {
    pub(crate) fn track(&self, root: &Path, path: &str) -> Result<(), String> {
        super::workspace_document::validate_workspace_path(path)?;
        self.cleanup_stale_temps_once(root);
        let mut tracked = self.tracked.lock().map_err(|error| error.to_string())?;
        if let Some(existing) = tracked.get_mut(path) {
            existing.references = existing
                .references
                .checked_add(1)
                .ok_or_else(|| "workspace watch reference count overflow".to_string())?;
            return Ok(());
        }
        if MAX_TRACKED_DOCUMENTS <= tracked.len() {
            return Err("workspace document watch limit reached".into());
        }
        let fingerprint = document_fingerprint(root, path)?;
        tracked.insert(
            path.to_string(),
            TrackedDocument {
                references: 1,
                fingerprint,
            },
        );
        Ok(())
    }

    pub(crate) fn untrack(&self, path: &str) -> Result<(), String> {
        super::workspace_document::validate_workspace_path(path)?;
        let mut tracked = self.tracked.lock().map_err(|error| error.to_string())?;
        let Some(existing) = tracked.get_mut(path) else {
            return Ok(());
        };
        if 1 < existing.references {
            existing.references -= 1;
        } else {
            tracked.remove(path);
        }
        Ok(())
    }

    pub(crate) fn clear(&self) {
        if let Ok(mut tracked) = self.tracked.lock() {
            tracked.clear();
        }
        if let Ok(mut cursor) = self.poll_cursor.lock() {
            *cursor = 0;
        }
        if let Ok(mut cleaned_root) = self.cleaned_root.lock() {
            *cleaned_root = None;
        }
    }

    fn cleanup_stale_temps_once(&self, root: &Path) {
        let Ok(canonical_root) = root.canonicalize() else {
            return;
        };
        let should_clean = self.cleaned_root.lock().ok().is_some_and(|mut cleaned| {
            if cleaned.as_ref() == Some(&canonical_root) {
                return false;
            }
            *cleaned = Some(canonical_root.clone());
            true
        });
        if should_clean {
            let _ = super::atomic_replace::cleanup_stale_workspace_temps(
                &canonical_root,
                SystemTime::now(),
                STALE_TEMP_GRACE,
            );
        }
    }

    fn poll(&self, root: &Path) -> Vec<WorkspaceDocumentChange> {
        let mut snapshots = match self.tracked.lock() {
            Ok(tracked) => tracked
                .iter()
                .map(|(path, entry)| (path.clone(), entry.fingerprint.clone()))
                .collect::<Vec<_>>(),
            Err(_) => return Vec::new(),
        };
        snapshots.sort_unstable_by(|left, right| left.0.cmp(&right.0));
        let snapshot_count = snapshots.len();
        if snapshot_count > MAX_DOCUMENTS_PER_POLL {
            let start = self
                .poll_cursor
                .lock()
                .ok()
                .map(|mut cursor| {
                    let start = *cursor % snapshot_count;
                    *cursor = (start + MAX_DOCUMENTS_PER_POLL) % snapshot_count;
                    start
                })
                .unwrap_or(0);
            snapshots = snapshots
                .into_iter()
                .cycle()
                .skip(start)
                .take(MAX_DOCUMENTS_PER_POLL)
                .collect();
        }
        let mut changes = Vec::new();
        for (path, previous) in snapshots {
            let current = match document_fingerprint(root, &path) {
                Ok(current) => current,
                Err(_) => continue,
            };
            if current == previous {
                continue;
            }
            let change = match (&previous, &current) {
                (None, Some(created)) => WorkspaceDocumentChange {
                    path: path.clone(),
                    path_key: Some(created.path_key.clone()),
                    kind: WorkspaceChangeKind::Created,
                },
                (Some(deleted), None) => WorkspaceDocumentChange {
                    path: path.clone(),
                    path_key: Some(deleted.path_key.clone()),
                    kind: WorkspaceChangeKind::Deleted,
                },
                (Some(_), Some(changed)) => WorkspaceDocumentChange {
                    path: path.clone(),
                    path_key: Some(changed.path_key.clone()),
                    kind: WorkspaceChangeKind::Changed,
                },
                (None, None) => continue,
            };
            let updated = self
                .tracked
                .lock()
                .ok()
                .and_then(|mut tracked| {
                    let entry = tracked.get_mut(&path)?;
                    if entry.fingerprint != previous {
                        return None;
                    }
                    entry.fingerprint = current;
                    Some(())
                })
                .is_some();
            if updated {
                changes.push(change);
            }
        }
        changes
    }
}

pub(crate) fn spawn(app: tauri::AppHandle) {
    thread::spawn(move || loop {
        thread::sleep(WATCH_INTERVAL);
        let root = app
            .state::<super::AppState>()
            .workspace_path
            .lock()
            .ok()
            .and_then(|root| root.clone());
        let Some(root) = root else {
            continue;
        };
        let changes = app.state::<WorkspaceWatchState>().poll(&root);
        for change in changes {
            let _ = app.emit("workspace-document-change", change);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    struct Fixture {
        root: std::path::PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let root = std::env::temp_dir()
                .join(format!("workspace-watch-{}-{nonce}", std::process::id()));
            fs::create_dir_all(root.join("docs")).unwrap();
            Self { root }
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }

    #[test]
    fn watch_emits_changed_deleted_and_created_hints_from_fresh_host_truth() {
        let fixture = Fixture::new();
        let path = "docs/example.md";
        fs::write(fixture.root.join(path), b"first\n").unwrap();
        let state = WorkspaceWatchState::default();
        state.track(&fixture.root, path).unwrap();
        assert!(state.poll(&fixture.root).is_empty());

        fs::write(fixture.root.join(path), b"second\n").unwrap();
        let changed = state.poll(&fixture.root);
        assert_eq!(changed.len(), 1);
        assert_eq!(changed[0].kind, WorkspaceChangeKind::Changed);
        assert!(state.poll(&fixture.root).is_empty());

        fs::remove_file(fixture.root.join(path)).unwrap();
        let deleted = state.poll(&fixture.root);
        assert_eq!(deleted[0].kind, WorkspaceChangeKind::Deleted);
        assert!(deleted[0].path_key.is_some());

        fs::write(fixture.root.join(path), b"third\n").unwrap();
        let created = state.poll(&fixture.root);
        assert_eq!(created[0].kind, WorkspaceChangeKind::Created);
        assert!(created[0].path_key.is_some());
    }

    #[test]
    fn watch_reference_ownership_and_limits_fail_closed() {
        let fixture = Fixture::new();
        let path = "docs/example.md";
        fs::write(fixture.root.join(path), b"first\n").unwrap();
        let state = WorkspaceWatchState::default();
        state.track(&fixture.root, path).unwrap();
        state.track(&fixture.root, path).unwrap();
        state.untrack(path).unwrap();
        fs::write(fixture.root.join(path), b"second\n").unwrap();
        assert_eq!(state.poll(&fixture.root).len(), 1);
        state.untrack(path).unwrap();
        fs::write(fixture.root.join(path), b"third\n").unwrap();
        assert!(state.poll(&fixture.root).is_empty());
        assert!(state.track(&fixture.root, "../outside.md").is_err());
    }

    #[test]
    fn watch_polling_is_bounded_without_starving_tracked_documents() {
        let fixture = Fixture::new();
        let state = WorkspaceWatchState::default();
        let count = MAX_DOCUMENTS_PER_POLL + 2;
        for index in 0..count {
            let path = format!("docs/{index}.md");
            fs::write(fixture.root.join(&path), b"first\n").unwrap();
            state.track(&fixture.root, &path).unwrap();
            fs::write(fixture.root.join(&path), b"second\n").unwrap();
        }

        let first = state.poll(&fixture.root);
        let second = state.poll(&fixture.root);
        assert_eq!(first.len(), MAX_DOCUMENTS_PER_POLL);
        assert_eq!(first.len() + second.len(), count);
        assert!(state.poll(&fixture.root).is_empty());
    }
}
