# Deploy BB platform: commit+push to GitHub, then VPS hard-reset deploy.
# Usage (from PC):
#   powershell -File scripts/deploy_from_pc.ps1
#   powershell -File scripts/deploy_from_pc.ps1 -Message "fix profile lag"
# Optional: -SkipCommit  (only push existing commits + deploy)
param(
  [string]$Message = "",
  [switch]$SkipCommit
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $Root

$key = Join-Path $env:USERPROFILE ".ssh\bb_vps_ed25519"
if (-not (Test-Path $key)) {
  throw "SSH key missing: $key"
}

function Get-DeployPaths {
  git status --porcelain -- src docs/CHANGELOG.md scripts/deploy.sh scripts/deploy_from_pc.ps1 package.json package-lock.json next.config.ts prisma public/bp-assets public/profile-bgs 2>$null
}

Write-Host "==> platform root: $Root"

$dirty = @(Get-DeployPaths | Where-Object { $_ -and $_.Trim() })
if (-not $SkipCommit -and $dirty.Count -gt 0) {
  Write-Host "==> commit deploy-relevant changes ($($dirty.Count) lines):"
  $dirty | ForEach-Object { Write-Host "  $_" }
  git add -- src docs/CHANGELOG.md scripts/deploy.sh scripts/deploy_from_pc.ps1 package.json package-lock.json next.config.ts prisma public/bp-assets public/profile-bgs
  if ([string]::IsNullOrWhiteSpace($Message)) {
    $Message = "Deploy $(Get-Date -Format 'yyyy-MM-dd HH:mm') · sync GitHub before VPS"
  }
  git commit -m $Message
} elseif (-not $SkipCommit) {
  Write-Host "==> no deploy-relevant local changes to commit"
} else {
  Write-Host "==> SkipCommit — using existing commits"
}

$ahead = git rev-list --count "origin/main..HEAD" 2>$null
if (-not $ahead) { $ahead = "0" }
Write-Host "==> commits ahead of origin/main: $ahead"
git push origin main

$sha = (git rev-parse --short HEAD).Trim()
Write-Host "==> SSH deploy HEAD=$sha (VPS will reset --hard origin/main)"
ssh -i $key -o ConnectTimeout=30 root@178.72.181.111 "cd /var/www/bb-squad-platform && bash scripts/deploy.sh"
if ($LASTEXITCODE -ne 0) {
  throw "VPS deploy failed (exit $LASTEXITCODE)"
}
Write-Host "==> OK deployed $sha"
