$ErrorActionPreference = "Stop"

function Resolve-Dq2GameRoot {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,
    [string]$GameRoot
  )

  $candidates = New-Object System.Collections.Generic.List[object]
  $currentLocation = (Get-Location).Path

  if ($GameRoot) {
    $candidates.Add([pscustomobject]@{ Value = [string]$GameRoot; Base = $currentLocation })
  }

  $configPath = Join-Path $ProjectRoot "config.local.json"
  if (Test-Path -LiteralPath $configPath) {
    try {
      $config = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json
      if ($config.gameRoot) {
        $candidates.Add([pscustomobject]@{ Value = [string]$config.gameRoot; Base = $ProjectRoot })
      }
    } catch {
      throw "Invalid config.local.json: $($_.Exception.Message)"
    }
  }

  $candidates.Add([pscustomobject]@{ Value = (Join-Path $ProjectRoot ".."); Base = $ProjectRoot })

  if ($env:DQ2_GAME_ROOT) {
    $candidates.Add([pscustomobject]@{ Value = [string]$env:DQ2_GAME_ROOT; Base = $ProjectRoot })
  }

  foreach ($candidate in $candidates) {
    if (-not $candidate.Value) { continue }

    $expanded = [Environment]::ExpandEnvironmentVariables($candidate.Value)
    if (-not [System.IO.Path]::IsPathRooted($expanded)) {
      $expanded = Join-Path $candidate.Base $expanded
    }

    $fullPath = [System.IO.Path]::GetFullPath($expanded)
    $indexPath = Join-Path $fullPath "www\index.html"
    if ((Test-Path -LiteralPath $fullPath) -and (Test-Path -LiteralPath $indexPath)) {
      return (Resolve-Path -LiteralPath $fullPath).Path
    }
  }

  throw "Game root not found. Copy config.example.json to config.local.json and set gameRoot to the game directory that contains www\index.html."
}

function Set-Dq2RuntimeEnvironment {
  param(
    [Parameter(Mandatory = $true)]
    [string]$ProjectRoot,
    [Parameter(Mandatory = $true)]
    [string]$GameRoot
  )

  $env:DQ2_MODKIT_ROOT = (Resolve-Path -LiteralPath $ProjectRoot).Path
  $env:DQ2_GAME_ROOT = (Resolve-Path -LiteralPath $GameRoot).Path
}
