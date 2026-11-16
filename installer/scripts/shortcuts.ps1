$ErrorActionPreference = 'Stop'
$root = $env:DEVYY_INSTALL_DIR
$shell = New-Object -ComObject WScript.Shell
function Add-Shortcut([string]$path, [string]$target, [string]$arguments = '') {
  $parent = Split-Path -Parent $path
  New-Item -ItemType Directory -Force -Path $parent | Out-Null
  if (Test-Path -LiteralPath $path) {
    $existing = $shell.CreateShortcut($path)
    if (-not $existing.TargetPath.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw "A shortcut named Devyy already exists at $path" }
  }
  $shortcut = $shell.CreateShortcut($path)
  $shortcut.TargetPath = $target
  $shortcut.Arguments = $arguments
  $shortcut.WorkingDirectory = $root
  $shortcut.IconLocation = Join-Path $root 'app\devyy.exe'
  $shortcut.Save()
}
if ($env:DEVYY_DESKTOP_SHORTCUT -eq '1') { Add-Shortcut (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Devyy.lnk') (Join-Path $root 'app\devyy.exe') }
if ($env:DEVYY_MENU_SHORTCUT -eq '1') {
  $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Devyy'
  Add-Shortcut (Join-Path $menu 'Devyy.lnk') (Join-Path $root 'app\devyy.exe')
  Add-Shortcut (Join-Path $menu 'Uninstall Devyy.lnk') (Join-Path $root 'Uninstall Devyy.exe') ('--uninstall --install-dir "' + $root + '"')
}
