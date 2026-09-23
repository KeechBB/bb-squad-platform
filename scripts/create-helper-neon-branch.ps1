# Create Neon branch `helper` from production (Кич, один раз).
# Needs: neonctl logged in OR NEON_API_KEY in env.
# Usage:  .\scripts\create-helper-neon-branch.ps1
$ErrorActionPreference = "Stop"

$branchName = "helper"
Write-Host "This script creates Neon branch '$branchName' from the default/production branch."
Write-Host "Install CLI if needed: npm i -g neonctl   then: neonctl auth"
Write-Host ""

$neon = Get-Command neonctl -ErrorAction SilentlyContinue
if (-not $neon) {
  Write-Host "neonctl not found. Manual steps:"
  Write-Host "  1) https://console.neon.tech → project bb-squad"
  Write-Host "  2) Branches → Create branch → name: helper → parent: production"
  Write-Host "  3) Connect → copy connection string → give to helper as DATABASE_URL"
  Write-Host "  4) Keep production string only on Keech PC + VPS"
  exit 0
}

# List projects / branches — interactive enough for Keech
neonctl projects list
Write-Host ""
Write-Host "Pick project id for bb-squad, then run:"
Write-Host "  neonctl branches create --project-id PROJECT_ID --name $branchName --parent production"
Write-Host "  neonctl connection-string $branchName --project-id PROJECT_ID"
Write-Host ""
Write-Host "Paste that URL into helper .env as DATABASE_URL (not into git/chat)."
