# scripts\sync-observability.ps1
# Copies shared\observability\*.ts into every service and reports drift.
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\sync-observability.ps1
# Usage:  powershell -ExecutionPolicy Bypass -File scripts\sync-observability.ps1 -CheckOnly

param([switch]$CheckOnly)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$services = 'api-gateway','auth-service','user-service','room-service','signaling-service','chat-service','sfu-service','recording-service','notification-service'
$sharedFiles = Get-ChildItem (Join-Path $root 'shared\observability') -Filter *.ts
$drift = 0

foreach ($s in $services) {
  $target = Join-Path $root "services\$s\src\observability"
  if (-not $CheckOnly) { New-Item -ItemType Directory -Force $target | Out-Null }
  foreach ($f in $sharedFiles) {
    $dest = Join-Path $target $f.Name
    if ($CheckOnly) {
      if (-not (Test-Path $dest) -or (Get-FileHash $f.FullName).Hash -ne (Get-FileHash $dest).Hash) {
        Write-Host "DRIFT: $s\src\observability\$($f.Name)" -ForegroundColor Yellow
        $drift++
      }
    } else {
      Copy-Item $f.FullName $dest -Force
    }
  }
  if (-not $CheckOnly) { Write-Host "synced $s" -ForegroundColor Green }
}

if ($CheckOnly) {
  if ($drift -gt 0) { Write-Host "$drift file(s) differ from shared\observability" -ForegroundColor Red; exit 1 }
  Write-Host 'All copies match shared\observability' -ForegroundColor Green
}

