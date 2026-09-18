use std::fs::{self, File, OpenOptions};
use std::io::{self, Seek, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(1);
const TEMP_PREFIX: &str = ".workspace-write-";
const TEMP_SUFFIX: &str = ".tmp";
const MAX_CLEANUP_ENTRIES: usize = 100_000;
const MAX_CLEANUP_DEPTH: usize = 32;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(crate) struct StaleTempCleanupReport {
    pub(crate) detected: usize,
    pub(crate) removed: usize,
    pub(crate) retained: usize,
}

#[derive(Debug)]
pub(crate) enum AtomicReplaceError {
    Metadata(String),
    BeforeCommit(io::Error),
    AfterCommit(io::Error),
}

#[derive(Debug)]
pub(crate) struct PreparedAtomicWrite {
    target: PathBuf,
    temporary_path: PathBuf,
    merge_existing_metadata: bool,
    committed: bool,
}

impl PreparedAtomicWrite {
    pub(crate) fn commit(mut self) -> Result<(), AtomicReplaceError> {
        replace_file(
            &self.temporary_path,
            &self.target,
            self.merge_existing_metadata,
        )
        .map_err(AtomicReplaceError::BeforeCommit)?;
        self.committed = true;
        sync_parent_directory(&self.target).map_err(AtomicReplaceError::AfterCommit)
    }

    #[cfg(test)]
    fn temporary_path(&self) -> &Path {
        &self.temporary_path
    }
}

impl Drop for PreparedAtomicWrite {
    fn drop(&mut self) {
        if !self.committed {
            let _ = fs::remove_file(&self.temporary_path);
        }
    }
}

fn unique_temp_name(attempt: u32) -> String {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let sequence = TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);
    format!(
        ".workspace-write-{}-{timestamp}-{sequence}-{attempt}.tmp",
        std::process::id()
    )
}

fn internal_temp_timestamp(name: &str) -> Option<SystemTime> {
    let body = name.strip_prefix(TEMP_PREFIX)?.strip_suffix(TEMP_SUFFIX)?;
    let mut parts = body.split('-');
    let _process_id = parts.next()?.parse::<u32>().ok()?;
    let timestamp = parts.next()?.parse::<u64>().ok()?;
    let _sequence = parts.next()?.parse::<u64>().ok()?;
    let _attempt = parts.next()?.parse::<u32>().ok()?;
    if parts.next().is_some() {
        return None;
    }
    UNIX_EPOCH.checked_add(std::time::Duration::from_nanos(timestamp))
}

fn is_old_enough(
    timestamp: SystemTime,
    modified: SystemTime,
    now: SystemTime,
    grace: std::time::Duration,
) -> bool {
    now.duration_since(timestamp).is_ok_and(|age| grace <= age)
        && now.duration_since(modified).is_ok_and(|age| grace <= age)
}

pub(crate) fn cleanup_stale_workspace_temps(
    root: &Path,
    now: SystemTime,
    grace: std::time::Duration,
) -> io::Result<StaleTempCleanupReport> {
    fn visit(
        directory: &Path,
        depth: usize,
        visited: &mut usize,
        report: &mut StaleTempCleanupReport,
        now: SystemTime,
        grace: std::time::Duration,
    ) -> io::Result<()> {
        if MAX_CLEANUP_DEPTH < depth {
            return Ok(());
        }
        for entry in fs::read_dir(directory)? {
            if MAX_CLEANUP_ENTRIES <= *visited {
                return Err(io::Error::other("stale temp cleanup entry limit reached"));
            }
            *visited += 1;
            let entry = entry?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path)?;
            if super::metadata_is_link_or_reparse(&metadata) {
                continue;
            }
            if metadata.is_dir() {
                let name = entry.file_name();
                if matches!(name.to_str(), Some(".git" | ".svn")) {
                    continue;
                }
                visit(&path, depth + 1, visited, report, now, grace)?;
                continue;
            }
            let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
                continue;
            };
            let Some(timestamp) = internal_temp_timestamp(&name) else {
                continue;
            };
            report.detected += 1;
            if !metadata.is_file() || !is_old_enough(timestamp, metadata.modified()?, now, grace) {
                report.retained += 1;
                continue;
            }
            match fs::remove_file(&path) {
                Ok(()) => report.removed += 1,
                Err(_) => report.retained += 1,
            }
        }
        Ok(())
    }

    let canonical_root = root.canonicalize()?;
    if !canonical_root.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "stale temp cleanup root is not a directory",
        ));
    }
    let mut report = StaleTempCleanupReport::default();
    let mut visited = 0;
    visit(&canonical_root, 0, &mut visited, &mut report, now, grace)?;
    Ok(report)
}

