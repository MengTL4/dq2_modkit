$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$Gui = Join-Path $ProjectRoot "app\gui"
$GameExe = Join-Path $Gui "Game.exe"

if (-not (Test-Path -LiteralPath $GameExe)) {
  & (Join-Path $PSScriptRoot "setup-runtime.ps1")
}

if (-not (Test-Path -LiteralPath $GameExe)) {
  throw "Trainer GUI runtime not found after setup: $GameExe"
}

Start-Process -FilePath $GameExe -WorkingDirectory $Gui
