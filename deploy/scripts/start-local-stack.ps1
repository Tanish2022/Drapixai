param(
  [switch]$SkipDocker,
  [switch]$SkipApi,
  [switch]$SkipWeb,
  [switch]$SkipAi,
  [switch]$SkipAiWorker,
  [switch]$NoPreflight,
  [int]$StartupWaitSeconds = 8
)

$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$logsDir = Join-Path $repoRoot "runtime\logs"
New-Item -ItemType Directory -Force -Path $logsDir | Out-Null

function Normalize-ProcessPathEnvironment {
  # Some automation shells inject both PATH and Path. Start-Process treats those
  # as duplicate dictionary keys on Windows and fails before launching anything.
  $processPath = [Environment]::GetEnvironmentVariable("Path", [EnvironmentVariableTarget]::Process)
  if ($processPath) {
    [Environment]::SetEnvironmentVariable("PATH", $null, [EnvironmentVariableTarget]::Process)
    [Environment]::SetEnvironmentVariable("Path", $processPath, [EnvironmentVariableTarget]::Process)
  }
}

Normalize-ProcessPathEnvironment

function New-LocalSecret {
  $bytes = New-Object byte[] 48
  $generator = [Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $generator.GetBytes($bytes)
  } finally {
    $generator.Dispose()
  }
  return [Convert]::ToBase64String($bytes)
}

function Initialize-LocalRuntimeSecrets {
  $secretFile = Join-Path $repoRoot "runtime\local-stack.env"
  $requiredKeys = @(
    "DASHBOARD_SESSION_SECRET",
    "ADMIN_SESSION_SECRET",
    "DRAPIXAI_DASHBOARD_PROXY_TOKEN",
    "DRAPIXAI_AUTH_SYNC_TOKEN"
  )
  $values = @{}

  if (Test-Path -LiteralPath $secretFile) {
    foreach ($line in Get-Content -LiteralPath $secretFile) {
      if ($line -match '^([A-Z0-9_]+)=(.+)$') {
        $values[$Matches[1]] = $Matches[2].Trim()
      }
    }
  }

  foreach ($key in $requiredKeys) {
    if (-not $values.ContainsKey($key) -or $values[$key].Length -lt 32) {
      $values[$key] = New-LocalSecret
    }
    [Environment]::SetEnvironmentVariable($key, $values[$key], [EnvironmentVariableTarget]::Process)
  }

  $requiredKeys | ForEach-Object { "$_=$($values[$_])" } |
    Set-Content -LiteralPath $secretFile -Encoding ASCII
}

Initialize-LocalRuntimeSecrets

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

function Test-AiWorkerReady {
  param([string]$PythonPath)

  $check = @"
from rq import Worker
from drapixai_ai.configs.settings import settings
from drapixai_ai.queue.redis_queue import get_redis

ready = any(
    settings.queue_name in worker.queue_names() and worker.get_state() in {"idle", "busy"}
    for worker in Worker.all(connection=get_redis())
)
raise SystemExit(0 if ready else 1)
"@
  & $PythonPath -c $check *> $null
  return $LASTEXITCODE -eq 0
}

function Start-LoggedWorker {
  param([string]$PythonPath)

  if (Test-AiWorkerReady -PythonPath $PythonPath) {
    Write-Host "[SKIP] local-ai-worker already registered with Redis"
    return
  }

  $stdout = Join-Path $logsDir "local-ai-worker.out.log"
  $stderr = Join-Path $logsDir "local-ai-worker.err.log"
  Write-Host "[START] local-ai-worker"
  Start-Process `
    -FilePath $PythonPath `
    -ArgumentList @("-m", "drapixai_ai.worker.gpu_worker") `
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

if (-not $SkipAiWorker) {
  $pythonPath = Join-Path $repoRoot ".venv\Scripts\python.exe"
  if (-not (Test-Path $pythonPath)) {
    throw "Python venv not found: $pythonPath"
  }
  Start-LoggedWorker -PythonPath $pythonPath
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
Write-Host "  $logsDir\local-ai-worker.out.log"
Write-Host "  $logsDir\local-ai-worker.err.log"
