# Deploy platform to Timeweb VPS + verify.
# Usage:  pwsh scripts/deploy-prod.ps1
# Optional: -SkipVerify  -Host 91.222.237.91
param(
  [string]$VpsHost = $(if ($env:BB_VPS_HOST) { $env:BB_VPS_HOST } else { "91.222.237.91" }),
  [string]$VpsUser = "root",
  [string]$IdentityFile = $(Join-Path $env:USERPROFILE ".ssh\bb_vps_ed25519"),
  [switch]$SkipVerify
)

$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
# script lives in platform/scripts → platform root is parent
$Platform = Split-Path $PSScriptRoot -Parent
Set-Location $Platform

$sshBase = @("-o", "ConnectTimeout=20", "-o", "ServerAliveInterval=10", "-o", "BatchMode=yes")
if (Test-Path $IdentityFile) {
  $sshBase = @("-i", $IdentityFile) + $sshBase
}

function Invoke-Vps([string]$Remote) {
  & ssh @sshBase "$VpsUser@$VpsHost" $Remote
  if ($LASTEXITCODE -ne 0) { throw "SSH failed ($LASTEXITCODE): $Remote" }
}

Write-Host "==> local HEAD" -ForegroundColor Cyan
$localSha = (git rev-parse HEAD).Trim()
Write-Host "    $localSha"

Write-Host "==> SSH probe $VpsUser@$VpsHost" -ForegroundColor Cyan
Invoke-Vps "echo SSH_OK; hostname"

Write-Host "==> deploy platform" -ForegroundColor Cyan
Invoke-Vps "cd /var/www/bb-squad-platform && git pull --ff-only && bash scripts/deploy.sh"

if (-not $SkipVerify) {
  Write-Host "==> verify-deploy" -ForegroundColor Cyan
  # copy expect sha into remote verify
  & ssh @sshBase "$VpsUser@$VpsHost" "cd /var/www/bb-squad-platform && bash scripts/verify-deploy.sh --local --sha $localSha"
  if ($LASTEXITCODE -ne 0) {
    throw "verify-deploy failed"
  }
}

Write-Host "==> DONE $localSha on $VpsHost" -ForegroundColor Green
