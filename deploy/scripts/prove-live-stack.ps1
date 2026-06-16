param(
  [string]$ApiUrl = $env:API_URL,
  [string]$AiUrl = $env:AI_URL,
  [string]$WebUrl = $env:WEB_URL
)

$ErrorActionPreference = "Stop"

if (-not $ApiUrl) {
  Write-Error "Set API_URL or pass -ApiUrl before running prove-live-stack.ps1"
}

function Get-Json {
  param([string]$Url)
  Invoke-RestMethod -Uri $Url -Method Get -TimeoutSec 20
}

function Assert-Check {
  param([string]$Name, [bool]$Condition, [object]$Payload)
  if (-not $Condition) {
    Write-Host ($Payload | ConvertTo-Json -Depth 8)
    throw "$Name failed"
  }
  Write-Host "[PASS] $Name"
}

$apiHealth = Get-Json "$($ApiUrl.TrimEnd('/'))/health"
Assert-Check "API /health" ($apiHealth.status -eq "ok") $apiHealth

$apiReady = Get-Json "$($ApiUrl.TrimEnd('/'))/ready"
Assert-Check "API /ready status" ($apiReady.status -eq "ready") $apiReady
Assert-Check "Database ready through API" ($apiReady.checks.database.ready -eq $true) $apiReady
Assert-Check "Redis ready through API" ($apiReady.checks.redis -eq $true) $apiReady
Assert-Check "AI ready through API" ($apiReady.checks.ai.status -eq "ready") $apiReady

if ($AiUrl) {
  $aiHealth = Get-Json "$($AiUrl.TrimEnd('/'))/health"
  Assert-Check "AI /health" ($aiHealth.status -eq "ok") $aiHealth
  $aiReady = Get-Json "$($AiUrl.TrimEnd('/'))/ready"
  Assert-Check "AI /ready" ($aiReady.status -eq "ready") $aiReady
}

if ($WebUrl) {
  $webHealth = Get-Json "$($WebUrl.TrimEnd('/'))/api/health"
  Assert-Check "Web /api/health" ($webHealth.status -eq "ok") $webHealth
}

Write-Host "Live stack proof completed."
