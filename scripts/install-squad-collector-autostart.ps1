#Requires -RunAsAdministrator
<#
  Установить автозапуск коллектора Squad при входе в Windows.
  Запуск (PowerShell от админа):
    Set-ExecutionPolicy -Scope Process Bypass -Force
    .\install-squad-collector-autostart.ps1
#>
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$cmd = Join-Path $here "start-squad-collector-watchdog-silent.cmd"
$taskName = "BB-Squad-Log-Collector"

if (-not (Test-Path $cmd)) {
  throw "Missing $cmd"
}

# Убрать старую задачу, если есть
schtasks /Delete /TN $taskName /F 2>$null | Out-Null

# При входе пользователя (24/7 пока ПК включён и сессия есть)
$action = "\"$cmd\""
schtasks /Create /TN $taskName /TR $action /SC ONLOGON /RL HIGHEST /F
if ($LASTEXITCODE -ne 0) { throw "schtasks create failed: $LASTEXITCODE" }

Write-Host "OK: scheduled task '$taskName' -> $cmd"
Write-Host "Start now..."
schtasks /Run /TN $taskName
Write-Host "Done. Check: schtasks /Query /TN $taskName"
