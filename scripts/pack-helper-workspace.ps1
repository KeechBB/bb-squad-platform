# Pack shareable workspace bits for a helper (no secrets / no finances).
# Output: Desktop\bb-helper-workspace-YYYYMMDD.zip
$ErrorActionPreference = "Stop"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
# $PSScriptRoot = .../platform/scripts → parent platform → parent = Новый Проект Кича
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$stamp = Get-Date -Format "yyyyMMdd"
$stage = Join-Path $env:TEMP "bb-helper-workspace-$stamp"
$zip = Join-Path ([Environment]::GetFolderPath("Desktop")) "bb-helper-workspace-$stamp.zip"

if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Path $stage | Out-Null

function Copy-Tree($rel) {
  $src = Join-Path $projectRoot $rel
  if (-not (Test-Path -LiteralPath $src)) {
    Write-Warning "skip missing: $rel"
    return
  }
  $dst = Join-Path $stage $rel
  New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
  Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
  Write-Host "ok $rel"
}

# Cursor rules / skills
Copy-Tree ".cursor"

# Brand + maps (previews)
Copy-Tree "brand"
Copy-Tree "maps"

# KV work (not the git public clone — helper clones that separately)
# Exclude huge training screens if present
$kvStage = Join-Path $stage "KV"
New-Item -ItemType Directory -Force -Path $kvStage | Out-Null
foreach ($rel in @(
  "KV\previews",
  "KV\results",
  "KV\2026-09"
)) {
  $src = Join-Path $projectRoot $rel
  if (Test-Path -LiteralPath $src) {
    $dst = Join-Path $stage $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $dst) | Out-Null
    # robocopy-like: exclude screens / node-ish
    Copy-Item -LiteralPath $src -Destination $dst -Recurse -Force
    Write-Host "ok $rel"
  }
}

# Drop secrets if accidentally nested
Get-ChildItem -LiteralPath $stage -Recurse -Force -File -ErrorAction SilentlyContinue |
  Where-Object {
    $_.Name -match '^\.env' -or
    $_.Name -match 'squad-collector\.env' -or
    $_.Name -eq 'squad_collector_state.json'
  } |
  ForEach-Object {
    Write-Warning "removing secret-like: $($_.FullName)"
    Remove-Item -LiteralPath $_.FullName -Force
  }

# Drop heavy training screens under KV if any
$screens = Join-Path $stage "KV\public\data\training\screens"
if (Test-Path -LiteralPath $screens) {
  Remove-Item -Recurse -Force $screens
}

if (Test-Path $zip) { Remove-Item -Force $zip }
Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zip -Force
Remove-Item -Recurse -Force $stage
Write-Host ""
Write-Host "Packed: $zip"
Write-Host "Helper still needs: git clone platform + KV/public, and Neon branch .env"
