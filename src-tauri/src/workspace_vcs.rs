use std::ffi::{OsStr, OsString};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_COMMAND_BYTES: usize = 2 * 1024 * 1024;
const MAX_STATUS_ENTRIES: usize = 2_000;
const MAX_DIFF_PATH_BYTES: usize = 1_024;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum RepositoryKind {
    None,
    Git,
    Svn,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsStatusEntry {
    path: String,
    status: String,
    index_status: String,
    working_tree_status: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsStatusSnapshot {
    kind: RepositoryKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    branch: Option<String>,
    entries: Vec<VcsStatusEntry>,
    truncated: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum DiffSectionKind {
    WorkingTree,
    Staged,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsDiffSection {
    kind: DiffSectionKind,
    text: String,
    truncated: bool,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsDiffResult {
    kind: RepositoryKind,
    path: String,
    sections: Vec<VcsDiffSection>,
}

#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExternalClient {
    Default,
    SourceGit,
    TortoiseGit,
    Explorer,
    Finder,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VcsDiffRequest {
    path: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
pub struct VcsOpenExternalRequest {
    client: ExternalClient,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VcsOpenExternalResult {
    client: ExternalClient,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Tool {
    Git,
    Svn,
}

struct BoundedOutput {
    stdout: Vec<u8>,
    stderr: Vec<u8>,
    stdout_truncated: bool,
    stderr_truncated: bool,
    success: bool,
}

fn repository_marker(root: &Path, name: &str) -> bool {
    let path = root.join(name);
    matches!(
        fs::symlink_metadata(path),
        Ok(metadata)
            if metadata.file_type().is_dir() && !super::metadata_is_link_or_reparse(&metadata)
    )
}

pub fn detect(root: &Path) -> RepositoryKind {
    if repository_marker(root, ".git") {
        RepositoryKind::Git
    } else if repository_marker(root, ".svn") {
        RepositoryKind::Svn
    } else {
        RepositoryKind::None
    }
}

fn tool_candidates(tool: Tool) -> Vec<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let mut roots = Vec::new();
        for variable in ["ProgramFiles", "ProgramFiles(x86)"] {
            if let Some(value) = std::env::var_os(variable) {
                roots.push(PathBuf::from(value));
            }
        }
        let mut candidates = Vec::new();
        for root in roots {
            match tool {
                Tool::Git => {
                    candidates.push(root.join("Git").join("cmd").join("git.exe"));
                    candidates.push(root.join("Git").join("bin").join("git.exe"));
                }
                Tool::Svn => {
                    candidates.push(root.join("TortoiseSVN").join("bin").join("svn.exe"));
                    candidates.push(root.join("SlikSvn").join("bin").join("svn.exe"));
                }
            }
        }
        candidates
    }
    #[cfg(not(target_os = "windows"))]
    {
        let basename = match tool {
            Tool::Git => "git",
            Tool::Svn => "svn",
        };
        [
            "/usr/bin",
            "/usr/local/bin",
            "/opt/homebrew/bin",
            "/opt/local/bin",
        ]
        .into_iter()
        .map(|directory| Path::new(directory).join(basename))
        .collect()
    }
}

fn resolve_tool(root: &Path, tool: Tool) -> Result<PathBuf, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("workspace root invalid: {error}"))?;
    for candidate in tool_candidates(tool) {
        let Ok(metadata) = fs::symlink_metadata(&candidate) else {
            continue;
        };
        if !metadata.file_type().is_file() || super::metadata_is_link_or_reparse(&metadata) {
            continue;
        }
        let canonical = candidate
            .canonicalize()
            .map_err(|error| format!("VCS executable invalid: {error}"))?;
        if canonical.starts_with(&canonical_root) {
            continue;
        }
        return Ok(canonical);
    }
    Err(match tool {
        Tool::Git => "No allowlisted Git executable is installed".into(),
        Tool::Svn => "No allowlisted SVN executable is installed".into(),
    })
}

fn read_bounded(mut reader: impl Read, limit: usize) -> Result<(Vec<u8>, bool), String> {
    let mut bytes = Vec::new();
    reader
        .by_ref()
        .take((limit + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    let truncated = limit < bytes.len();
    bytes.truncate(limit);
    Ok((bytes, truncated))
}

fn run_bounded(executable: &Path, cwd: &Path, args: &[OsString]) -> Result<BoundedOutput, String> {
    let mut child = Command::new(executable)
        .args(args)
        .current_dir(cwd)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| format!("Unable to start allowlisted VCS executable: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "VCS stdout unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "VCS stderr unavailable".to_string())?;
    let stdout_reader = thread::spawn(move || read_bounded(stdout, MAX_COMMAND_BYTES));
    let stderr_reader = thread::spawn(move || read_bounded(stderr, 64 * 1024));
    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait().map_err(|error| error.to_string())? {
            break status;
        }
        if COMMAND_TIMEOUT <= started.elapsed() {
            let _ = child.kill();
            let _ = child.wait();
            let _ = stdout_reader.join();
            let _ = stderr_reader.join();
            return Err("VCS command exceeded the 5 second limit".into());
        }
        thread::sleep(Duration::from_millis(20));
    };
    let (stdout, stdout_truncated) = stdout_reader
        .join()
        .map_err(|_| "VCS stdout reader failed".to_string())??;
    let (stderr, stderr_truncated) = stderr_reader
        .join()
        .map_err(|_| "VCS stderr reader failed".to_string())??;
    Ok(BoundedOutput {
        stdout,
        stderr,
        stdout_truncated,
        stderr_truncated,
        success: status.success(),
    })
}

fn git_prefix() -> Vec<OsString> {
    #[cfg(target_os = "windows")]
    let disabled_hooks = "core.hooksPath=NUL";
    #[cfg(not(target_os = "windows"))]
    let disabled_hooks = "core.hooksPath=/dev/null";
    [
        "--no-pager",
        "-c",
        "core.fsmonitor=false",
        "-c",
        disabled_hooks,
        "-c",
        "diff.external=",
    ]
    .into_iter()
    .map(OsString::from)
    .collect()
}

fn git_status_args() -> Vec<OsString> {
    let mut args = git_prefix();
    args.extend([
        OsString::from("status"),
        OsString::from("--porcelain=v2"),
        OsString::from("-z"),
        OsString::from("--branch"),
        OsString::from("--untracked-files=normal"),
    ]);
    args
}

fn git_diff_args(path: &str, staged: bool) -> Vec<OsString> {
    let mut args = git_prefix();
    args.extend([
        OsString::from("diff"),
        OsString::from("--no-ext-diff"),
        OsString::from("--no-textconv"),
        OsString::from("--no-color"),
        OsString::from("--unified=3"),
    ]);
    if staged {
        args.push(OsString::from("--cached"));
    }
    args.push(OsString::from("--"));
    args.push(OsString::from(path));
    args
}

fn svn_status_args() -> Vec<OsString> {
    [
        "status",
        "--non-interactive",
        "--no-auth-cache",
        "--ignore-externals",
    ]
    .into_iter()
    .map(OsString::from)
    .collect()
}

fn svn_diff_args(path: &str) -> Vec<OsString> {
    [
        OsString::from("diff"),
        OsString::from("--internal-diff"),
        OsString::from("--non-interactive"),
        OsString::from("--no-auth-cache"),
        OsString::from("--"),
        OsString::from(path),
    ]
    .into_iter()
    .collect()
}

fn checked_output(output: BoundedOutput, operation: &str) -> Result<BoundedOutput, String> {
    if output.success || output.stdout_truncated {
        return Ok(output);
    }
    let mut message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if message.is_empty() {
        message = format!("{operation} failed");
    }
    if output.stderr_truncated {
        message.push_str(" (diagnostic truncated)");
    }
    Err(message)
}

fn valid_returned_path(path: &str) -> Option<String> {
    let normalized = path.strip_prefix("./").unwrap_or(path).replace('\\', "/");
    if MAX_DIFF_PATH_BYTES < normalized.len()
        || super::workspace_document::validate_workspace_path(&normalized).is_err()
    {
        return None;
    }
    Some(normalized)
}

fn status_entry(path: &str, code: &str) -> Option<VcsStatusEntry> {
    let path = valid_returned_path(path)?;
    let mut chars = code.chars();
    let index_status = chars.next().unwrap_or(' ').to_string();
    let working_tree_status = chars.next().unwrap_or(' ').to_string();
    Some(VcsStatusEntry {
        path,
        status: code.to_string(),
        index_status,
        working_tree_status,
    })
}

fn parse_git_status(bytes: &[u8], output_truncated: bool) -> VcsStatusSnapshot {
    let records = bytes.split(|byte| 0 == *byte).collect::<Vec<_>>();
    let mut branch = None;
    let mut entries = Vec::new();
    let mut skip_rename_origin = false;
    for raw in records {
        if raw.is_empty() {
            continue;
        }
        if skip_rename_origin {
            skip_rename_origin = false;
            continue;
        }
        let record = String::from_utf8_lossy(raw);
        if let Some(value) = record.strip_prefix("# branch.head ") {
            if "(detached)" != value && 256 >= value.len() {
                branch = Some(value.to_string());
            }
            continue;
        }
        let parsed = if let Some(path) = record.strip_prefix("? ") {
            status_entry(path, "??")
        } else if let Some(path) = record.strip_prefix("! ") {
            status_entry(path, "!!")
        } else if record.starts_with("1 ") {
            let parts = record.splitn(9, ' ').collect::<Vec<_>>();
            (9 == parts.len())
                .then(|| status_entry(parts[8], parts[1]))
                .flatten()
        } else if record.starts_with("2 ") {
            let parts = record.splitn(10, ' ').collect::<Vec<_>>();
            skip_rename_origin = true;
            (10 == parts.len())
                .then(|| status_entry(parts[9], parts[1]))
                .flatten()
        } else if record.starts_with("u ") {
            let parts = record.splitn(11, ' ').collect::<Vec<_>>();
            (11 == parts.len())
                .then(|| status_entry(parts[10], parts[1]))
                .flatten()
        } else {
            None
        };
        if let Some(entry) = parsed {
            if MAX_STATUS_ENTRIES == entries.len() {
                return VcsStatusSnapshot {
                    kind: RepositoryKind::Git,
                    branch,
                    entries,
                    truncated: true,
                };
            }
            entries.push(entry);
        }
    }
    VcsStatusSnapshot {
        kind: RepositoryKind::Git,
        branch,
        entries,
        truncated: output_truncated,
    }
}

fn parse_svn_status(bytes: &[u8], output_truncated: bool) -> VcsStatusSnapshot {
    let source = String::from_utf8_lossy(bytes);
    let mut entries = Vec::new();
    for line in source.lines() {
        if line.len() < 8 {
            continue;
        }
        let code = &line[..7];
        let path = line[7..].trim_start();
        if let Some(entry) = status_entry(path, &code[..2]) {
            if MAX_STATUS_ENTRIES == entries.len() {
                return VcsStatusSnapshot {
                    kind: RepositoryKind::Svn,
                    branch: None,
                    entries,
                    truncated: true,
                };
            }
            entries.push(entry);
        }
    }
    VcsStatusSnapshot {
        kind: RepositoryKind::Svn,
        branch: None,
        entries,
        truncated: output_truncated,
    }
}

pub fn status(root: &Path) -> Result<VcsStatusSnapshot, String> {
    match detect(root) {
        RepositoryKind::None => Ok(VcsStatusSnapshot {
            kind: RepositoryKind::None,
            branch: None,
            entries: Vec::new(),
            truncated: false,
        }),
        RepositoryKind::Git => {
            let executable = resolve_tool(root, Tool::Git)?;
            let output = checked_output(
                run_bounded(&executable, root, &git_status_args())?,
                "Git status",
            )?;
            Ok(parse_git_status(&output.stdout, output.stdout_truncated))
        }
        RepositoryKind::Svn => {
            let executable = resolve_tool(root, Tool::Svn)?;
            let output = checked_output(
                run_bounded(&executable, root, &svn_status_args())?,
                "SVN status",
            )?;
            Ok(parse_svn_status(&output.stdout, output.stdout_truncated))
        }
    }
}

fn validate_diff_path(root: &Path, path: &str) -> Result<String, String> {
    if MAX_DIFF_PATH_BYTES < path.len() {
        return Err("VCS diff path exceeds the length limit".into());
    }
    super::workspace_document::validate_workspace_path(path)?;
    // Deleted paths are valid diff targets, so validate their existing ancestor rather than
    // requiring the target itself to exist.
    super::resolve_write_path(root, path)?;
    Ok(path.to_string())
}

fn diff_section(
    executable: &Path,
    root: &Path,
    args: &[OsString],
    kind: DiffSectionKind,
    operation: &str,
) -> Result<VcsDiffSection, String> {
    let output = checked_output(run_bounded(executable, root, args)?, operation)?;
    Ok(VcsDiffSection {
        kind,
        text: String::from_utf8_lossy(&output.stdout).into_owned(),
        truncated: output.stdout_truncated,
    })
}

pub fn diff(root: &Path, request: VcsDiffRequest) -> Result<VcsDiffResult, String> {
    let path = validate_diff_path(root, &request.path)?;
    match detect(root) {
        RepositoryKind::None => Err("The workspace is not a Git or SVN repository".into()),
        RepositoryKind::Git => {
            let executable = resolve_tool(root, Tool::Git)?;
            let working = diff_section(
                &executable,
                root,
                &git_diff_args(&path, false),
                DiffSectionKind::WorkingTree,
                "Git working-tree diff",
            )?;
            let staged = diff_section(
                &executable,
                root,
                &git_diff_args(&path, true),
                DiffSectionKind::Staged,
                "Git staged diff",
            )?;
            Ok(VcsDiffResult {
                kind: RepositoryKind::Git,
                path,
                sections: vec![working, staged],
            })
        }
        RepositoryKind::Svn => {
            let executable = resolve_tool(root, Tool::Svn)?;
            let section = diff_section(
                &executable,
                root,
                &svn_diff_args(&path),
                DiffSectionKind::WorkingTree,
                "SVN diff",
            )?;
            Ok(VcsDiffResult {
                kind: RepositoryKind::Svn,
                path,
                sections: vec![section],
            })
        }
    }
}

fn checked_launch_executable(root: &Path, candidate: &Path) -> Result<PathBuf, String> {
    let metadata = fs::symlink_metadata(candidate)
        .map_err(|_| "The allowlisted external client executable is unavailable".to_string())?;
    if !metadata.file_type().is_file() || super::metadata_is_link_or_reparse(&metadata) {
        return Err("The allowlisted external client executable is invalid".into());
    }
    let executable = candidate
        .canonicalize()
        .map_err(|error| format!("External client executable is invalid: {error}"))?;
    if executable.starts_with(root) {
        return Err("External client executable cannot be inside the workspace".into());
    }
    Ok(executable)
}

#[cfg(target_os = "macos")]
fn checked_application_bundle(root: &Path, candidate: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(candidate) else {
        return false;
    };
    if !metadata.file_type().is_dir() || super::metadata_is_link_or_reparse(&metadata) {
        return false;
    }
    candidate
        .canonicalize()
        .is_ok_and(|bundle| !bundle.starts_with(root))
}

fn run_launch(root: &Path, candidate: &Path, args: &[&OsStr]) -> Result<(), String> {
    let executable = checked_launch_executable(root, candidate)?;
    let status = Command::new(executable)
        .args(args)
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Unable to open external VCS client: {error}"))?;
    drop(status);
    Ok(())
}

#[cfg(target_os = "macos")]
fn open_external_platform(
    root: &Path,
    requested: ExternalClient,
) -> Result<ExternalClient, String> {
    let open = Path::new("/usr/bin/open");
    let source_git = Path::new("/Applications/SourceGit.app");
    let source_git_available = checked_application_bundle(root, source_git);
    let client = match requested {
        ExternalClient::Default if source_git_available => ExternalClient::SourceGit,
        ExternalClient::Default => ExternalClient::Finder,
        value => value,
    };
    let root_os = root.as_os_str();
    match client {
        ExternalClient::SourceGit if source_git_available => {
            run_launch(
                root,
                open,
                &[OsStr::new("-a"), source_git.as_os_str(), root_os],
            )?;
        }
        ExternalClient::Finder => run_launch(root, open, &[root_os])?,
        _ => return Err("The requested external VCS client is unavailable on macOS".into()),
    }
    Ok(client)
}

#[cfg(target_os = "windows")]
fn open_external_platform(
    root: &Path,
    requested: ExternalClient,
) -> Result<ExternalClient, String> {
    let program_files = std::env::var_os("ProgramFiles")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
    let source_git = program_files.join("SourceGit").join("SourceGit.exe");
    let local_source_git = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .map(|path| {
            path.join("Programs")
                .join("SourceGit")
                .join("SourceGit.exe")
        });
    let tortoise = program_files
        .join("TortoiseGit")
        .join("bin")
        .join("TortoiseGitProc.exe");
    let explorer = std::env::var_os("SystemRoot")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Windows"))
        .join("explorer.exe");
    let client = match requested {
        ExternalClient::Default
            if local_source_git.as_ref().is_some_and(|path| path.is_file())
                || source_git.is_file() =>
        {
            ExternalClient::SourceGit
        }
        ExternalClient::Default if tortoise.is_file() => ExternalClient::TortoiseGit,
        ExternalClient::Default => ExternalClient::Explorer,
        value => value,
    };
    match client {
        ExternalClient::SourceGit
            if local_source_git.as_ref().is_some_and(|path| path.is_file())
                || source_git.is_file() =>
        {
            let executable = local_source_git
                .as_deref()
                .filter(|path| path.is_file())
                .unwrap_or(&source_git);
            run_launch(root, executable, &[root.as_os_str()])?;
        }
        ExternalClient::TortoiseGit if tortoise.is_file() => {
            let path_arg = OsString::from(format!("/path:{}", root.to_string_lossy()));
            run_launch(
                root,
                &tortoise,
                &[OsStr::new("/command:log"), path_arg.as_os_str()],
            )?;
        }
        ExternalClient::Explorer if explorer.is_file() => {
            run_launch(root, &explorer, &[root.as_os_str()])?;
        }
        _ => return Err("The requested external VCS client is unavailable on Windows".into()),
    }
    Ok(client)
}

#[cfg(all(not(target_os = "macos"), not(target_os = "windows")))]
fn open_external_platform(
    root: &Path,
    requested: ExternalClient,
) -> Result<ExternalClient, String> {
    let xdg_open = Path::new("/usr/bin/xdg-open");
    if !matches!(requested, ExternalClient::Default) || !xdg_open.is_file() {
        return Err(
            "Only the allowlisted default file manager is available on this platform".into(),
        );
    }
    run_launch(root, xdg_open, &[root.as_os_str()])?;
    Ok(ExternalClient::Default)
}

pub fn open_external(
    root: &Path,
    request: VcsOpenExternalRequest,
) -> Result<VcsOpenExternalResult, String> {
    let canonical_root = root
        .canonicalize()
        .map_err(|error| format!("workspace root invalid: {error}"))?;
    let client = open_external_platform(&canonical_root, request.client)?;
    Ok(VcsOpenExternalResult { client })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_workspace(label: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("app-vcs-{label}-{}-{nonce}", std::process::id()))
    }

    fn strings(values: &[OsString]) -> Vec<String> {
        values
            .iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect()
    }

    #[test]
    fn detection_prefers_git_and_rejects_link_markers() {
        let root = temp_workspace("detect");
        fs::create_dir_all(root.join(".svn")).unwrap();
        assert_eq!(detect(&root), RepositoryKind::Svn);
        fs::create_dir(root.join(".git")).unwrap();
        assert_eq!(detect(&root), RepositoryKind::Git);
        fs::remove_dir_all(root.join(".git")).unwrap();
        fs::write(root.join(".git"), "gitdir: outside").unwrap();
        assert_eq!(detect(&root), RepositoryKind::Svn);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn git_status_parser_handles_branch_paths_renames_and_bounds() {
        let source = concat!(
            "# branch.head feature/safe\0",
            "1 M. N... 100644 100644 100644 aaaaaaa bbbbbbb docs/a.md\0",
            "2 R. N... 100644 100644 100644 aaaaaaa bbbbbbb R100 docs/new name.md\0",
            "docs/old name.md\0",
            "? notes/new.md\0",
        );
        let snapshot = parse_git_status(source.as_bytes(), false);
        assert_eq!(snapshot.branch.as_deref(), Some("feature/safe"));
        assert_eq!(snapshot.entries.len(), 3);
        assert_eq!(snapshot.entries[1].path, "docs/new name.md");
        assert_eq!(snapshot.entries[2].status, "??");
        assert!(!snapshot.truncated);
    }

    #[test]
    fn svn_status_parser_preserves_spaces_without_accepting_outside_paths() {
        let snapshot = parse_svn_status(
            b"M       docs/changed file.md\n?       ../outside.md\nA  +    notes/new.md\n",
            false,
        );
        assert_eq!(snapshot.entries.len(), 2);
        assert_eq!(snapshot.entries[0].path, "docs/changed file.md");
        assert_eq!(snapshot.entries[1].path, "notes/new.md");
    }

    #[test]
    fn command_plans_have_fixed_subcommands_and_path_after_separator() {
        let status = strings(&git_status_args());
        assert!(status
            .windows(2)
            .any(|pair| pair == ["-c", "core.fsmonitor=false"]));
        assert!(status.ends_with(&[
            "status".into(),
            "--porcelain=v2".into(),
            "-z".into(),
            "--branch".into(),
            "--untracked-files=normal".into(),
        ]));

        let git = strings(&git_diff_args("docs/-safe.md", true));
        assert_eq!(git[git.len() - 2..], ["--", "docs/-safe.md"]);
        assert!(git.contains(&"--cached".to_string()));
        assert!(git.contains(&"--no-ext-diff".to_string()));
        assert!(git.contains(&"--no-textconv".to_string()));

        let svn = strings(&svn_diff_args("docs/-safe.md"));
        assert_eq!(svn[svn.len() - 2..], ["--", "docs/-safe.md"]);
        assert_eq!(svn[0], "diff");
    }

    #[test]
    fn diff_path_is_workspace_relative_and_allows_deleted_targets() {
        let root = temp_workspace("path");
        fs::create_dir_all(root.join("docs")).unwrap();
        assert_eq!(
            validate_diff_path(&root, "docs/deleted.md").unwrap(),
            "docs/deleted.md"
        );
        assert!(validate_diff_path(&root, "../outside.md").is_err());
        assert!(validate_diff_path(&root, "/absolute.md").is_err());
        fs::remove_dir_all(root).unwrap();
    }
}
