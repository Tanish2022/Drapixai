param(
    [string]$Domain = "drapixai.com",
    [string]$ApiSubdomain = "api",
    [string]$AdminEmail = "admin@drapixai.com",
    [string]$S3Bucket = "drapixai-prod",
    [string]$AwsRegion = "us-east-1",
    [switch]$Force
)

$ErrorActionPreference = "Stop"

function New-SecretValue {
    param([int]$Length = 64)

    $chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_"
    $bytes = New-Object byte[] ($Length * 2)
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)

    $builder = New-Object System.Text.StringBuilder
    foreach ($byte in $bytes) {
        if ($builder.Length -ge $Length) {
            break
        }
        [void]$builder.Append($chars[$byte % $chars.Length])
    }

    $builder.ToString()
}

function New-Base64Key {
    $bytes = New-Object byte[] 32
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    [Convert]::ToBase64String($bytes)
}

function New-Base32Secret {
    $alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"
    $bytes = New-Object byte[] 20
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $bits = -join ($bytes | ForEach-Object { [Convert]::ToString($_, 2).PadLeft(8, '0') })
    $builder = New-Object System.Text.StringBuilder
    for ($offset = 0; $offset -lt $bits.Length; $offset += 5) {
        $chunk = $bits.Substring($offset, [Math]::Min(5, $bits.Length - $offset)).PadRight(5, '0')
        [void]$builder.Append($alphabet[[Convert]::ToInt32($chunk, 2)])
    }
    $builder.ToString()
}

function Set-KeyValue {
    param(
        [string]$Content,
        [string]$Key,
        [string]$Value
    )

    $pattern = "(?m)^" + [regex]::Escape($Key) + "=.*$"
    if ($Content -match $pattern) {
        return [regex]::Replace($Content, $pattern, "$Key=$Value")
    }

    return ($Content.TrimEnd() + [Environment]::NewLine + "$Key=$Value" + [Environment]::NewLine)
}

function Write-EnvFile {
    param(
        [string]$SourcePath,
        [string]$TargetPath,
        [hashtable]$Replacements
    )

    if ((Test-Path $TargetPath) -and -not $Force) {
        Write-Host "Skipping existing file: $TargetPath"
        return
    }

    $content = Get-Content $SourcePath -Raw
    foreach ($entry in $Replacements.GetEnumerator()) {
        $content = Set-KeyValue -Content $content -Key $entry.Key -Value $entry.Value
    }

    Set-Content -Path $TargetPath -Value $content -NoNewline
    Write-Host "Created $TargetPath"
}

$repoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$envDir = Join-Path $repoRoot "deploy\env"

$apiDomain = "$ApiSubdomain.$Domain"
$jwtSecret = New-SecretValue
$adminToken = New-SecretValue
$adminPassword = New-SecretValue
$adminTotpSecret = New-Base32Secret
$nextAuthSecret = New-SecretValue
$adminSessionSecret = New-SecretValue
$dashboardSessionSecret = New-SecretValue
$authSyncToken = New-SecretValue
$dashboardProxyToken = New-SecretValue
$aiServiceToken = New-SecretValue
$shopifyStateSecret = New-SecretValue
$storefrontTokenSecret = New-SecretValue
$auditLogSecret = New-SecretValue
$shopifyEncryptionKey = New-Base64Key
$webhookEncryptionKey = New-Base64Key

