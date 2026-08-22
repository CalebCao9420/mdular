param(
    [string]$Folder = "",
    [switch]$AppWindow,
    [switch]$Browser,
    [switch]$Tauri,
    [switch]$TauriBuild
)

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Web = Join-Path $Root "web"
$AppManifest = Get-Content -LiteralPath (Join-Path $Root "app.manifest.json") -Raw | ConvertFrom-Json
$AppName = [string]$AppManifest.name
$AppWorkspaceConfigPath = ".{0}\config.json" -f $AppName
$AppEnvironmentPrefix = ($AppName -replace '[^A-Za-z0-9]', '_').ToUpperInvariant()

function Get-AppEnvironmentName([string]$Suffix) {
    return "${AppEnvironmentPrefix}_${Suffix}"
}

function Get-AppEnvironmentValue([string]$Suffix) {
    return [Environment]::GetEnvironmentVariable((Get-AppEnvironmentName $Suffix))
}

# Rust/cargo (rustup) — not always on PATH in fresh PowerShell sessions
$cargoBin = Join-Path $env:USERPROFILE ".cargo\bin"
if ((Test-Path $cargoBin) -and ($env:Path -notlike "*$cargoBin*")) {
    $env:Path = "$cargoBin;$env:Path"
}

# Node/npm — some setups wrongly put node.exe (file) on PATH instead of its directory
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  $nodeDirs = [System.Collections.Generic.List[string]]::new()
  foreach ($entry in ($env:Path -split ';')) {
    if (-not $entry) { continue }
    if ($entry -match '\\node\.exe$' -and (Test-Path $entry)) {
      $parent = Split-Path $entry -Parent
      if ($parent -and -not $nodeDirs.Contains($parent)) { $nodeDirs.Add($parent) }
    }
  }
  foreach ($candidate in @(
      (Get-AppEnvironmentValue "NODE_DIR"),
      (Join-Path $env:ProgramFiles "nodejs"),
      (Join-Path ${env:ProgramFiles(x86)} "nodejs"),
      "D:\Client\Environment\NodeJs"
    )) {
    if ($candidate -and (Test-Path (Join-Path $candidate "npm.cmd")) -and -not $nodeDirs.Contains($candidate)) {
      $nodeDirs.Add($candidate)
    }
  }
  foreach ($dir in $nodeDirs) {
    $env:Path = "$dir;$env:Path"
    if (Get-Command npm -ErrorAction SilentlyContinue) { break }
  }
}
if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  $nodeDirectoryVariable = Get-AppEnvironmentName "NODE_DIR"
  Write-Error "npm not found. Add your Node.js folder (containing npm.cmd) to PATH, or set $nodeDirectoryVariable."
}
$DefaultPort = 8765
$ConfiguredPort = Get-AppEnvironmentValue "PORT"
$Port = if ($ConfiguredPort) { [int]$ConfiguredPort } else { $DefaultPort }

if ((Get-AppEnvironmentValue "PORTABLE") -eq "1") {
    $StateDir = Join-Path $Root "data"
} else {
    $StateDir = Join-Path $env:LOCALAPPDATA $AppName
}
$StateFile = Join-Path $StateDir "server.json"
$HintFile = Join-Path $Web ".launcher-hint.json"

# Default: app window (no browser chrome). Use -Browser to force normal tab.
$UseAppWindow = -not $Browser
if ($AppWindow) {
    $UseAppWindow = $true
}

function Ensure-StateDir {
    New-Item -ItemType Directory -Force -Path $StateDir | Out-Null
}

function Get-ServerState {
    if (-not (Test-Path $StateFile)) { return $null }
    try {
        return Get-Content $StateFile -Raw | ConvertFrom-Json
    } catch {
        return $null
    }
}

function Save-ServerState([int]$ActivePort, [int]$ProcessId) {
    Ensure-StateDir
    @{
        port    = $ActivePort
        pid     = $ProcessId
        started = (Get-Date).ToString("o")
        webRoot = $Web
    } | ConvertTo-Json | Set-Content -Path $StateFile -Encoding UTF8
}

