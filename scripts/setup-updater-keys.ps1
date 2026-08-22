# Generate Tauri updater signing keys and patch src-tauri/tauri.conf.json.
# Run once before your first signed release build.
#
# Usage:
#   npm run setup:updater-keys
#   npm run setup:updater-keys -- -GitHubRepo "your-user/your-repo"
#
# Private key: %USERPROFILE%\.tauri\<app-name>.key  (NEVER commit)
# Public key:  written into tauri.conf.json plugins.updater.pubkey

param(
    [string]$KeyPath = "",
    [string]$GitHubRepo = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$AppManifest = Get-Content -LiteralPath (Join-Path $Root "app.manifest.json") -Raw | ConvertFrom-Json
if (-not $KeyPath) {
    $KeyPath = Join-Path $env:USERPROFILE ".tauri\$($AppManifest.name).key"
}
if (-not $GitHubRepo) {
    $repoUri = [uri]([string]$AppManifest.repository)
    $GitHubRepo = $repoUri.AbsolutePath.Trim('/').Replace('.git', '')
}
$ConfPath = Join-Path $Root "src-tauri\tauri.conf.json"

if (-not (Get-Command npx -ErrorAction SilentlyContinue)) {
    Write-Error "npx not found. Run npm install in the repo root first."
}

$keyDir = Split-Path $KeyPath -Parent
if (-not (Test-Path $keyDir)) {
    New-Item -ItemType Directory -Path $keyDir -Force | Out-Null
}

Write-Host "Generating updater signing key pair..."
Write-Host "  Private: $KeyPath"
Push-Location $Root
try {
    npx tauri signer generate -w $KeyPath -f --ci
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally {
    Pop-Location
}

$PubPath = "$KeyPath.pub"
if (-not (Test-Path $PubPath)) {
    Write-Error "Public key not found: $PubPath"
}

$pubkey = (Get-Content $PubPath -Raw).Trim()
$endpoint = "https://github.com/$GitHubRepo/releases/latest/download/latest.json"

Write-Host "Patching tauri.conf.json (pubkey + endpoint)..."
node (Join-Path $PSScriptRoot "patch-updater-config.mjs") $ConfPath $pubkey $endpoint
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host ""
Write-Host "Before building a release installer, set the private key (PowerShell):"
Write-Host '  $env:TAURI_SIGNING_PRIVATE_KEY="' + $KeyPath + '"'
Write-Host ""
Write-Host "Then: build-tauri-installer.bat"
Write-Host "See README and npm run setup:updater-keys / generate:latest-json for Release steps."
