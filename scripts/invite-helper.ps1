# Invite helper to both BB repos. Usage:
#   .\scripts\invite-helper.ps1 -GitHubLogin someuser
param(
  [Parameter(Mandatory = $true)]
  [string]$GitHubLogin
)

$ErrorActionPreference = "Stop"
$login = $GitHubLogin.Trim()
if (-not $login) { throw "GitHubLogin is empty" }

Write-Host "Inviting @$login to KeechBB/bb-squad-platform (push)..."
gh api -X PUT "repos/KeechBB/bb-squad-platform/collaborators/$login" -f permission=push
Write-Host "Inviting @$login to KeechBB/blackberry-kv (push)..."
gh api -X PUT "repos/KeechBB/blackberry-kv/collaborators/$login" -f permission=push
Write-Host "Done. Helper must accept invites on GitHub."