function Test-AppServer([int]$TestPort) {
    try {
        $response = Invoke-WebRequest -Uri "http://localhost:$TestPort/config.js" -UseBasicParsing -TimeoutSec 1
        return $response.Content -match ([regex]::Escape($AppName))
    } catch {
        return $false
    }
}

function Get-ListeningPortOwner([int]$TestPort) {
    try {
        return Get-NetTCPConnection -LocalPort $TestPort -State Listen -ErrorAction Stop |
            Select-Object -First 1
    } catch {
        return $null
    }
}

function Start-AppServer([int]$ListenPort) {
    $listener = Get-ListeningPortOwner $ListenPort
    if ($null -ne $listener) {
        if (Test-AppServer $ListenPort) {
            return $ListenPort
        }
        $portVariable = Get-AppEnvironmentName "PORT"
        Write-Warning "Port $ListenPort is in use by another program. Set $portVariable to use a different port."
        exit 1
    }

    $process = Start-Process -FilePath "python" `
        -ArgumentList "-m", "http.server", $ListenPort `
        -WorkingDirectory $Web `
        -WindowStyle Hidden `
        -PassThru

    $deadline = (Get-Date).AddSeconds(8)
    while (-not (Test-AppServer $ListenPort) -and (Get-Date) -lt $deadline) {
        if ($process.HasExited) {
            Write-Error "Python http.server exited before becoming ready (port $ListenPort)."
        }
        Start-Sleep -Milliseconds 200
    }

    if (-not (Test-AppServer $ListenPort)) {
        Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        Write-Error "Timed out waiting for $AppName on port $ListenPort."
    }

    Save-ServerState $ListenPort $process.Id
    return $ListenPort
}

function Write-LauncherHint([string]$WorkspacePath, [bool]$ShellMode) {
    $plugins = Read-WorkspacePluginIds $WorkspacePath
    $payload = @{
        workspacePath = $WorkspacePath
        shell         = $ShellMode
        plugins       = @($plugins)
        at            = (Get-Date).ToString("o")
    }
    $payload | ConvertTo-Json | Set-Content -Path $HintFile -Encoding UTF8
}

function Read-WorkspacePluginIds([string]$WorkspacePath) {
    if (-not $WorkspacePath) {
        return @()
    }
    $cfgPath = Join-Path $WorkspacePath $AppWorkspaceConfigPath
    if (-not (Test-Path -LiteralPath $cfgPath)) {
        return @()
    }
    try {
        $cfg = Get-Content -LiteralPath $cfgPath -Raw | ConvertFrom-Json
        if ($null -ne $cfg.plugins -and $cfg.plugins -is [System.Array]) {
            return @($cfg.plugins | ForEach-Object { "$_".Trim() } | Where-Object { $_ })
        }
        # legacy { "kanban": true } — treat keys as folder names
        if ($null -ne $cfg.plugins) {
            $ids = @()
            $cfg.plugins.PSObject.Properties | ForEach-Object {
                if ($cfg.plugins.($_.Name)) {
                    $ids += $_.Name
                }
            }
            return $ids
        }
    } catch {
        Write-Warning "Could not parse $cfgPath : $_"
    }
    return @()
}

function Resolve-FolderPath([string]$RawPath) {
    if (-not $RawPath) {
        return ""
    }
    $resolved = $RawPath.Trim().Trim('"')
    if (-not (Test-Path -LiteralPath $resolved)) {
        Write-Error "Folder not found: $resolved"
    }
    return (Resolve-Path -LiteralPath $resolved).Path
}

function Get-AppBrowserPath {
    $candidates = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
    )
    foreach ($exe in $candidates) {
        if (Test-Path -LiteralPath $exe) {
            return $exe
        }
    }
    return $null
}

function Open-AppWindow([string]$Url, [bool]$AsAppWindow) {
    if ($AsAppWindow) {
        $browser = Get-AppBrowserPath
        if ($browser) {
            Start-Process -FilePath $browser -ArgumentList "--app=$Url", "--window-size=1280,900"
            return
        }
    }
    Start-Process $Url
}

Ensure-StateDir

