use std::collections::BTreeSet;
use std::env;
use std::fs;
use std::path::{Component, Path, PathBuf};

use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use minisign_verify::{PublicKey, Signature};
use serde::Deserialize;

const EXPECTED_PLATFORMS: [&str; 4] = [
    "darwin-aarch64",
    "darwin-x86_64",
    "linux-x86_64",
    "windows-x86_64",
];

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct VerificationPlan {
    schema_version: u32,
    entries: Vec<VerificationEntry>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct VerificationEntry {
    platform_key: String,
    bundle_path: String,
    signature: String,
}

fn argument(name: &str) -> Result<PathBuf, String> {
    let mut arguments = env::args().skip(1);
    while let Some(argument) = arguments.next() {
        if argument == name {
            return arguments
                .next()
                .map(PathBuf::from)
                .ok_or_else(|| format!("{name} requires a path"));
        }
    }
    Err(format!("missing required argument {name}"))
}

fn decode_base64_text(value: &str, label: &str) -> Result<String, String> {
    let bytes = BASE64
        .decode(value)
        .map_err(|_| format!("{label} is not valid base64"))?;
    String::from_utf8(bytes).map_err(|_| format!("{label} is not UTF-8"))
}

fn checked_bundle_path(root: &Path, relative: &str) -> Result<PathBuf, String> {
    let relative_path = Path::new(relative);
    if relative_path.is_absolute()
        || relative.contains('\\')
        || relative_path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("verification bundle path is not a safe relative path".to_string());
    }
    let path = root.join(relative_path);
    let metadata = fs::symlink_metadata(&path)
        .map_err(|error| format!("verification bundle is unavailable: {error}"))?;
    if metadata.file_type().is_symlink() || !metadata.is_file() {
        return Err("verification bundle is not a regular file".to_string());
    }
    Ok(path)
}

fn main() -> Result<(), String> {
    let plan_path = argument("--plan")?;
    let config_path = argument("--config")?;
    let plan_root = plan_path
        .parent()
        .ok_or_else(|| "verification plan path has no parent".to_string())?;
    let plan: VerificationPlan = serde_json::from_slice(
        &fs::read(&plan_path)
            .map_err(|error| format!("unable to read verification plan: {error}"))?,
    )
    .map_err(|error| format!("verification plan is invalid: {error}"))?;
    if 1 != plan.schema_version || EXPECTED_PLATFORMS.len() != plan.entries.len() {
        return Err("verification plan has unsupported schema or platform coverage".to_string());
    }

    let config: serde_json::Value = serde_json::from_slice(
        &fs::read(config_path)
            .map_err(|error| format!("unable to read updater config: {error}"))?,
    )
    .map_err(|error| format!("updater config is invalid: {error}"))?;
    let encoded_public_key = config
        .pointer("/plugins/updater/pubkey")
        .and_then(serde_json::Value::as_str)
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "updater public key is missing".to_string())?;
    let public_key_text = decode_base64_text(encoded_public_key, "updater public key")?;
    let public_key = PublicKey::decode(&public_key_text)
        .map_err(|error| format!("updater public key is invalid: {error}"))?;

    let mut platforms = BTreeSet::new();
    for entry in plan.entries {
        if !EXPECTED_PLATFORMS.contains(&entry.platform_key.as_str())
            || !platforms.insert(entry.platform_key.clone())
        {
            return Err("verification plan contains an unknown or duplicate platform".to_string());
        }
        let bundle_path = checked_bundle_path(plan_root, &entry.bundle_path)?;
        let signature_text = decode_base64_text(&entry.signature, "updater signature")?;
        let signature = Signature::decode(&signature_text)
            .map_err(|error| format!("updater signature is invalid: {error}"))?;
        let bundle = fs::read(bundle_path)
            .map_err(|error| format!("unable to read updater bundle: {error}"))?;
        public_key
            .verify(&bundle, &signature, true)
            .map_err(|error| {
                format!(
                    "updater signature verification failed for {}: {error}",
                    entry.platform_key
                )
            })?;
        println!("Verified updater signature: {}", entry.platform_key);
    }
    if platforms
        != EXPECTED_PLATFORMS
            .iter()
            .map(|platform| (*platform).to_string())
            .collect()
    {
        return Err("verification plan is missing a required platform".to_string());
    }
    Ok(())
}
