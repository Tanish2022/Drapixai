param(
  [switch]$SkipDocker,
  [switch]$SkipApi,
  [switch]$SkipWeb,
  [switch]$SkipAi,
  [switch]$NoPreflight,
  [int]$StartupWaitSeconds = 8
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$logsDir = Join-Path $repoRoot "runtime\logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

function Test-PortListening {
  param([int]$Port)
  return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

function Start-LoggedProcess {
  param(
    [string]$Name,
    [string]$FilePath,
    [string[]]$ArgumentList,
    [int]$Port
  )

  if (Test-PortListening -Port $Port) {
    Write-Host "[SKIP] $Name already listening on port $Port"
    return
  }

  $stdout = Join-Path $logsDir "$Name.out.log"
  $stderr = Join-Path $logsDir "$Name.err.log"
  Write-Host "[START] $Name on port $Port"
  Start-Process `
    -FilePath $FilePath `
    -ArgumentList $ArgumentList `
    -WorkingDirectory $repoRoot `
    -RedirectStandardOutput $stdout `
    -RedirectStandardError $stderr `
    -WindowStyle Hidden | Out-Null
}

if (-not $SkipDocker) {
  Write-Host "[START] Docker infra: postgres redis minio"
  Push-Location $repoRoot
  try {
    docker-compose up -d postgres redis minio | Out-Host
  } finally {
    Pop-Location
  }
}

if (-not $SkipApi) {
  Start-LoggedProcess -Name "local-api" -FilePath "npm.cmd" -ArgumentList @("--prefix", "apps/api", "run", "start") -Port 8000
}

if (-not $SkipWeb) {
  Start-LoggedProcess -Name "local-web" -FilePath "npm.cmd" -ArgumentList @("--prefix", "apps/web", "run", "start") -Port 3000
}

if (-not $SkipAi) {
  $pythonPath = Join-Path $repoRoot ".venv\Scripts\python.exe"
  if (-not (Test-Path $pythonPath)) {
    throw "Python venv not found: $pythonPath"
  }
  Start-LoggedProcess `
    -Name "local-ai-api" `
    -FilePath $pythonPath `
    -ArgumentList @("-m", "uvicorn", "drapixai_ai.api.ai_server:app", "--host", "0.0.0.0", "--port", "8080") `
    -Port 8080
}

if ($StartupWaitSeconds -gt 0) {
  Start-Sleep -Seconds $StartupWaitSeconds
}

if (-not $NoPreflight) {
  & powershell -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "local-preflight.ps1")
}

Write-Host ""
Write-Host "Local DrapixAI stack startup complete."
Write-Host "Logs:"
Write-Host "  $logsDir\local-api.out.log"
Write-Host "  $logsDir\local-api.err.log"
Write-Host "  $logsDir\local-web.out.log"
Write-Host "  $logsDir\local-web.err.log"
Write-Host "  $logsDir\local-ai-api.out.log"
Write-Host "  $logsDir\local-ai-api.err.log"