Push-Location $Root
try {
    Write-Host "Building web assets..."
    npm run build --silent
    if ($LASTEXITCODE -ne 0) {
        npm run build
        if ($LASTEXITCODE -ne 0) {
            Write-Error "npm run build failed"
        }
    }
} finally {
    Pop-Location
}

$folderPath = Resolve-FolderPath $Folder
$shellFlag = $UseAppWindow

if ($folderPath) {
    Write-LauncherHint $folderPath $shellFlag
} elseif ($shellFlag -and (Test-Path $HintFile)) {
    try {
        $existing = Get-Content $HintFile -Raw | ConvertFrom-Json
        if (-not $existing.shell) {
            Write-LauncherHint ($existing.workspacePath | ForEach-Object { $_ }) $true
        }
    } catch {
        Write-LauncherHint "" $true
    }
}

if ($TauriBuild) {
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        Write-Error "Rust/cargo not found. Install from https://rustup.rs/ then run again."
    }
    if (-not (Test-Path (Join-Path $Root "node_modules\@tauri-apps\cli"))) {
        Write-Host "Installing npm dependencies (first time)..."
        Push-Location $Root
        try {
            npm install
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        } finally {
            Pop-Location
        }
    }
    Push-Location $Root
    try {
        $setupScript = Join-Path $Root "scripts\setup-tauri-nsis.ps1"
        if (Test-Path $setupScript) {
            Write-Host "Checking NSIS toolchain..."
            & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setupScript
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        }
        Write-Host "Building $AppName installer (Release + NSIS)..."
        Write-Host "This may take several minutes on first run."
        npm run tauri:build
        if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        $bundleDir = Join-Path $Root "src-tauri\target\release\bundle\nsis"
        if (Test-Path $bundleDir) {
            Write-Host ""
            Write-Host "Installer output:" -ForegroundColor Green
            Get-ChildItem $bundleDir -Filter "*.exe" | ForEach-Object { Write-Host "  $($_.FullName)" }
        }
        $releaseExe = Join-Path $Root "src-tauri\target\release\${AppName}.exe"
        if (Test-Path $releaseExe) {
            Write-Host "Portable exe:" -ForegroundColor Green
            Write-Host "  $releaseExe"
        }
        Write-Host ""
        Write-Host "See README for usage notes."
    } finally {
        Pop-Location
    }
    exit $LASTEXITCODE
}

if ($Tauri) {
    if (-not (Get-Command cargo -ErrorAction SilentlyContinue)) {
        Write-Error "Rust/cargo not found. Install from https://rustup.rs/ then run again."
    }
    if (-not (Test-Path (Join-Path $Root "node_modules\@tauri-apps\cli"))) {
        Write-Host "Installing npm dependencies (first time)..."
        Push-Location $Root
        try {
            npm install
            if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
        } finally {
            Pop-Location
        }
    }
    if ($folderPath) {
        [Environment]::SetEnvironmentVariable(
            (Get-AppEnvironmentName "WORKSPACE"),
            $folderPath,
            [EnvironmentVariableTarget]::Process
        )
        Write-LauncherHint $folderPath $true
    } else {
        Write-LauncherHint "" $true
    }
    Push-Location $Root
    try {
        Write-Host "Starting Tauri (Phase 7a PoC) — no Python server required."
        npm run tauri:dev
    } finally {
        Pop-Location
    }
    exit $LASTEXITCODE
}

$activePort = $Port
$state = Get-ServerState

if ($null -ne $state -and $state.port -and (Test-AppServer ([int]$state.port))) {
    $proc = Get-Process -Id ([int]$state.pid) -ErrorAction SilentlyContinue
    if ($null -ne $proc -and -not $proc.HasExited) {
        $activePort = [int]$state.port
    }
}

if (-not (Test-AppServer $activePort)) {
    $activePort = Start-AppServer $Port
}

$query = @()
if ($shellFlag) { $query += "shell=1" }
if ($folderPath) { $query += "workspace=" + [uri]::EscapeDataString($folderPath) }
$url = "http://localhost:$activePort/"
if ($query.Count -gt 0) {
    $url += "?" + ($query -join "&")
}

Open-AppWindow $url $shellFlag