fn create_sibling_temp(parent: &Path) -> io::Result<(PathBuf, File)> {
    for attempt in 0..64 {
        let path = parent.join(unique_temp_name(attempt));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        match options.open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(io::Error::new(
        io::ErrorKind::AlreadyExists,
        "unable to allocate a unique sibling temporary file",
    ))
}

pub(crate) fn prepare_existing(
    target: &Path,
    contents: &[u8],
) -> Result<PreparedAtomicWrite, AtomicReplaceError> {
    prepare_existing_with(target, contents, |temporary_file, bytes| {
        temporary_file.write_all(bytes)?;
        temporary_file.flush()?;
        temporary_file.sync_all()
    })
}

fn prepare_existing_with(
    target: &Path,
    contents: &[u8],
    persist_contents: impl FnOnce(&mut File, &[u8]) -> io::Result<()>,
) -> Result<PreparedAtomicWrite, AtomicReplaceError> {
    let parent = target.parent().ok_or_else(|| {
        AtomicReplaceError::BeforeCommit(io::Error::new(
            io::ErrorKind::InvalidInput,
            "atomic replacement target has no parent directory",
        ))
    })?;
    let source = File::open(target).map_err(AtomicReplaceError::BeforeCommit)?;
    if !source
        .metadata()
        .map_err(AtomicReplaceError::BeforeCommit)?
        .is_file()
    {
        return Err(AtomicReplaceError::BeforeCommit(io::Error::new(
            io::ErrorKind::InvalidInput,
            "atomic replacement target is not a regular file",
        )));
    }

    let (temporary_path, mut temporary_file) =
        create_sibling_temp(parent).map_err(AtomicReplaceError::BeforeCommit)?;
    let prepared = PreparedAtomicWrite {
        target: target.to_path_buf(),
        temporary_path,
        merge_existing_metadata: true,
        committed: false,
    };

    preserve_metadata(&source, &temporary_file).map_err(|error| {
        AtomicReplaceError::Metadata(format!(
            "unable to preserve target metadata before atomic replacement: {error}"
        ))
    })?;
    temporary_file
        .set_len(0)
        .map_err(AtomicReplaceError::BeforeCommit)?;
    temporary_file
        .rewind()
        .map_err(AtomicReplaceError::BeforeCommit)?;
    persist_contents(&mut temporary_file, contents).map_err(AtomicReplaceError::BeforeCommit)?;
    drop(temporary_file);
    Ok(prepared)
}

pub(crate) fn prepare_private(
    target: &Path,
    contents: &[u8],
) -> Result<PreparedAtomicWrite, AtomicReplaceError> {
    let parent = target.parent().ok_or_else(|| {
        AtomicReplaceError::BeforeCommit(io::Error::new(
            io::ErrorKind::InvalidInput,
            "atomic replacement target has no parent directory",
        ))
    })?;
    if let Ok(metadata) = fs::symlink_metadata(target) {
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(AtomicReplaceError::BeforeCommit(io::Error::new(
                io::ErrorKind::InvalidInput,
                "private atomic replacement target is not a regular file",
            )));
        }
    }
    let merge_existing_metadata = target.is_file();
    let (temporary_path, mut temporary_file) =
        create_sibling_temp(parent).map_err(AtomicReplaceError::BeforeCommit)?;
    let prepared = PreparedAtomicWrite {
        target: target.to_path_buf(),
        temporary_path,
        merge_existing_metadata,
        committed: false,
    };
    temporary_file
        .write_all(contents)
        .map_err(AtomicReplaceError::BeforeCommit)?;
    temporary_file
        .flush()
        .map_err(AtomicReplaceError::BeforeCommit)?;
    temporary_file
        .sync_all()
        .map_err(AtomicReplaceError::BeforeCommit)?;
    drop(temporary_file);
    Ok(prepared)
}

