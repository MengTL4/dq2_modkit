param(
  [int]$Port = 5174,
  [string]$NpmRegistry,
  [switch]$NoOpen
)

$ErrorActionPreference = "Stop"

$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Editor = Join-Path $ProjectRoot "app\save-editor"
$Modules = Join-Path $Editor "node_modules"
$Registry = $NpmRegistry
if (-not $Registry) { $Registry = $env:DQ2_NPM_REGISTRY }
if (-not $Registry) { $Registry = "https://registry.npmmirror.com" }

$npmCommand = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npmCommand) {
  $npmCommand = (Get-Command npm -ErrorAction Stop).Source
}

if (-not (Test-Path -LiteralPath $Modules)) {
  Push-Location $Editor
  try {
    Write-Host "Installing save editor dependencies with npm registry: $Registry"
    & $npmCommand install --registry $Registry
    if ($LASTEXITCODE -ne 0) {
      throw "save editor npm install failed with registry $Registry, exit code $LASTEXITCODE"
    }
  } finally {
    Pop-Location
  }
}

$url = "http://127.0.0.1:$Port"
$logPath = Join-Path $ProjectRoot "output\save-editor-vite.log"
$errPath = Join-Path $ProjectRoot "output\save-editor-vite.err.log"
New-Item -ItemType Directory -Path (Join-Path $ProjectRoot "output") -Force | Out-Null

function Test-SaveEditorServer {
  param([string]$Url)
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

if (Test-SaveEditorServer -Url $url) {
  if (-not $NoOpen) {
    Start-Process $url
  }
  Write-Host "Save editor already running at $url"
  return
}

Start-Process -FilePath $npmCommand `
  -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", [string]$Port, "--strictPort") `
  -WorkingDirectory $Editor `
  -WindowStyle Hidden `
  -RedirectStandardOutput $logPath `
  -RedirectStandardError $errPath

Start-Sleep -Milliseconds 900
if (-not $NoOpen) {
  Start-Process $url
}

Write-Host "Save editor started at $url"
Write-Host "Logs: $logPath"
