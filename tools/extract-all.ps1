param(
  [string]$GameRoot,
  [string]$NpmRegistry
)

$ErrorActionPreference = "Stop"
$ToolDir = $PSScriptRoot
$ProjectRoot = (Resolve-Path (Join-Path $ToolDir "..")).Path
. (Join-Path $ToolDir "modkit-config.ps1")
$GameRoot = Resolve-Dq2GameRoot -ProjectRoot $ProjectRoot -GameRoot $GameRoot
Set-Dq2RuntimeEnvironment -ProjectRoot $ProjectRoot -GameRoot $GameRoot

& (Join-Path $ToolDir "setup-runtime.ps1") -GameRoot $GameRoot -NpmRegistry $NpmRegistry

& node (Join-Path $ToolDir "extract-data-pak.mjs")
if ($LASTEXITCODE -ne 0) { throw "extract-data-pak.mjs failed with exit code $LASTEXITCODE" }

& node (Join-Path $ToolDir "extract-usedata.mjs")
if ($LASTEXITCODE -ne 0) { throw "extract-usedata.mjs failed with exit code $LASTEXITCODE" }

& (Join-Path $ToolDir "extract-saves.ps1") -GameRoot $GameRoot -NpmRegistry $NpmRegistry
