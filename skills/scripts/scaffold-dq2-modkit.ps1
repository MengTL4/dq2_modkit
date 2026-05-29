param(
  [string]$GameRoot = (Get-Location).Path,
  [switch]$Force,
  [switch]$RunSetup,
  [switch]$DryRun
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$SkillRoot = (Resolve-Path (Join-Path $ScriptDir "..")).Path
$TemplateRoot = Join-Path $SkillRoot "assets\dq2_modkit_template"

if (-not (Test-Path -LiteralPath $TemplateRoot)) {
  throw "Template not found: $TemplateRoot"
}

$ResolvedGameRoot = (Resolve-Path -LiteralPath $GameRoot).Path
$WwwDir = Join-Path $ResolvedGameRoot "www"
if (-not (Test-Path -LiteralPath $WwwDir)) {
  throw "Game root does not contain www: $ResolvedGameRoot"
}

$Destination = Join-Path $ResolvedGameRoot "dq2_modkit"
if ((Test-Path -LiteralPath $Destination) -and -not $Force) {
  if ($DryRun) {
    Write-Host "Destination already exists; actual copy would require -Force: $Destination"
  } else {
    throw "Destination already exists. Use -Force to overwrite template files: $Destination"
  }
}

Write-Host "Template: $TemplateRoot"
Write-Host "Game root: $ResolvedGameRoot"
Write-Host "Destination: $Destination"

if ($DryRun) {
  Write-Host "Dry run: no files copied."
  if ($RunSetup) {
    Write-Host "Dry run: setup-runtime.ps1 would be executed after copy."
  }
  exit 0
}

New-Item -ItemType Directory -Force -Path $Destination | Out-Null
Copy-Item -Path (Join-Path $TemplateRoot "*") -Destination $Destination -Recurse -Force

$generatedDirs = @(
  "runtime\bridge-state",
  "output\extract",
  "output\repack",
  "output\backup"
)

foreach ($dir in $generatedDirs) {
  New-Item -ItemType Directory -Force -Path (Join-Path $Destination $dir) | Out-Null
}

if ($RunSetup) {
  & (Join-Path $Destination "tools\setup-runtime.ps1")
  if ($LASTEXITCODE -ne 0) {
    throw "setup-runtime.ps1 failed with exit code $LASTEXITCODE"
  }
}

Write-Host "dq2_modkit scaffolded at $Destination"
