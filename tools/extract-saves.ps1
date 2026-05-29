$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Runtime = Join-Path $ProjectRoot "runtime\save-harness"
$GameExe = Join-Path $Runtime "Game.exe"

if (-not (Test-Path -LiteralPath $GameExe)) {
  & (Join-Path $PSScriptRoot "setup-runtime.ps1")
}

if (-not (Test-Path -LiteralPath $GameExe)) {
  throw "NW runtime harness is missing after setup: $GameExe"
}

Start-Process -FilePath $GameExe -WorkingDirectory $Runtime -WindowStyle Hidden -Wait

$OutDir = Join-Path $ProjectRoot "output\extract\save"
Get-ChildItem -LiteralPath $OutDir | Select-Object Name, Length