#[cfg(target_os = "macos")]
fn preserve_metadata(source: &File, destination: &File) -> io::Result<()> {
    use std::ffi::{c_int, c_uint, c_void};
    use std::os::fd::AsRawFd;

    const COPYFILE_METADATA: c_uint = (1 << 0) | (1 << 1) | (1 << 2);

    unsafe extern "C" {
        fn fcopyfile(from: c_int, to: c_int, state: *mut c_void, flags: c_uint) -> c_int;
    }

    // SAFETY: both descriptors remain valid for the duration of the call, the state pointer is
    // null as required by copyfile(3), and COPYFILE_METADATA requests no data copy.
    let result = unsafe {
        fcopyfile(
            source.as_raw_fd(),
            destination.as_raw_fd(),
            std::ptr::null_mut(),
            COPYFILE_METADATA,
        )
    };
    if 0 == result {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(target_os = "linux")]
fn preserve_metadata(source: &File, destination: &File) -> io::Result<()> {
    use std::ffi::{c_char, c_int, c_void, CString};
    use std::os::fd::AsRawFd;
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    unsafe extern "C" {
        fn fchown(fd: c_int, owner: u32, group: u32) -> c_int;
        fn flistxattr(fd: c_int, list: *mut c_char, size: usize) -> isize;
        fn fgetxattr(fd: c_int, name: *const c_char, value: *mut c_void, size: usize) -> isize;
        fn fsetxattr(
            fd: c_int,
            name: *const c_char,
            value: *const c_void,
            size: usize,
            flags: c_int,
        ) -> c_int;
    }

    fn list_names(fd: c_int) -> io::Result<Vec<CString>> {
        for _ in 0..4 {
            // SAFETY: a null list with size zero requests the required buffer length.
            let length = unsafe { flistxattr(fd, std::ptr::null_mut(), 0) };
            if length < 0 {
                return Err(io::Error::last_os_error());
            }
            if 0 == length {
                return Ok(Vec::new());
            }
            let mut buffer = vec![0_u8; length as usize];
            // SAFETY: the buffer is writable for exactly the supplied number of bytes.
            let written =
                unsafe { flistxattr(fd, buffer.as_mut_ptr().cast::<c_char>(), buffer.len()) };
            if written < 0 {
                if io::Error::last_os_error().raw_os_error() == Some(34) {
                    continue;
                }
                return Err(io::Error::last_os_error());
            }
            buffer.truncate(written as usize);
            return buffer
                .split(|byte| 0 == *byte)
                .filter(|name| !name.is_empty())
                .map(|name| {
                    CString::new(name).map_err(|_| {
                        io::Error::new(io::ErrorKind::InvalidData, "xattr name contains NUL")
                    })
                })
                .collect();
        }
        Err(io::Error::new(
            io::ErrorKind::Other,
            "extended attribute list changed repeatedly",
        ))
    }

    fn attribute_value(fd: c_int, name: &CString) -> io::Result<Vec<u8>> {
        for _ in 0..4 {
            // SAFETY: a null value with size zero requests the current attribute length.
            let length = unsafe { fgetxattr(fd, name.as_ptr(), std::ptr::null_mut(), 0) };
            if length < 0 {
                return Err(io::Error::last_os_error());
            }
            let mut value = vec![0_u8; length as usize];
            let pointer = if value.is_empty() {
                std::ptr::null_mut()
            } else {
                value.as_mut_ptr().cast::<c_void>()
            };
            // SAFETY: the value pointer is null for an empty attribute or valid for value.len().
            let written = unsafe { fgetxattr(fd, name.as_ptr(), pointer, value.len()) };
            if written < 0 {
                if io::Error::last_os_error().raw_os_error() == Some(34) {
                    continue;
                }
                return Err(io::Error::last_os_error());
            }
            value.truncate(written as usize);
            return Ok(value);
        }
        Err(io::Error::new(
            io::ErrorKind::Other,
            "extended attribute changed repeatedly",
        ))
    }

    let source_metadata = source.metadata()?;
    let destination_metadata = destination.metadata()?;
    if source_metadata.uid() != destination_metadata.uid()
        || source_metadata.gid() != destination_metadata.gid()
    {
        // SAFETY: destination is an open file descriptor owned by this operation.
        if 0 != unsafe {
            fchown(
                destination.as_raw_fd(),
                source_metadata.uid(),
                source_metadata.gid(),
            )
        } {
            return Err(io::Error::last_os_error());
        }
    }

    for name in list_names(source.as_raw_fd())? {
        let value = attribute_value(source.as_raw_fd(), &name)?;
        let pointer = if value.is_empty() {
            std::ptr::null()
        } else {
            value.as_ptr().cast::<c_void>()
        };
        // SAFETY: name is NUL-terminated and pointer is valid for value.len() bytes.
        if 0 != unsafe {
            fsetxattr(
                destination.as_raw_fd(),
                name.as_ptr(),
                pointer,
                value.len(),
                0,
            )
        } {
            return Err(io::Error::last_os_error());
        }
    }
    destination.set_permissions(fs::Permissions::from_mode(source_metadata.mode() & 0o7777))
}

#[cfg(windows)]
fn preserve_metadata(_source: &File, _destination: &File) -> io::Result<()> {
    // ReplaceFileW merges the replaced file's ACLs, attributes, named streams and other metadata
    // into the replacement during commit. Applying them to the temporary file here would weaken
    // that platform operation rather than strengthen it.
    Ok(())
}

#[cfg(not(any(target_os = "macos", target_os = "linux", windows)))]
fn preserve_metadata(_source: &File, _destination: &File) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "metadata-preserving atomic replacement is unsupported on this platform",
    ))
}

