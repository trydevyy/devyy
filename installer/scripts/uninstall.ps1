# Open the Devyy uninstaller from PowerShell or Windows Installed apps.
param([switch]$Silent)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSCommandPath
$args = @('--uninstall', '--install-dir', $root)
if ($Silent) { $args += '--silent' }
& (Join-Path $root 'Uninstall Devyy.exe') @args
exit $LASTEXITCODE
