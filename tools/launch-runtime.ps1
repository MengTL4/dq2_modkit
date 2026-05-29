param(
  [string]$GameRoot,
  [string]$NpmRegistry
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "modkit-config.ps1")
$GameRoot = Resolve-Dq2GameRoot -ProjectRoot $ProjectRoot -GameRoot $GameRoot
Set-Dq2RuntimeEnvironment -ProjectRoot $ProjectRoot -GameRoot $GameRoot
$Runtime = Join-Path $ProjectRoot "runtime\trainer"
$GameExe = Join-Path $Runtime "Game.exe"

if (-not (Test-Path -LiteralPath $GameExe)) {
  & (Join-Path $PSScriptRoot "setup-runtime.ps1") -GameRoot $GameRoot -NpmRegistry $NpmRegistry
}

if (-not (Test-Path -LiteralPath $GameExe)) {
  throw "Trainer runtime Game.exe not found after setup: $GameExe"
}

Start-Process -FilePath $GameExe -WorkingDirectory $Runtime
