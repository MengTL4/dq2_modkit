$ErrorActionPreference = "Stop"

$ToolDir = $PSScriptRoot

& (Join-Path $ToolDir "setup-runtime.ps1")

& node (Join-Path $ToolDir "extract-data-pak.mjs")
if ($LASTEXITCODE -ne 0) { throw "extract-data-pak.mjs failed with exit code $LASTEXITCODE" }

& node (Join-Path $ToolDir "extract-usedata.mjs")
if ($LASTEXITCODE -ne 0) { throw "extract-usedata.mjs failed with exit code $LASTEXITCODE" }

& (Join-Path $ToolDir "extract-saves.ps1")
