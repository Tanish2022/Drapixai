param(
    [string]$EnvDir = "deploy/env"
)

$ErrorActionPreference = "Stop"

function Resolve-EnvPath {
    param([string]$Name)
    $path = Join-Path $EnvDir $Name
    if (-not (Test-Path -LiteralPath $path)) {
        throw "Missing env file: $path"
    }
    (Resolve-Path -LiteralPath $path).Path
}

function Get-EnvValue {
    param(
        [string]$Path,
        [string]$Key
    )

    $line = Get-Content -LiteralPath $Path | Where-Object { $_ -match "^$([regex]::Escape($Key))=" } | Select-Object -Last 1
    if (-not $line) {
        throw "Missing required key $Key in $Path"
    }

    $value = $line.Substring($Key.Length + 1).Trim().Trim('"').Trim("'")
    if (-not $value) {
        throw "Empty required key $Key in $Path"
    }
    if ($value -like 'replace-with-*' -or $value -like '*RUNPOD_POD_IP*' -or $value -like '*USERNAME:PASSWORD*') {
        throw "Placeholder value for $Key in $Path"
    }

    $value
}

function Assert-Match {
    param(
        [string]$Key,
        [string]$LeftPath,
        [string]$RightPath,
        [string]$LeftLabel,
        [string]$RightLabel
    )

    $left = Get-EnvValue -Path $LeftPath -Key $Key
    $right = Get-EnvValue -Path $RightPath -Key $Key
    if ($left -ne $right) {
        throw "Shared secret mismatch for $Key between $LeftLabel and $RightLabel"
    }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$apiEnv = Resolve-EnvPath "api.production.env"
$webEnv = Resolve-EnvPath "web.production.env"
$aiEnv = Resolve-EnvPath "ai.production.env"

Assert-Match DRAPIXAI_AUTH_SYNC_TOKEN $apiEnv $webEnv api web
Assert-Match DRAPIXAI_DASHBOARD_PROXY_TOKEN $apiEnv $webEnv api web
Assert-Match DRAPIXAI_AI_SERVICE_TOKEN $apiEnv $aiEnv api ai
Assert-Match DRAPIXAI_ADMIN_TOKEN $apiEnv $aiEnv api ai

foreach ($envFile in @($apiEnv, $webEnv, $aiEnv)) {
    git -C $repoRoot check-ignore -q $envFile
    if ($LASTEXITCODE -ne 0) {
        throw "Production env file must be ignored by Git: $envFile"
    }
}

Write-Host "Production env set validation passed."
