param(
  [string]$ApiEnv = "deploy/env/api.production.env",
  [string]$AiEnv = "deploy/env/ai.production.env",
  [string]$WebEnv = "deploy/env/web.production.env"
)

$ErrorActionPreference = "Stop"
$root = Resolve-Path (Join-Path $PSScriptRoot "../..")
$checks = New-Object System.Collections.Generic.List[object]

function Get-LocalSetting {
  param([string]$Name, [string]$DefaultValue)
  $envValue = [Environment]::GetEnvironmentVariable($Name)
  if ($envValue) {
    return $envValue
  }

  $envFile = Join-Path $root ".env"
  if (Test-Path $envFile) {
    $line = Get-Content $envFile | Where-Object { $_ -match "^\s*$([regex]::Escape($Name))\s*=" } | Select-Object -First 1
    if ($line) {
      $value = ($line -split "=", 2)[1].Trim().Trim('"').Trim("'")
      if ($value) {
        return $value
      }
    }
  }

  return $DefaultValue
}

$postgresPort = [int](Get-LocalSetting "DRAPIXAI_POSTGRES_PORT" "5432")
$redisPort = [int](Get-LocalSetting "DRAPIXAI_REDIS_PORT" "6379")
$minioApiPort = [int](Get-LocalSetting "DRAPIXAI_MINIO_API_PORT" "9000")
$minioConsolePort = [int](Get-LocalSetting "DRAPIXAI_MINIO_CONSOLE_PORT" "9001")
$apiPort = [int](Get-LocalSetting "PORT" "8000")
$webPort = [int](Get-LocalSetting "DRAPIXAI_WEB_PORT" "3000")
$aiApiPort = [int](Get-LocalSetting "DRAPIXAI_AI_API_PORT" "8080")

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

function Test-LocalPortOpen {
  param([int]$Port)
  return (Test-PortOpen "127.0.0.1" $Port) -or (Test-PortOpen "::1" $Port) -or (Test-PortOpen "localhost" $Port)
}

function Test-DockerContainerRunning {
  param([string]$Container)
  try {
    $status = (& docker inspect $Container --format "{{.State.Running}}" 2>$null).Trim()
    return $status -eq "true"
  } catch {
    return $false
  }
}

function Test-DockerPublishedPort {
  param([string]$Container, [string]$ContainerPort, [int]$ExpectedHostPort)
  try {
    $json = & docker inspect $Container --format "{{json .NetworkSettings.Ports}}" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $json) {
      return $false
    }
    $ports = $json | ConvertFrom-Json
    $property = $ports.PSObject.Properties[$ContainerPort]
    if ($null -eq $property -or $null -eq $property.Value) {
      return $false
    }
    $published = @($property.Value) | Where-Object { [int]$_.HostPort -eq $ExpectedHostPort }
    return $published.Count -gt 0
  } catch {
    return $false
  }
}

function Get-DockerPublishedPortDetail {
  param([string]$Container, [string]$ContainerPort, [int]$ExpectedHostPort)
  try {
    $json = & docker inspect $Container --format "{{json .NetworkSettings.Ports}}" 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $json) {
      return "$ContainerPort -> expected host $ExpectedHostPort, container not inspectable"
    }
    $ports = $json | ConvertFrom-Json
    $property = $ports.PSObject.Properties[$ContainerPort]
    if ($null -eq $property -or $null -eq $property.Value) {
      return "$ContainerPort -> expected host $ExpectedHostPort, not published"
    }
    $actual = (@($property.Value) | ForEach-Object { "$($_.HostIp):$($_.HostPort)" }) -join ", "
    return "$ContainerPort -> expected host $ExpectedHostPort, actual $actual"
  } catch {
    return "$ContainerPort -> expected host $ExpectedHostPort, inspect failed"
  }
}

function Get-PortOwnerDetail {
  param([int]$Port)
  if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    return "127.0.0.1:$Port"
  }
  try {
    $rows = & docker ps --format "{{.Names}}|{{.Ports}}" 2>$null
    $owners = @($rows | Where-Object { $_ -match ":$Port->" } | ForEach-Object { ($_ -split "\|", 2)[0] })
    if ($owners.Count -gt 0) {
      return "127.0.0.1:$Port owned by Docker container(s): $($owners -join ', ')"
    }
  } catch {
    return "127.0.0.1:$Port"
  }
  return "127.0.0.1:$Port"
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

    foreach ($container in @("drapixai-postgres", "drapixai-redis", "drapixai-minio")) {
      Add-Check "Docker container: $container" (Test-DockerContainerRunning $container) $container
    }
    Add-Check "Docker port publish: drapixai-postgres $postgresPort" (Test-DockerPublishedPort "drapixai-postgres" "5432/tcp" $postgresPort) (Get-DockerPublishedPortDetail "drapixai-postgres" "5432/tcp" $postgresPort)
    Add-Check "Docker port publish: drapixai-redis $redisPort" (Test-DockerPublishedPort "drapixai-redis" "6379/tcp" $redisPort) (Get-DockerPublishedPortDetail "drapixai-redis" "6379/tcp" $redisPort)
    Add-Check "Docker port publish: drapixai-minio $minioApiPort" (Test-DockerPublishedPort "drapixai-minio" "9000/tcp" $minioApiPort) (Get-DockerPublishedPortDetail "drapixai-minio" "9000/tcp" $minioApiPort)
    Add-Check "Docker port publish: drapixai-minio $minioConsolePort" (Test-DockerPublishedPort "drapixai-minio" "9001/tcp" $minioConsolePort) (Get-DockerPublishedPortDetail "drapixai-minio" "9001/tcp" $minioConsolePort)
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
    @{ Name = "Postgres"; Port = $postgresPort },
    @{ Name = "Redis"; Port = $redisPort },
    @{ Name = "MinIO API"; Port = $minioApiPort },
    @{ Name = "MinIO Console"; Port = $minioConsolePort },
    @{ Name = "API"; Port = $apiPort },
    @{ Name = "Web"; Port = $webPort },
    @{ Name = "AI API"; Port = $aiApiPort }
  )
  foreach ($port in $ports) {
    Add-Check "$($port.Name) port $($port.Port)" (Test-LocalPortOpen $port.Port) (Get-PortOwnerDetail $port.Port)
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
    Write-Host "  # If Postgres 5432 is already occupied, use:"
    Write-Host "  `$env:DRAPIXAI_POSTGRES_PORT=5433; docker-compose up -d --force-recreate postgres"
    Write-Host "  # Then point local API DATABASE_URL at localhost:5433."
    Write-Host "  npm --prefix apps/api run prisma:generate"
    Write-Host "  npm --prefix apps/api run build"
    Write-Host "  npm --prefix apps/web run build"
    Write-Host "  npm run dev:api"
    Write-Host "  npm run dev:web"
    Write-Host "  uvicorn drapixai_ai.api.ai_server:app --host 0.0.0.0 --port 8080"
    exit 1
  }

  Write-Host ""
  Write-Host "Local preflight passed."
} finally {
  Pop-Location
}
