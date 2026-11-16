$ErrorActionPreference = 'Stop'
$root = $env:DEVYY_INSTALL_DIR
$shell = New-Object -ComObject WScript.Shell
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Devyy'
$paths = @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Devyy.lnk'), (Join-Path $menu 'Devyy.lnk'), (Join-Path $menu 'Uninstall Devyy.lnk'))
foreach ($path in $paths) {
  if (Test-Path -LiteralPath $path) {
    $shortcut = $shell.CreateShortcut($path)
    if ($shortcut.TargetPath.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { Remove-Item -LiteralPath $path -Force }
  }
}
if ((Test-Path -LiteralPath $menu) -and -not (Get-ChildItem -LiteralPath $menu -Force)) { Remove-Item -LiteralPath $menu }
