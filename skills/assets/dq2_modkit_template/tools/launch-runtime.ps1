$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Runtime = Join-Path $ProjectRoot "runtime\trainer"
$GameExe = Join-Path $Runtime "Game.exe"

if (-not (Test-Path -LiteralPath $GameExe)) {
  & (Join-Path $PSScriptRoot "setup-runtime.ps1")
}

if (-not (Test-Path -LiteralPath $GameExe)) {
  throw "Trainer runtime Game.exe not found after setup: $GameExe"
}

Start-Process -FilePath $GameExe -WorkingDirectory $Runtime