#[cfg(unix)]
fn replace_file(
    temporary_path: &Path,
    target: &Path,
    _merge_existing_metadata: bool,
) -> io::Result<()> {
    fs::rename(temporary_path, target)
}

#[cfg(windows)]
fn replace_file(
    temporary_path: &Path,
    target: &Path,
    merge_existing_metadata: bool,
) -> io::Result<()> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;

    const REPLACEFILE_WRITE_THROUGH: u32 = 0x0000_0001;
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x0000_0001;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008;

    #[link(name = "Kernel32")]
    unsafe extern "system" {
        fn ReplaceFileW(
            replaced_file_name: *const u16,
            replacement_file_name: *const u16,
            backup_file_name: *const u16,
            replace_flags: u32,
            exclude: *mut c_void,
            reserved: *mut c_void,
        ) -> i32;
        fn MoveFileExW(
            existing_file_name: *const u16,
            new_file_name: *const u16,
            flags: u32,
        ) -> i32;
    }

    fn wide_null(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }

    let target = wide_null(target);
    let temporary = wide_null(temporary_path);
    // SAFETY: both UTF-16 path buffers are NUL-terminated and live through the system call; the
    // optional backup/exclusion/reserved pointers are intentionally null.
    let result = unsafe {
        if merge_existing_metadata {
            ReplaceFileW(
                target.as_ptr(),
                temporary.as_ptr(),
                std::ptr::null(),
                REPLACEFILE_WRITE_THROUGH,
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } else {
            MoveFileExW(
                temporary.as_ptr(),
                target.as_ptr(),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
        }
    };
    if 0 != result {
        Ok(())
    } else {
        Err(io::Error::last_os_error())
    }
}

#[cfg(not(any(unix, windows)))]
fn replace_file(
    _temporary_path: &Path,
    _target: &Path,
    _merge_existing_metadata: bool,
) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "atomic replacement is unsupported on this platform",
    ))
}

#[cfg(unix)]
fn sync_parent_directory(target: &Path) -> io::Result<()> {
    File::open(
        target
            .parent()
            .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?,
    )?
    .sync_all()
}

