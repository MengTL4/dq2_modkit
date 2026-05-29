param(
  [string]$GameRoot,
  [string]$NpmRegistry
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "modkit-config.ps1")
$GameRoot = Resolve-Dq2GameRoot -ProjectRoot $ProjectRoot -GameRoot $GameRoot
Set-Dq2RuntimeEnvironment -ProjectRoot $ProjectRoot -GameRoot $GameRoot
$Gui = Join-Path $ProjectRoot "app\gui"
$GameExe = Join-Path $Gui "Game.exe"
$AppTs = Join-Path $Gui "app.ts"
$AppJs = Join-Path $Gui "app.js"

function Invoke-GuiBuildIfNeeded {
  if (-not (Test-Path -LiteralPath $AppTs)) { return }
  $needsBuild = -not (Test-Path -LiteralPath $AppJs)
  if (-not $needsBuild) {
    $needsBuild = (Get-Item -LiteralPath $AppTs).LastWriteTimeUtc -gt (Get-Item -LiteralPath $AppJs).LastWriteTimeUtc
  }
  if (-not $needsBuild) { return }

  $Registry = $NpmRegistry
  if (-not $Registry) { $Registry = $env:DQ2_NPM_REGISTRY }
  if (-not $Registry) { $Registry = "https://registry.npmmirror.com" }
  $npmCommand = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
  if (-not $npmCommand) {
    $npmCommand = (Get-Command npm -ErrorAction Stop).Source
  }

  if (-not (Test-Path -LiteralPath (Join-Path $Gui "node_modules"))) {
    Push-Location $Gui
    try {
      & $npmCommand install --registry $Registry
      if ($LASTEXITCODE -ne 0) { throw "GUI npm install failed with exit code $LASTEXITCODE" }
    } finally {
      Pop-Location
    }
  }

  Push-Location $Gui
  try {
    & $npmCommand run build
    if ($LASTEXITCODE -ne 0) { throw "GUI TypeScript build failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

Invoke-GuiBuildIfNeeded

if (-not (Test-Path -LiteralPath $GameExe)) {
  & (Join-Path $PSScriptRoot "setup-runtime.ps1") -GameRoot $GameRoot -NpmRegistry $NpmRegistry
}

if (-not (Test-Path -LiteralPath $GameExe)) {
  throw "Trainer GUI runtime not found after setup: $GameExe"
}

Start-Process -FilePath $GameExe -WorkingDirectory $Gui
