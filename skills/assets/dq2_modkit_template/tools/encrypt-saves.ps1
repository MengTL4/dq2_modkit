param(
  [string]$InputDir,
  [string]$OutputDir,
  [int[]]$Ids = @(0, 1, 3),
  [switch]$NoConfig
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not $InputDir) {
  $InputDir = Join-Path $ProjectRoot "output\extract\save"
}
if (-not $OutputDir) {
  $OutputDir = Join-Path $ProjectRoot "output\repack\save"
}

$ArgsList = @(
  (Join-Path $PSScriptRoot "encrypt-saves.mjs"),
  "--input", $InputDir,
  "--output", $OutputDir,
  "--ids", ($Ids -join ",")
)

if ($NoConfig) {
  $ArgsList += "--no-config"
}

& node @ArgsList

if ($LASTEXITCODE -ne 0) {
  throw "encrypt-saves.mjs failed with exit code $LASTEXITCODE"
}

Get-ChildItem -LiteralPath $OutputDir | Select-Object Name, Length
