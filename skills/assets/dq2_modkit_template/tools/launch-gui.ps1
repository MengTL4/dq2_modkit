param(
  [string]$GameRoot
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "modkit-config.ps1")
$GameRoot = Resolve-Dq2GameRoot -ProjectRoot $ProjectRoot -GameRoot $GameRoot
Set-Dq2RuntimeEnvironment -ProjectRoot $ProjectRoot -GameRoot $GameRoot
$Gui = Join-Path $ProjectRoot "app\gui"
$GameExe = Join-Path $Gui "Game.exe"

if (-not (Test-Path -LiteralPath $GameExe)) {
  & (Join-Path $PSScriptRoot "setup-runtime.ps1") -GameRoot $GameRoot
}

if (-not (Test-Path -LiteralPath $GameExe)) {
  throw "Trainer GUI runtime not found after setup: $GameExe"
}

Start-Process -FilePath $GameExe -WorkingDirectory $Gui