Write-EnvFile `
    -SourcePath (Join-Path $envDir "api.production.example") `
    -TargetPath (Join-Path $envDir "api.production.env") `
    -Replacements @{
        "JWT_SECRET" = $jwtSecret
        "DRAPIXAI_AUTH_SYNC_TOKEN" = $authSyncToken
        "DRAPIXAI_DASHBOARD_PROXY_TOKEN" = $dashboardProxyToken
        "DRAPIXAI_AI_SERVICE_TOKEN" = $aiServiceToken
        "DRAPIXAI_ADMIN_TOKEN" = $adminToken
        "DRAPIXAI_CORS_ORIGINS" = "https://$Domain,https://www.$Domain"
        "DRAPIXAI_ADMIN_EMAIL" = $AdminEmail
        "DRAPIXAI_ADMIN_PASSWORD" = $adminPassword
        "DRAPIXAI_ADMIN_TOTP_SECRET" = $adminTotpSecret
        "DRAPIXAI_PUBLIC_API_BASE_URL" = "https://$apiDomain"
        "DRAPIXAI_WEB_BASE_URL" = "https://$Domain"
        "DRAPIXAI_SHOPIFY_STATE_SECRET" = $shopifyStateSecret
        "DRAPIXAI_SHOPIFY_TOKEN_ENCRYPTION_KEY" = $shopifyEncryptionKey
        "DRAPIXAI_STOREFRONT_TOKEN_SECRET" = $storefrontTokenSecret
        "DRAPIXAI_AUDIT_LOG_SECRET" = $auditLogSecret
        "DRAPIXAI_API_ENVIRONMENT" = "live"
        "DRAPIXAI_WEBHOOK_ENCRYPTION_KEY" = $webhookEncryptionKey
        "BILLING_UPGRADE_URL" = "https://$Domain/pricing"
        "S3_BUCKET" = $S3Bucket
        "AWS_REGION" = $AwsRegion
        "SMTP_FROM" = "no-reply@$Domain"
    }

Write-EnvFile `
    -SourcePath (Join-Path $envDir "web.production.example") `
    -TargetPath (Join-Path $envDir "web.production.env") `
    -Replacements @{
        "NEXT_PUBLIC_WEB_BASE_URL" = "https://$Domain"
        "NEXT_PUBLIC_API_BASE_URL" = "https://$apiDomain"
        "DRAPIXAI_API_URL" = "https://$apiDomain"
        "NEXTAUTH_URL" = "https://$Domain"
        "NEXTAUTH_SECRET" = $nextAuthSecret
        "ADMIN_SESSION_SECRET" = $adminSessionSecret
        "DASHBOARD_SESSION_SECRET" = $dashboardSessionSecret
        "DRAPIXAI_AUTH_SYNC_TOKEN" = $authSyncToken
        "DRAPIXAI_DASHBOARD_PROXY_TOKEN" = $dashboardProxyToken
        "NEXT_PUBLIC_GOOGLE_AUTH_ENABLED" = "0"
        "NEXT_PUBLIC_DEMO_VIDEO_URL" = ""
        "NEXT_PUBLIC_SHOPIFY_APP_INSTALL_URL" = ""
        "NEXT_PUBLIC_ADMIN_EMAIL" = $AdminEmail
    }

Write-EnvFile `
    -SourcePath (Join-Path $envDir "ai.production.example") `
    -TargetPath (Join-Path $envDir "ai.production.env") `
    -Replacements @{
        "DRAPIXAI_ADMIN_TOKEN" = $adminToken
        "DRAPIXAI_AI_SERVICE_TOKEN" = $aiServiceToken
        "DRAPIXAI_S3_BUCKET" = $S3Bucket
        "DRAPIXAI_S3_REGION" = $AwsRegion
    }

Write-Host ""
Write-Host "Production env skeletons are ready in deploy/env."
Write-Host "Still fill these external-service values before deployment:"
Write-Host "- DATABASE_URL"
Write-Host "- REDIS_URL"
Write-Host "- DRAPIXAI_AI_URL and private VPN DNS"
Write-Host "- DRAPIXAI_INTERNAL_TLS_SECRETS_DIR, API client certificate/key, and internal CA mount"
Write-Host "- Confirm DRAPIXAI_AUTH_SYNC_TOKEN matches between API and web env files"
Write-Host "- Confirm DRAPIXAI_DASHBOARD_PROXY_TOKEN matches between API and web env files"
Write-Host "- Confirm DRAPIXAI_AI_SERVICE_TOKEN matches between API and AI env files"
Write-Host "- Attach an AWS workload identity with Secrets Manager, S3, and KMS access; do not create long-lived access keys"
Write-Host "- DRAPIXAI_S3_ACCESS_KEY_ID / DRAPIXAI_S3_SECRET_ACCESS_KEY"
Write-Host "- SMTP_HOST / SMTP_USER / SMTP_PASS"
Write-Host "- GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET if Google login is enabled"
Write-Host "- SHOPIFY_API_KEY / SHOPIFY_API_SECRET and set DRAPIXAI_SHOPIFY_ENABLED=1 when the Shopify app is created"
Write-Host "- NEXT_PUBLIC_SHOPIFY_APP_INSTALL_URL after the Shopify listing or install link exists"
Write-Host ""
Write-Host "Next validation commands on Linux or WSL:"
Write-Host "  set -a"
Write-Host "  source deploy/env/api.production.env"
Write-Host "  source deploy/env/web.production.env"
Write-Host "  source deploy/env/ai.production.env"
Write-Host "  set +a"
Write-Host "  bash deploy/scripts/validate-env.sh api"
Write-Host "  bash deploy/scripts/validate-env.sh web"
Write-Host "  bash deploy/scripts/validate-env.sh ai"
