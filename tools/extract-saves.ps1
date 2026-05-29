param(
  [string]$GameRoot,
  [string]$NpmRegistry
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "modkit-config.ps1")
$GameRoot = Resolve-Dq2GameRoot -ProjectRoot $ProjectRoot -GameRoot $GameRoot
Set-Dq2RuntimeEnvironment -ProjectRoot $ProjectRoot -GameRoot $GameRoot
$Runtime = Join-Path $ProjectRoot "runtime\save-harness"
$GameExe = Join-Path $Runtime "Game.exe"

if (-not (Test-Path -LiteralPath $GameExe)) {
  & (Join-Path $PSScriptRoot "setup-runtime.ps1") -GameRoot $GameRoot -NpmRegistry $NpmRegistry
}

if (-not (Test-Path -LiteralPath $GameExe)) {
  throw "NW runtime harness is missing after setup: $GameExe"
}

Start-Process -FilePath $GameExe -WorkingDirectory $Runtime -WindowStyle Hidden -Wait

$OutDir = Join-Path $ProjectRoot "output\extract\save"
Get-ChildItem -LiteralPath $OutDir | Select-Object Name, Length
