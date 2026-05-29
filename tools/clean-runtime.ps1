param(
  [switch]$IncludeDependencies,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$ProjectRootWithSep = $ProjectRoot.TrimEnd("\") + "\"

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

$BytecodeFiles = @(
  "plugins.js.jsc",
  "rpg_core.js.jsc",
  "rpg_managers.js.jsc",
  "rpg_objects.js.jsc",
  "rpg_scenes.js.jsc",
  "rpg_sprites.js.jsc",
  "rpg_windows.js.jsc",
  "TK_Expand.js.jsc"
)

$GeneratedSaveHarnessFiles = @("probe-result.json")
$DependencyDirs = @("tools\node_modules", "runtime\save-harness\node_modules")

function Resolve-FullPath {
  param([string]$Path)
  if (Test-Path -LiteralPath $Path) {
    return (Resolve-Path -LiteralPath $Path).Path
  }
  return [System.IO.Path]::GetFullPath($Path)
}

function Assert-InProject {
  param([string]$Path)
  $fullPath = Resolve-FullPath -Path $Path
  if ($fullPath -ne $ProjectRoot -and -not $fullPath.StartsWith($ProjectRootWithSep, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove outside project: $fullPath"
  }
}

function Remove-GeneratedItem {
  param(
    [string]$Path,
    [switch]$AllowRegularDirectory
  )

  Assert-InProject -Path $Path
  if (-not (Test-Path -LiteralPath $Path)) {
    return 0
  }

  $item = Get-Item -LiteralPath $Path -Force
  if ($item.PSIsContainer -and -not $item.LinkType -and -not $AllowRegularDirectory) {
    throw "Refusing to remove non-link directory: $Path"
  }

  if ($DryRun) {
    Write-Host "Would remove $Path"
  } else {
    if ($item.PSIsContainer -and -not $item.LinkType) {
      Remove-Item -LiteralPath $Path -Recurse -Force
    } else {
      Remove-Item -LiteralPath $Path -Force
    }
    Write-Host "Removed $Path"
  }
  return 1
}

$removed = 0

foreach ($targetRel in $Targets) {
  $targetDir = Join-Path $ProjectRoot $targetRel

  foreach ($file in $RuntimeFiles) {
    $removed += Remove-GeneratedItem -Path (Join-Path $targetDir $file)
  }

  foreach ($dir in $RuntimeDirs) {
    $removed += Remove-GeneratedItem -Path (Join-Path $targetDir $dir)
  }
}

$saveHarness = Join-Path $ProjectRoot "runtime\save-harness"
foreach ($file in $BytecodeFiles + $GeneratedSaveHarnessFiles) {
  $removed += Remove-GeneratedItem -Path (Join-Path $saveHarness $file)
}

if ($IncludeDependencies) {
  foreach ($dir in $DependencyDirs) {
    $removed += Remove-GeneratedItem -Path (Join-Path $ProjectRoot $dir) -AllowRegularDirectory
  }
}

if ($DryRun) {
  Write-Host "Dry run complete. $removed generated paths would be removed."
} else {
  Write-Host "Runtime generated artifacts cleaned. Removed $removed paths."
}
