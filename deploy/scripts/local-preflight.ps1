param(
  [string]$ApiEnv = "deploy/env/api.production.env",
  [string]$AiEnv = "deploy/env/ai.production.env",
  [string]$WebEnv = "deploy/env/web.production.env"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "../..")
$checks = New-Object System.Collections.Generic.List[object]

function Add-Check {
  param(
    [string]$Name,
    [bool]$Passed,
    [string]$Detail
  )
  $checks.Add([pscustomobject]@{ Name = $Name; Passed = $Passed; Detail = $Detail }) | Out-Null
}

function Test-CommandAvailable {
  param([string]$Command)
  return [bool](Get-Command $Command -ErrorAction SilentlyContinue)
}

function Test-PortOpen {
  param([string]$HostName, [int]$Port)
  try {
    $client = New-Object System.Net.Sockets.TcpClient
    $async = $client.BeginConnect($HostName, $Port, $null, $null)
    $connected = $async.AsyncWaitHandle.WaitOne(1200, $false)
    if ($connected) {
      $client.EndConnect($async)
    }
    $client.Close()
    return $connected
  } catch {
    return $false
  }
}

function Test-EnvFile {
  param([string]$RelativePath)
  $path = Join-Path $root $RelativePath
  Add-Check "Env file: $RelativePath" (Test-Path $path) $path
}

Push-Location $root
try {
  Add-Check "Workspace" (Test-Path "package.json") $root

  $dockerAvailable = Test-CommandAvailable "docker"
  Add-Check "Docker CLI" $dockerAvailable "docker command available"
  if ($dockerAvailable) {
    $previousErrorPreference = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    $dockerInfo = & docker info 2>&1
    $dockerExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorPreference
    Add-Check "Docker daemon" ($dockerExitCode -eq 0) (($dockerInfo | Select-Object -First 1) -join "")
  }

  Test-EnvFile $ApiEnv
  Test-EnvFile $AiEnv
  Test-EnvFile $WebEnv

  $venvPython = Join-Path $root ".venv/Scripts/python.exe"
  Add-Check "Python venv" (Test-Path $venvPython) $venvPython
  if (Test-Path $venvPython) {
    $importCheck = & $venvPython -c "import redis, PIL, cv2, numpy; print('ok')" 2>&1
    Add-Check "Python venv imports" ($LASTEXITCODE -eq 0) (($importCheck | Select-Object -First 1) -join "")
  }

  $ports = @(
    @{ Name = "Postgres"; Port = 5432 },
    @{ Name = "Redis"; Port = 6379 },
    @{ Name = "MinIO API"; Port = 9000 },
    @{ Name = "MinIO Console"; Port = 9001 },
    @{ Name = "API"; Port = 8000 },
    @{ Name = "Web"; Port = 3000 },
    @{ Name = "AI API"; Port = 8080 }
  )
  foreach ($port in $ports) {
    Add-Check "$($port.Name) port $($port.Port)" (Test-PortOpen "127.0.0.1" $port.Port) "127.0.0.1:$($port.Port)"
  }

  Write-Host "DrapixAI local preflight"
  Write-Host "======================="
  foreach ($check in $checks) {
    $status = if ($check.Passed) { "PASS" } else { "FAIL" }
    Write-Host ("[{0}] {1} - {2}" -f $status, $check.Name, $check.Detail)
  }

  $failed = @($checks | Where-Object { -not $_.Passed })
  if ($failed.Count -gt 0) {
    Write-Host ""
    Write-Host "Next local recovery commands:"
    Write-Host "  docker-compose up -d postgres redis minio"
    Write-Host "  npm --prefix apps/api run prisma:generate"
    Write-Host "  npm --prefix apps/api run build"
    Write-Host "  npm --prefix apps/web run build"
    exit 1
  }

  Write-Host ""
  Write-Host "Local preflight passed."
} finally {
  Pop-Location
}
