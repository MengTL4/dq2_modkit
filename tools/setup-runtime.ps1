param(
  [switch]$Force,
  [string]$GameRoot,
  [string]$NpmRegistry
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
. (Join-Path $PSScriptRoot "modkit-config.ps1")
$GameRoot = Resolve-Dq2GameRoot -ProjectRoot $ProjectRoot -GameRoot $GameRoot
Set-Dq2RuntimeEnvironment -ProjectRoot $ProjectRoot -GameRoot $GameRoot

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
    [string]$Label,
    [string]$NpmRegistry
  )

  $modules = Join-Path $Directory "node_modules"
  if (Test-Path -LiteralPath $modules) { return }

  $registries = New-Object System.Collections.Generic.List[string]
  if ($NpmRegistry) {
    $registries.Add($NpmRegistry)
  } elseif ($env:DQ2_NPM_REGISTRY) {
    $registries.Add($env:DQ2_NPM_REGISTRY)
  } else {
    $registries.Add("https://registry.npmmirror.com")
  }

  Write-Host "Installing $Label dependencies..."
  Push-Location $Directory
  try {
    $npmCommand = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
    if (-not $npmCommand) {
      $npmCommand = (Get-Command npm -ErrorAction Stop).Source
    }

    $lastExitCode = 0
    $lastRegistry = $null
    foreach ($registry in $registries) {
      $lastRegistry = $registry
      Write-Host "Using npm registry: $registry"
      & $npmCommand install --omit=dev --registry $registry
      $lastExitCode = $LASTEXITCODE
      if ($lastExitCode -eq 0) { return }
      Write-Warning "$Label npm install failed with registry $registry, exit code $lastExitCode"
    }

    if ($lastExitCode -ne 0) {
      throw "$Label npm install failed with registry $lastRegistry, exit code $lastExitCode"
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
  if ($item.PSIsContainer -and $item.LinkType) {
    [System.IO.Directory]::Delete($item.FullName, $false)
  } else {
    Remove-Item -LiteralPath $Path -Force
  }
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
      try {
        New-Item -ItemType HardLink -Path $dest -Target $source -ErrorAction Stop | Out-Null
      } catch {
        Copy-Item -LiteralPath $source -Destination $dest -Force
      }
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

Install-NodeDependencies -Directory $PSScriptRoot -Label "tools" -NpmRegistry $NpmRegistry
Install-NodeDependencies -Directory (Join-Path $ProjectRoot "runtime\save-harness") -Label "save-harness" -NpmRegistry $NpmRegistry

Write-Host "Runtime links refreshed from $GameRoot"