#[cfg(not(unix))]
fn sync_parent_directory(_target: &Path) -> io::Result<()> {
    Ok(())
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
                "workspace-atomic-{label}-{}-{nonce}",
                std::process::id()
            ));
            fs::create_dir_all(&root).unwrap();
            Self { root }
        }

        fn target(&self) -> PathBuf {
            self.root.join("document.md")
        }

        fn temporary_files(&self) -> Vec<PathBuf> {
            fs::read_dir(&self.root)
                .unwrap()
                .filter_map(Result::ok)
                .map(|entry| entry.path())
                .filter(|path| {
                    path.file_name()
                        .is_some_and(|name| name.to_string_lossy().starts_with(".workspace-write-"))
                })
                .collect()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            fs::remove_dir_all(&self.root).unwrap();
        }
    }

    #[test]
    fn commit_replaces_only_after_the_prepared_file_is_complete() {
        let fixture = Fixture::new("commit");
        let target = fixture.target();
        fs::write(&target, b"old\n").unwrap();

        let prepared = prepare_existing(&target, b"new\n").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"old\n");
        assert_eq!(fixture.temporary_files().len(), 1);

        prepared.commit().unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new\n");
        assert!(fixture.temporary_files().is_empty());
    }

    #[test]
    fn dropping_a_prepared_write_preserves_the_target_and_removes_the_temp() {
        let fixture = Fixture::new("drop");
        let target = fixture.target();
        fs::write(&target, b"old\n").unwrap();

        let prepared = prepare_existing(&target, b"new\n").unwrap();
        let temporary_path = prepared.temporary_path().to_path_buf();
        drop(prepared);

        assert_eq!(fs::read(&target).unwrap(), b"old\n");
        assert!(!temporary_path.exists());
        assert!(fixture.temporary_files().is_empty());
    }

    #[test]
    fn private_atomic_write_creates_and_then_replaces_a_private_file() {
        let fixture = Fixture::new("private");
        let target = fixture.root.join("recovery.json");

        prepare_private(&target, b"first\n")
            .unwrap()
            .commit()
            .unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"first\n");
        prepare_private(&target, b"second\n")
            .unwrap()
            .commit()
            .unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"second\n");
        assert!(fixture.temporary_files().is_empty());

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&target).unwrap().permissions().mode() & 0o777,
                0o600
            );
        }
    }

    #[test]
    fn failed_replace_preserves_the_new_target_and_removes_the_temp() {
        let fixture = Fixture::new("replace-failure");
        let target = fixture.target();
        fs::write(&target, b"old\n").unwrap();
        let prepared = prepare_existing(&target, b"new\n").unwrap();

        fs::remove_file(&target).unwrap();
        fs::create_dir(&target).unwrap();
        let result = prepared.commit();

        assert!(matches!(result, Err(AtomicReplaceError::BeforeCommit(_))));
        assert!(target.is_dir());
        assert!(fixture.temporary_files().is_empty());
    }

    #[test]
    fn write_flush_and_sync_failures_preserve_target_and_remove_temp() {
        #[derive(Clone, Copy, Debug)]
        enum FailureStage {
            ShortWrite,
            Flush,
            Sync,
        }

        for stage in [
            FailureStage::ShortWrite,
            FailureStage::Flush,
            FailureStage::Sync,
        ] {
            let fixture = Fixture::new(&format!("failure-{stage:?}"));
            let target = fixture.target();
            fs::write(&target, b"old\n").unwrap();

            let result = prepare_existing_with(&target, b"new\n", |file, bytes| match stage {
                FailureStage::ShortWrite => {
                    file.write_all(&bytes[..1])?;
                    Err(io::Error::new(
                        io::ErrorKind::WriteZero,
                        "injected short write",
                    ))
                }
                FailureStage::Flush => {
                    file.write_all(bytes)?;
                    Err(io::Error::other("injected flush failure"))
                }
                FailureStage::Sync => {
                    file.write_all(bytes)?;
                    file.flush()?;
                    Err(io::Error::other("injected sync failure"))
                }
            });

            assert!(matches!(result, Err(AtomicReplaceError::BeforeCommit(_))));
            assert_eq!(fs::read(&target).unwrap(), b"old\n");
            assert!(fixture.temporary_files().is_empty());
        }
    }

    #[test]
    fn stale_temp_cleanup_removes_only_exact_old_regular_internal_files() {
        let fixture = Fixture::new("stale-cleanup");
        let nested = fixture.root.join("notes");
        fs::create_dir(&nested).unwrap();
        let now = SystemTime::now();
        let stale_timestamp = now
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .saturating_sub(1_000_000_000);
        let stale = nested.join(format!(".workspace-write-9-{stale_timestamp}-1-0.tmp"));
        fs::write(&stale, b"orphaned bytes").unwrap();
        let malformed = nested.join(".workspace-write-user-not-internal.tmp");
        fs::write(&malformed, b"keep").unwrap();
        let future = now
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .saturating_add(60_000_000_000);
        let recent = nested.join(format!(".workspace-write-9-{future}-2-0.tmp"));
        fs::write(&recent, b"keep").unwrap();
        let vcs_temp = fixture
            .root
            .join(".git")
            .join(format!(".workspace-write-9-{stale_timestamp}-3-0.tmp"));
        fs::create_dir(fixture.root.join(".git")).unwrap();
        fs::write(&vcs_temp, b"keep").unwrap();

        let cleanup_now = SystemTime::now() + std::time::Duration::from_secs(2);
        let report =
            cleanup_stale_workspace_temps(&fixture.root, cleanup_now, std::time::Duration::ZERO)
                .unwrap();

        assert_eq!(
            report,
            StaleTempCleanupReport {
                detected: 2,
                removed: 1,
                retained: 1,
            }
        );
        assert!(!stale.exists());
        assert!(malformed.exists());
        assert!(recent.exists());
        assert!(vcs_temp.exists());
    }

    #[test]
    #[cfg(unix)]
    fn stale_temp_cleanup_does_not_follow_directory_links() {
        use std::os::unix::fs::symlink;

        let fixture = Fixture::new("stale-link-root");
        let outside = Fixture::new("stale-link-outside");
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
            .saturating_sub(1_000_000_000);
        let outside_temp = outside
            .root
            .join(format!(".workspace-write-9-{timestamp}-1-0.tmp"));
        fs::write(&outside_temp, b"outside\n").unwrap();
        symlink(&outside.root, fixture.root.join("linked")).unwrap();

        let report = cleanup_stale_workspace_temps(
            &fixture.root,
            SystemTime::now() + std::time::Duration::from_secs(2),
            std::time::Duration::ZERO,
        )
        .unwrap();

        assert_eq!(report, StaleTempCleanupReport::default());
        assert_eq!(fs::read(outside_temp).unwrap(), b"outside\n");
    }

    #[test]
    #[cfg(unix)]
    fn permission_denied_is_reported_without_creating_a_temp() {
        use std::ffi::c_uint;
        use std::os::unix::fs::PermissionsExt;

        unsafe extern "C" {
            fn geteuid() -> c_uint;
        }

        // Root intentionally bypasses directory write bits, so this fixture has no useful
        // permission boundary in a root-owned container.
        // SAFETY: geteuid takes no arguments and has no memory-safety preconditions.
        if 0 == unsafe { geteuid() } {
            return;
        }

        let fixture = Fixture::new("permission");
        let target = fixture.target();
        fs::write(&target, b"old\n").unwrap();
        fs::set_permissions(&fixture.root, fs::Permissions::from_mode(0o555)).unwrap();
        let result = prepare_existing(&target, b"new\n");
        fs::set_permissions(&fixture.root, fs::Permissions::from_mode(0o755)).unwrap();

        assert!(matches!(
            result,
            Err(AtomicReplaceError::BeforeCommit(ref error))
                if error.kind() == io::ErrorKind::PermissionDenied
        ));
        assert_eq!(fs::read(&target).unwrap(), b"old\n");
        assert!(fixture.temporary_files().is_empty());
    }

    #[test]
    #[cfg(unix)]
    fn ordinary_unix_mode_is_preserved() {
        use std::os::unix::fs::PermissionsExt;

        let fixture = Fixture::new("mode");
        let target = fixture.target();
        fs::write(&target, b"old\n").unwrap();
        fs::set_permissions(&target, fs::Permissions::from_mode(0o640)).unwrap();

        prepare_existing(&target, b"new\n")
            .unwrap()
            .commit()
            .unwrap();

        assert_eq!(
            fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o640
        );
    }

    #[test]
    #[cfg(target_os = "linux")]
    fn linux_extended_attributes_are_preserved() {
        use std::ffi::{c_char, c_int, c_void, CString};
        use std::os::fd::AsRawFd;

        unsafe extern "C" {
            fn fgetxattr(fd: c_int, name: *const c_char, value: *mut c_void, size: usize) -> isize;
            fn fsetxattr(
                fd: c_int,
                name: *const c_char,
                value: *const c_void,
                size: usize,
                flags: c_int,
            ) -> c_int;
        }

        let fixture = Fixture::new("linux-xattr");
        let target = fixture.target();
        fs::write(&target, b"old\n").unwrap();
        let attribute = CString::new("user.workspace.atomic-test").unwrap();
        let expected = b"retained";
        let source = OpenOptions::new()
            .read(true)
            .write(true)
            .open(&target)
            .unwrap();
        // SAFETY: the descriptor and NUL-terminated attribute name are valid, and expected points
        // to exactly expected.len() initialized bytes for the duration of the call.
        assert_eq!(0, unsafe {
            fsetxattr(
                source.as_raw_fd(),
                attribute.as_ptr(),
                expected.as_ptr().cast::<c_void>(),
                expected.len(),
                0,
            )
        });
        drop(source);

        prepare_existing(&target, b"new\n")
            .unwrap()
            .commit()
            .unwrap();

        let replaced = File::open(&target).unwrap();
        let mut actual = vec![0_u8; expected.len()];
        // SAFETY: actual is writable for actual.len() bytes and all other arguments remain valid
        // through the call.
        let length = unsafe {
            fgetxattr(
                replaced.as_raw_fd(),
                attribute.as_ptr(),
                actual.as_mut_ptr().cast::<c_void>(),
                actual.len(),
            )
        };
        assert_eq!(length, expected.len() as isize);
        assert_eq!(actual.as_slice(), &expected[..]);
    }

    #[test]
    #[cfg(windows)]
    fn windows_named_streams_are_preserved() {
        let fixture = Fixture::new("windows-stream");
        let target = fixture.target();
        fs::write(&target, b"old\n").unwrap();
        let mut stream_name = target.as_os_str().to_os_string();
        stream_name.push(":workspace-atomic-test");
        let stream = PathBuf::from(stream_name);
        fs::write(&stream, b"retained").unwrap();

        prepare_existing(&target, b"new\n")
            .unwrap()
            .commit()
            .unwrap();

        assert_eq!(fs::read(target).unwrap(), b"new\n");
        assert_eq!(fs::read(stream).unwrap(), b"retained");
    }

    #[test]
    #[cfg(windows)]
    fn windows_sharing_violation_preserves_target_and_cleans_temp() {
        use std::os::windows::fs::OpenOptionsExt;

        let fixture = Fixture::new("windows-sharing");
        let target = fixture.target();
        fs::write(&target, b"old\n").unwrap();
        let prepared = prepare_existing(&target, b"new\n").unwrap();
        let blocker = OpenOptions::new()
            .read(true)
            .write(true)
            .share_mode(0)
            .open(&target)
            .unwrap();

        let result = prepared.commit();
        drop(blocker);

        assert!(matches!(result, Err(AtomicReplaceError::BeforeCommit(_))));
        assert_eq!(fs::read(&target).unwrap(), b"old\n");
        assert!(fixture.temporary_files().is_empty());
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_extended_attributes_are_preserved() {
        use std::process::Command;

        let fixture = Fixture::new("xattr");
        let target = fixture.target();
        fs::write(&target, b"old\n").unwrap();
        let set = Command::new("/usr/bin/xattr")
            .args(["-w", "com.issuegame.workspace.atomic-test", "retained"])
            .arg(&target)
            .status()
            .unwrap();
        assert!(set.success());

        prepare_existing(&target, b"new\n")
            .unwrap()
            .commit()
            .unwrap();

        let output = Command::new("/usr/bin/xattr")
            .args(["-p", "com.issuegame.workspace.atomic-test"])
            .arg(&target)
            .output()
            .unwrap();
        assert!(output.status.success());
        assert_eq!(String::from_utf8(output.stdout).unwrap().trim(), "retained");
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn macos_access_control_list_is_preserved() {
        use std::process::Command;

        let fixture = Fixture::new("acl");
        let target = fixture.target();
        fs::write(&target, b"old\n").unwrap();
        let user = std::env::var("USER").expect("macOS test user is available");
        let acl = format!("user:{user} allow read,write");
        let set = Command::new("/bin/chmod")
            .args(["+a", &acl])
            .arg(&target)
            .status()
            .unwrap();
        assert!(set.success());
        let before = Command::new("/bin/ls")
            .arg("-le")
            .arg(&target)
            .output()
            .unwrap();
        assert!(before.status.success());
        let before_listing = String::from_utf8(before.stdout).unwrap();
        let before_acl = before_listing.lines().skip(1).collect::<Vec<_>>();
        assert!(!before_acl.is_empty(), "{before_listing}");

        prepare_existing(&target, b"new\n")
            .unwrap()
            .commit()
            .unwrap();

        let output = Command::new("/bin/ls")
            .arg("-le")
            .arg(&target)
            .output()
            .unwrap();
        assert!(output.status.success());
        let listing = String::from_utf8(output.stdout).unwrap();
        let after_acl = listing.lines().skip(1).collect::<Vec<_>>();
        assert_eq!(after_acl, before_acl, "{listing}");
    }
}
