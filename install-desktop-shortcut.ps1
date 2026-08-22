$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$AppManifest = Get-Content -LiteralPath (Join-Path $Root "app.manifest.json") -Raw | ConvertFrom-Json
$Launcher = Join-Path $Root "launch.vbs"
$ShortcutName = [string]$AppManifest.name
$Desktop = [Environment]::GetFolderPath("Desktop")
$ShortcutPath = Join-Path $Desktop "$ShortcutName.lnk"

$WshShell = New-Object -ComObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut($ShortcutPath)
$Shortcut.TargetPath = "wscript.exe"
$Shortcut.Arguments = "`"$Launcher`""
$Shortcut.WorkingDirectory = $Root
$Shortcut.Description = [string]$AppManifest.description
$Favicon = Join-Path $Root "web\favicon.ico"
if (Test-Path $Favicon) {
    $Shortcut.IconLocation = "$Favicon,0"
} else {
    $Shortcut.IconLocation = "$env:SystemRoot\System32\imageres.dll,112"
}
$Shortcut.Save()

Write-Host "Desktop shortcut created: $ShortcutPath"
