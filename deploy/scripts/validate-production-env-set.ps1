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

function Assert-RequiredKeys {
    param([string]$Path, [string[]]$Keys)
    foreach ($key in $Keys) {
        [void](Get-EnvValue -Path $Path -Key $key)
    }
}

function Assert-ExactValue {
    param([string]$Path, [string]$Key, [string]$Expected)
    $actual = Get-EnvValue -Path $Path -Key $Key
    if ($actual -ne $Expected) {
        throw "Invalid value for $Key in $Path; expected $Expected"
    }
}

function Assert-MinLength {
    param([string]$Path, [string]$Key, [int]$Minimum)
    $value = Get-EnvValue -Path $Path -Key $Key
    if ($value.Length -lt $Minimum) {
        throw "Value for $Key in $Path must be at least $Minimum characters"
    }
}

function Assert-NumberAtLeast {
    param([string]$Path, [string]$Key, [double]$Minimum)
    $value = Get-EnvValue -Path $Path -Key $Key
    $number = 0.0
    if (-not [double]::TryParse($value, [Globalization.NumberStyles]::Float, [Globalization.CultureInfo]::InvariantCulture, [ref]$number) -or $number -lt $Minimum) {
        throw "Value for $Key in $Path must be a number at least $Minimum"
    }
}

function Assert-Base64Bytes {
    param([string]$Path, [string]$Key, [int]$ExpectedBytes)
    $value = Get-EnvValue -Path $Path -Key $Key
    try {
        $decoded = [Convert]::FromBase64String($value)
    } catch {
        throw "Value for $Key in $Path must be valid base64"
    }
    if ($decoded.Length -ne $ExpectedBytes) {
        throw "Value for $Key in $Path must decode to exactly $ExpectedBytes bytes"
    }
}

function Assert-HttpsUrl {
    param([string]$Path, [string]$Key)
    $value = Get-EnvValue -Path $Path -Key $Key
    try {
        $uri = [Uri]$value
    } catch {
        throw "Value for $Key in $Path must be a valid URL"
    }
    if ($uri.Scheme -ne "https" -or $uri.Host -in @("localhost", "127.0.0.1", "::1")) {
        throw "Value for $Key in $Path must use a non-local HTTPS URL"
    }
}

