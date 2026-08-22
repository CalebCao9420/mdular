# Build latest.json for GitHub Release from NSIS build output + .sig file.
#
# Usage (after build-tauri-installer.bat with TAURI_SIGNING_PRIVATE_KEY set):
#   npm run generate:latest-json -- -Version "1.0.1" -Notes "Bug fixes"
#
# Upload to Release assets:
#   latest.json
#   <app-name>_1.0.1_x64-setup.exe
#   <app-name>_1.0.1_x64-setup.exe.sig

param(
    [string]$Version = "",
    [string]$Notes = "",
    [string]$Repo = "",
    [string]$BundleDir = "",
    [string]$AssetName = ""
)

$ErrorActionPreference = "Stop"
$Root = Split-Path $PSScriptRoot -Parent
$AppManifest = Get-Content -LiteralPath (Join-Path $Root "app.manifest.json") -Raw | ConvertFrom-Json
if (-not $Version) {
    $Version = [string]$AppManifest.version
}
if (-not $Repo) {
    $repoUri = [uri]([string]$AppManifest.repository)
    $Repo = $repoUri.AbsolutePath.Trim('/').Replace('.git', '')
}
if (-not $BundleDir) {
    $BundleDir = Join-Path $Root "src-tauri\target\release\bundle\nsis"
}

$setup = Get-ChildItem $BundleDir -Filter "*-setup.exe" | Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $setup) {
    Write-Error "No *-setup.exe in $BundleDir. Run build-tauri-installer.bat first."
}

$sigPath = "$($setup.FullName).sig"
if (-not (Test-Path $sigPath)) {
    Write-Error "Missing signature file: $sigPath (set TAURI_SIGNING_PRIVATE_KEY when building)"
}

$signature = (Get-Content $sigPath -Raw).Trim()
$assetName = if ($AssetName) { $AssetName } else { $setup.Name }
$encodedName = [uri]::EscapeDataString($assetName)
$url = "https://github.com/$Repo/releases/download/v$Version/$encodedName"

$manifest = @{
    version  = $Version
    notes    = $Notes
    pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = @{
        "windows-x86_64" = @{
            url       = $url
            signature = $signature
        }
    }
} | ConvertTo-Json -Depth 5

$outPath = Join-Path $Root "latest.json"
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
[System.IO.File]::WriteAllText($outPath, $manifest, $utf8NoBom)
Write-Host "Wrote $outPath"
Write-Host $manifest
Write-Host ""
Write-Host "Upload to GitHub Release v$Version with EXACT asset names:" -ForegroundColor Cyan
Write-Host "  1. $assetName"
Write-Host "  2. $assetName.sig"
Write-Host "  3. latest.json  (this file)"
Write-Host ""
Write-Host "Download URL in manifest:" -ForegroundColor Cyan
Write-Host "  $url"
Write-Host ""
Write-Host "If GitHub asset name differs from build output, re-upload or pass -AssetName." -ForegroundColor Yellow
