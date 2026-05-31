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
$ExtractDataDir = Join-Path $ProjectRoot "output\extract\data"
$DataPak = Join-Path $GameRoot "www\data.pak"
$GuiCache = Join-Path $ExtractDataDir "_gui-cache.json"

function Test-GuiDataExtractReady {
  if (-not (Test-Path -LiteralPath $ExtractDataDir)) { return $false }
  $requiredFiles = @(
    "_index.json",
    "System.json",
    "Items.json",
    "Weapons.json",
    "Armors.json",
    "Actors.json",
    "Skills.json",
    "MapInfos.json",
    "Troops.json",
    "Enemies.json",
    "CommonEvents.json"
  )
  foreach ($fileName in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $ExtractDataDir $fileName))) {
      return $false
    }
  }
  $indexPath = Join-Path $ExtractDataDir "_index.json"
  if ((Test-Path -LiteralPath $DataPak) -and (Test-Path -LiteralPath $indexPath)) {
    if ((Get-Item -LiteralPath $DataPak).LastWriteTimeUtc -gt (Get-Item -LiteralPath $indexPath).LastWriteTimeUtc) {
      return $false
    }
  }
  return $true
}

function Invoke-DataExtractIfNeeded {
  if (Test-GuiDataExtractReady) { return }
  Write-Host "Extracted data not found or stale. Extracting www/data.pak for GUI lists..."
  & node (Join-Path $PSScriptRoot "extract-data-pak.mjs")
  if ($LASTEXITCODE -ne 0) { throw "extract-data-pak.mjs failed with exit code $LASTEXITCODE" }
}

function Test-GuiCacheReady {
  if (-not (Test-GuiDataExtractReady)) { return $false }
  if (-not (Test-Path -LiteralPath $GuiCache)) { return $false }
  $cacheTime = (Get-Item -LiteralPath $GuiCache).LastWriteTimeUtc
  $requiredFiles = @(
    "MapInfos.json",
    "Troops.json",
    "Enemies.json",
    "Items.json",
    "Weapons.json",
    "Armors.json"
  )
  foreach ($fileName in $requiredFiles) {
    $filePath = Join-Path $ExtractDataDir $fileName
    if (-not (Test-Path -LiteralPath $filePath)) { return $false }
    if ((Get-Item -LiteralPath $filePath).LastWriteTimeUtc -gt $cacheTime) { return $false }
  }
  foreach ($mapFile in Get-ChildItem -LiteralPath $ExtractDataDir -Filter "Map*.json" -File) {
    if ($mapFile.LastWriteTimeUtc -gt $cacheTime) { return $false }
  }
  return $true
}

function Invoke-GuiCacheIfNeeded {
  if (Test-GuiCacheReady) { return }
  Write-Host "Building GUI cache for map/troop lists..."
  & node (Join-Path $PSScriptRoot "build-gui-cache.mjs")
  if ($LASTEXITCODE -ne 0) { throw "build-gui-cache.mjs failed with exit code $LASTEXITCODE" }
}

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

Invoke-DataExtractIfNeeded
Invoke-GuiCacheIfNeeded
Invoke-GuiBuildIfNeeded

if (-not (Test-Path -LiteralPath $GameExe)) {
  & (Join-Path $PSScriptRoot "setup-runtime.ps1") -GameRoot $GameRoot -NpmRegistry $NpmRegistry
}

if (-not (Test-Path -LiteralPath $GameExe)) {
  throw "Trainer GUI runtime not found after setup: $GameExe"
}

Start-Process -FilePath $GameExe -WorkingDirectory $Gui
