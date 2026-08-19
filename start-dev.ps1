# Launches dev server fully detached, writing logs to files.
$script = Join-Path $PSScriptRoot "run-dev.ps1"
$out = Join-Path $PSScriptRoot "dev-server.log"
$err = Join-Path $PSScriptRoot "dev-server.err.log"
if (Test-Path $out) { Remove-Item $out }
if (Test-Path $err) { Remove-Item $err }
Start-Process -FilePath "powershell.exe" `
  -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File","`"$script`"" `
  -RedirectStandardOutput $out `
  -RedirectStandardError $err `
  -WindowStyle Hidden `
  -PassThru | Select-Object Id, StartTime | Format-List