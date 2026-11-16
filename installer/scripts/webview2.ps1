$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$path = $env:DEVYY_WEBVIEW_BOOTSTRAPPER
Invoke-WebRequest -UseBasicParsing -Uri 'https://go.microsoft.com/fwlink/p/?LinkId=2124703' -OutFile $path -TimeoutSec 90
$signature = Get-AuthenticodeSignature -LiteralPath $path
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'Microsoft Corporation') { throw 'The WebView2 download did not pass Microsoft signature verification.' }
$process = Start-Process -FilePath $path -ArgumentList '/install' -PassThru -Wait
if ($process.ExitCode -ne 0) { throw "Microsoft WebView2 setup exited with code $($process.ExitCode)." }
