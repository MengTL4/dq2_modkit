param(
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$ProjectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$GameRoot = Resolve-Path (Join-Path $ProjectRoot "..")

$RuntimeFiles = @(
  "d3dcompiler_47.dll",
  "ffmpeg.dll",
  "Game.exe",
  "icudtl.dat",
  "libEGL.dll",
  "libGLESv2.dll",
  "node.dll",
  "notification_helper.exe",
  "nw_100_percent.pak",
  "nw_200_percent.pak",
  "nw_elf.dll",
  "nw.dll",
  "resources.pak",
  "v8_context_snapshot.bin"
)

$RuntimeDirs = @("Dictionaries", "locales", "swiftshader")
$Targets = @("app\gui", "runtime\trainer", "runtime\save-harness")

function Install-NodeDependencies {
  param(
    [string]$Directory,
    [string]$Label
  )

  $modules = Join-Path $Directory "node_modules"
  if (Test-Path -LiteralPath $modules) { return }

  Write-Host "Installing $Label dependencies..."
  Push-Location $Directory
  try {
    $npmCommand = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $npmCommand) {
      $npmCommand = (Get-Command npm -ErrorAction Stop).Source
    }
    & $npmCommand install --omit=dev
    if ($LASTEXITCODE -ne 0) {
      throw "$Label npm install failed with exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

function Remove-GeneratedPath {
  param([string]$Path)
  if (-not (Test-Path -LiteralPath $Path)) { return }
  $item = Get-Item -LiteralPath $Path -Force
  if ($item.PSIsContainer -and -not $item.LinkType) {
    throw "Refusing to remove non-link directory: $Path"
  }
  Remove-Item -LiteralPath $Path -Force
}

foreach ($targetRel in $Targets) {
  $targetDir = Join-Path $ProjectRoot $targetRel
  New-Item -ItemType Directory -Path $targetDir -Force | Out-Null

  foreach ($file in $RuntimeFiles) {
    $source = Join-Path $GameRoot $file
    $dest = Join-Path $targetDir $file
    if (-not (Test-Path -LiteralPath $source)) {
      throw "Game runtime file is missing: $source"
    }
    if ((Test-Path -LiteralPath $dest) -and $Force) {
      Remove-GeneratedPath -Path $dest
    }
    if (-not (Test-Path -LiteralPath $dest)) {
      New-Item -ItemType HardLink -Path $dest -Target $source | Out-Null
    }
  }

  foreach ($dir in $RuntimeDirs) {
    $source = Join-Path $GameRoot $dir
    $dest = Join-Path $targetDir $dir
    if (-not (Test-Path -LiteralPath $source)) {
      throw "Game runtime directory is missing: $source"
    }
    if ((Test-Path -LiteralPath $dest) -and $Force) {
      Remove-GeneratedPath -Path $dest
    }
    if (-not (Test-Path -LiteralPath $dest)) {
      New-Item -ItemType Junction -Path $dest -Target $source | Out-Null
    }
  }
}

& node (Join-Path $PSScriptRoot "extract-bytecode-bundles.mjs")
if ($LASTEXITCODE -ne 0) {
  throw "extract-bytecode-bundles.mjs failed with exit code $LASTEXITCODE"
}

Install-NodeDependencies -Directory $PSScriptRoot -Label "tools"
Install-NodeDependencies -Directory (Join-Path $ProjectRoot "runtime\save-harness") -Label "save-harness"

Write-Host "Runtime links refreshed from $GameRoot"
