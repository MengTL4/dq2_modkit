param(
  [int]$Port = 5174,
  [int]$PortSearchLimit = 20,
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
    if ($response.StatusCode -lt 200 -or $response.StatusCode -ge 500) {
      return $false
    }

    $content = [string]$response.Content
    return $content.Contains('name="dq2-modkit-app" content="save-editor"') -or
      $content.Contains("<title>大千世界2 存档编辑器</title>")
  } catch {
    return $false
  }
}

function Test-LocalPortInUse {
  param([int]$Port)
  $listeners = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners()
  foreach ($listener in $listeners) {
    if ($listener.Port -ne $Port) {
      continue
    }

    $address = $listener.Address
    if ($address.Equals([System.Net.IPAddress]::Loopback) -or
      $address.Equals([System.Net.IPAddress]::Any) -or
      $address.Equals([System.Net.IPAddress]::IPv6Loopback) -or
      $address.Equals([System.Net.IPAddress]::IPv6Any)) {
      return $true
    }
  }

  return $false
}

$selectedPort = $null
for ($candidatePort = $Port; $candidatePort -lt ($Port + $PortSearchLimit); $candidatePort++) {
  $candidateUrl = "http://127.0.0.1:$candidatePort"
  if (Test-SaveEditorServer -Url $candidateUrl) {
    if (-not $NoOpen) {
      Start-Process $candidateUrl
    }
    Write-Host "Save editor already running at $candidateUrl"
    return
  }

  if (-not (Test-LocalPortInUse -Port $candidatePort)) {
    $selectedPort = $candidatePort
    $url = $candidateUrl
    break
  }

  Write-Host "Port $candidatePort is in use by another app; trying next port."
}

if ($null -eq $selectedPort) {
  throw "No free port found from $Port to $($Port + $PortSearchLimit - 1)."
}

if ($selectedPort -ne $Port) {
  Write-Host "Using save editor port $selectedPort instead of $Port."
}

if (Test-SaveEditorServer -Url $url) {
  if (-not $NoOpen) {
    Start-Process $url
  }
  Write-Host "Save editor already running at $url"
  return
}

$viteProcess = Start-Process -FilePath $npmCommand `
  -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", [string]$selectedPort, "--strictPort") `
  -WorkingDirectory $Editor `
  -WindowStyle Hidden `
  -RedirectStandardOutput $logPath `
  -RedirectStandardError $errPath `
  -PassThru

$started = $false
for ($attempt = 0; $attempt -lt 20; $attempt++) {
  Start-Sleep -Milliseconds 250
  if (Test-SaveEditorServer -Url $url) {
    $started = $true
    break
  }
  if ($viteProcess.HasExited) {
    break
  }
}

if (-not $started) {
  throw "Save editor did not start at $url. Check logs: $logPath and $errPath"
}

if (-not $NoOpen) {
  Start-Process $url
}

Write-Host "Save editor started at $url"
Write-Host "Logs: $logPath"