function Assert-HttpsOriginList {
    param([string]$Path, [string]$Key)
    $value = Get-EnvValue -Path $Path -Key $Key
    foreach ($origin in $value.Split(',')) {
        $trimmed = $origin.Trim().TrimEnd('/')
        try {
            $uri = [Uri]$trimmed
        } catch {
            throw "Value for $Key in $Path contains an invalid origin"
        }
        if ($uri.Scheme -ne "https" -or $uri.Host -in @("localhost", "127.0.0.1", "::1") -or $uri.AbsolutePath -ne "/") {
            throw "Value for $Key in $Path must contain only non-local HTTPS origins"
        }
    }
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$apiEnv = Resolve-EnvPath "api.production.env"
$webEnv = Resolve-EnvPath "web.production.env"
$aiEnv = Resolve-EnvPath "ai.production.env"

Assert-RequiredKeys $apiEnv @(
    "NODE_ENV", "DATABASE_URL", "REDIS_URL", "JWT_SECRET",
    "DRAPIXAI_AUTH_SYNC_TOKEN", "DRAPIXAI_DASHBOARD_PROXY_TOKEN",
    "DRAPIXAI_AI_URL", "DRAPIXAI_AI_SERVICE_TOKEN", "DRAPIXAI_CORS_ORIGINS",
    "DRAPIXAI_ADMIN_TOKEN", "DRAPIXAI_ADMIN_PASSWORD", "DRAPIXAI_ADMIN_TOTP_SECRET",
    "DRAPIXAI_STOREFRONT_TOKEN_SECRET", "DRAPIXAI_AUDIT_LOG_SECRET",
    "DRAPIXAI_API_ENVIRONMENT", "DRAPIXAI_WEBHOOK_ENCRYPTION_KEY",
    "DRAPIXAI_S3_SERVER_SIDE_ENCRYPTION", "DRAPIXAI_S3_KMS_KEY_ID", "S3_BUCKET", "AWS_REGION",
    "DRAPIXAI_AWS_USE_WORKLOAD_IDENTITY", "SMTP_HOST", "SMTP_PORT",
    "SMTP_USER", "SMTP_PASS", "SMTP_FROM"
)
Assert-ExactValue $apiEnv "NODE_ENV" "production"
Assert-MinLength $apiEnv "JWT_SECRET" 32
Assert-MinLength $apiEnv "DRAPIXAI_AUTH_SYNC_TOKEN" 32
Assert-MinLength $apiEnv "DRAPIXAI_DASHBOARD_PROXY_TOKEN" 32
Assert-MinLength $apiEnv "DRAPIXAI_AI_SERVICE_TOKEN" 32
Assert-MinLength $apiEnv "DRAPIXAI_ADMIN_TOKEN" 32
Assert-MinLength $apiEnv "DRAPIXAI_ADMIN_PASSWORD" 12
Assert-MinLength $apiEnv "DRAPIXAI_ADMIN_TOTP_SECRET" 16
Assert-MinLength $apiEnv "DRAPIXAI_STOREFRONT_TOKEN_SECRET" 32
Assert-MinLength $apiEnv "DRAPIXAI_AUDIT_LOG_SECRET" 32
Assert-ExactValue $apiEnv "DRAPIXAI_API_ENVIRONMENT" "live"
Assert-Base64Bytes $apiEnv "DRAPIXAI_WEBHOOK_ENCRYPTION_KEY" 32
Assert-ExactValue $apiEnv "DRAPIXAI_AWS_USE_WORKLOAD_IDENTITY" "1"
Assert-ExactValue $apiEnv "DRAPIXAI_S3_SERVER_SIDE_ENCRYPTION" "aws:kms"
Assert-HttpsUrl $apiEnv "DRAPIXAI_AI_URL"
Assert-HttpsOriginList $apiEnv "DRAPIXAI_CORS_ORIGINS"
foreach ($entry in @{
    DRAPIXAI_REQUIRE_GARMENT_CACHE = "1"
    DRAPIXAI_ENABLE_LEGACY_ASYNC_RENDER = "0"
    DRAPIXAI_ALLOW_LOCAL_STORAGE_FALLBACK = "0"
    DRAPIXAI_GARMENT_APPROVAL_REQUIRED = "1"
    DRAPIXAI_AUTO_REJECT_BAD_RESULTS = "1"
    DRAPIXAI_SDK_PREFER_ORIGINAL_GARMENT_FOR_TRYON = "0"
    DRAPIXAI_SDK_GENERATION_SOURCE = "original_verified"
    DRAPIXAI_EXCELLENT_LATENCY_MS = "10000"
    DRAPIXAI_MAX_PUBLISHABLE_LATENCY_MS = "12000"
    DRAPIXAI_REVIEW_RETENTION_DAYS = "0"
    DRAPIXAI_ENABLE_LOWER_BODY = "0"
}.GetEnumerator()) {
    Assert-ExactValue $apiEnv $entry.Key $entry.Value
}
Assert-NumberAtLeast $apiEnv "DRAPIXAI_EXCELLENT_QUALITY_SCORE" 0.95
Assert-NumberAtLeast $apiEnv "DRAPIXAI_MIN_PUBLISHABLE_QUALITY_SCORE" 0.95

Assert-RequiredKeys $webEnv @(
    "NODE_ENV", "NEXT_PUBLIC_WEB_BASE_URL", "NEXT_PUBLIC_API_BASE_URL", "DRAPIXAI_API_URL",
    "NEXTAUTH_URL", "NEXTAUTH_SECRET", "ADMIN_SESSION_SECRET", "DASHBOARD_SESSION_SECRET",
    "DRAPIXAI_AUTH_SYNC_TOKEN", "DRAPIXAI_DASHBOARD_PROXY_TOKEN"
)
Assert-ExactValue $webEnv "NODE_ENV" "production"
foreach ($key in @("NEXT_PUBLIC_WEB_BASE_URL", "NEXT_PUBLIC_API_BASE_URL", "DRAPIXAI_API_URL", "NEXTAUTH_URL")) {
    Assert-HttpsUrl $webEnv $key
}
foreach ($key in @("NEXTAUTH_SECRET", "ADMIN_SESSION_SECRET", "DASHBOARD_SESSION_SECRET", "DRAPIXAI_AUTH_SYNC_TOKEN", "DRAPIXAI_DASHBOARD_PROXY_TOKEN")) {
    Assert-MinLength $webEnv $key 32
}

Assert-RequiredKeys $aiEnv @(
    "DRAPIXAI_ENV", "DRAPIXAI_GPU_PRESET", "DRAPIXAI_DEVICE", "DRAPIXAI_CUDA_DEVICE",
    "DRAPIXAI_REDIS_URL", "DRAPIXAI_REDIS_PASSWORD", "DRAPIXAI_TRYON_ENGINE", "DRAPIXAI_MODEL_DIR",
    "DRAPIXAI_CATVTON_MODEL_DIR", "DRAPIXAI_CATVTON_BASE_MODEL", "DRAPIXAI_CATVTON_VAE_MODEL",
    "DRAPIXAI_GARMENT_CACHE_DIR", "DRAPIXAI_ADMIN_TOKEN", "DRAPIXAI_AI_SERVICE_TOKEN"
)
foreach ($entry in @{
    DRAPIXAI_ENV = "production"
    DRAPIXAI_TRYON_ENGINE = "catvton"
    DRAPIXAI_CATVTON_SKIP_SAFETY_CHECK = "0"
    DRAPIXAI_CATVTON_MODEL_REVISION = "2969fcf85fe62f2036605716f0b56f0b81d01d79"
    DRAPIXAI_CATVTON_GIT_COMMIT = "7818397f25613beedb3d861a34769f607cfcf3b1"
    DRAPIXAI_CATVTON_BASE_REVISION = "8a4288a76071f7280aedbdb3253bdb9e9d5d84bb"
    DRAPIXAI_CATVTON_VAE_REVISION = "31f26fdeee1355a5c34592e401dd41e45d25a493"
    DRAPIXAI_CANDIDATE_COUNT = "1"
    DRAPIXAI_GARMENT_CACHE_VERSION = "v3-1024x1365"
    DRAPIXAI_GARMENT_TARGET_WIDTH = "1024"
    DRAPIXAI_GARMENT_TARGET_HEIGHT = "1365"
    DRAPIXAI_GARMENT_CONDITION_MAX_EDGE = "1536"
    DRAPIXAI_ENABLE_FINAL_OUTPUT_UPSCALE = "1"
    DRAPIXAI_OUTPUT_WIDTH = "1024"
    DRAPIXAI_OUTPUT_HEIGHT = "1365"
    DRAPIXAI_TRANSIENT_SPOOL_DIR = "/dev/shm/drapixai-tryon-spool"
    DRAPIXAI_TRANSIENT_SPOOL_TTL = "900"
}.GetEnumerator()) {
    Assert-ExactValue $aiEnv $entry.Key $entry.Value
}
Assert-MinLength $aiEnv "DRAPIXAI_AI_SERVICE_TOKEN" 32
Assert-MinLength $aiEnv "DRAPIXAI_ADMIN_TOKEN" 32
Assert-MinLength $aiEnv "DRAPIXAI_REDIS_PASSWORD" 32
Assert-NumberAtLeast $aiEnv "DRAPIXAI_MIN_QUALITY_SCORE" 0.95

$shopifyEnabled = Get-EnvValue -Path $apiEnv -Key "DRAPIXAI_SHOPIFY_ENABLED"
if ($shopifyEnabled -notin @("0", "1")) {
    throw "DRAPIXAI_SHOPIFY_ENABLED in $apiEnv must be 0 or 1"
}
if ($shopifyEnabled -eq "1") {
    Assert-RequiredKeys $apiEnv @(
        "SHOPIFY_API_KEY", "SHOPIFY_API_SECRET", "DRAPIXAI_PUBLIC_API_BASE_URL",
        "DRAPIXAI_WEB_BASE_URL", "DRAPIXAI_SHOPIFY_STATE_SECRET",
        "DRAPIXAI_SHOPIFY_TOKEN_ENCRYPTION_KEY", "DRAPIXAI_STOREFRONT_TOKEN_SECRET"
    )
    Assert-MinLength $apiEnv "SHOPIFY_API_KEY" 16
    Assert-MinLength $apiEnv "SHOPIFY_API_SECRET" 32
    Assert-MinLength $apiEnv "DRAPIXAI_SHOPIFY_STATE_SECRET" 32
    Assert-Base64Bytes $apiEnv "DRAPIXAI_SHOPIFY_TOKEN_ENCRYPTION_KEY" 32
    Assert-HttpsUrl $apiEnv "DRAPIXAI_PUBLIC_API_BASE_URL"
    Assert-HttpsUrl $apiEnv "DRAPIXAI_WEB_BASE_URL"
    Assert-ExactValue $apiEnv "SHOPIFY_USE_LEGACY_INSTALL_FLOW" "0"
    Assert-ExactValue $apiEnv "DRAPIXAI_SHOPIFY_AUTO_PREPARE" "1"
}

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
