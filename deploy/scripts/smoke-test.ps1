param(
  [string]$ApiUrl = $env:API_URL,
  [string]$PersonImage = $env:PERSON_IMAGE,
  [string]$ClothImage = $env:CLOTH_IMAGE,
  [string]$RegisterEmail = $env:REGISTER_EMAIL,
  [string]$RegisterPassword = $env:REGISTER_PASSWORD,
  [string]$RegisterOtp = $env:REGISTER_OTP,
  [string]$Domain = $env:DOMAIN,
  [string]$DashboardProxyToken = $(if ($env:DRAPIXAI_DASHBOARD_PROXY_TOKEN) { $env:DRAPIXAI_DASHBOARD_PROXY_TOKEN } else { $env:DASHBOARD_PROXY_TOKEN }),
  [string]$GarmentId = $env:GARMENT_ID,
  [string]$ProductId = $env:PRODUCT_ID,
  [string]$OutputFile = $env:OUTPUT_FILE,
  [string]$HeadersFile = $env:HEADERS_FILE,
  [switch]$SkipTryOn = ($env:DRAPIXAI_SMOKE_SKIP_TRYON -eq "1")
)

$ErrorActionPreference = "Stop"

function Require-Value {
  param([string]$Name, [string]$Value)
  if ([string]::IsNullOrWhiteSpace($Value)) {
    throw "Set $Name before running smoke-test.ps1"
  }
}

function Invoke-Curl {
  param([string[]]$Arguments)
  & curl.exe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "curl failed with exit code $LASTEXITCODE"
  }
}

if (-not $ApiUrl) { $ApiUrl = "http://localhost:8000" }
if (-not $RegisterEmail) { $RegisterEmail = "deploy-smoke-$([DateTimeOffset]::UtcNow.ToUnixTimeSeconds())@example.com" }
if (-not $RegisterPassword) { $RegisterPassword = "ChangeMe123!" }
if (-not $Domain) { $Domain = "localhost" }
if (-not $GarmentId) { $GarmentId = "smoke-upper-garment" }
if (-not $ProductId) { $ProductId = "smoke-upper-product" }
if (-not $OutputFile) { $OutputFile = Join-Path $env:TEMP "drapixai-smoke.png" }
if (-not $HeadersFile) { $HeadersFile = Join-Path $env:TEMP "drapixai-smoke.headers" }

$ApiUrl = $ApiUrl.TrimEnd("/")
$OriginUrl = if ($env:ORIGIN_URL) { $env:ORIGIN_URL } elseif ($Domain -eq "localhost") { "http://localhost:3000" } else { "https://$Domain" }

Write-Host "==> registering $RegisterEmail"
if (-not $RegisterOtp) {
  $otpPayload = @{ email = $RegisterEmail } | ConvertTo-Json -Compress
  $otpJson = Invoke-RestMethod -Method Post -Uri "$ApiUrl/auth/register/request-otp" -ContentType "application/json" -Body $otpPayload
  $RegisterOtp = [string]$otpJson.debugOtp
}

if (-not $RegisterOtp) {
  throw "Registration OTP was not provided and API did not return debugOtp. Set REGISTER_OTP for production-like smoke runs."
}

$registerPayload = @{
  email = $RegisterEmail
  password = $RegisterPassword
  companyName = "DrapixAI Smoke"
  otp = $RegisterOtp
} | ConvertTo-Json -Compress

$registerJson = Invoke-RestMethod -Method Post -Uri "$ApiUrl/auth/register" -ContentType "application/json" -Body $registerPayload

$apiKey = [string]$registerJson.apiKey
$token = [string]$registerJson.token
Require-Value "apiKey from registration response" $apiKey
Require-Value "token from registration response" $token

Write-Host "==> validating SDK key"
$validatePayload = @{ domain = $Domain } | ConvertTo-Json -Compress
$jsonHeaders = @{
  Authorization = "Bearer $apiKey"
  Origin = $OriginUrl
}
$managementHeaders = @{} + $jsonHeaders
if ($DashboardProxyToken) {
  $managementHeaders["x-drapixai-dashboard-proxy-token"] = $DashboardProxyToken
}
Invoke-RestMethod -Method Post -Uri "$ApiUrl/sdk/validate" -Headers $jsonHeaders -ContentType "application/json" -Body $validatePayload | Out-Null
Write-Host ""

if ($PersonImage -and $ClothImage) {
  if (-not $DashboardProxyToken) {
    Write-Warning "DASHBOARD_PROXY_TOKEN/DRAPIXAI_DASHBOARD_PROXY_TOKEN is not set; production APIs that require the dashboard proxy token will reject management setup calls."
  }

  $personPath = (Resolve-Path $PersonImage).Path
  $clothPath = (Resolve-Path $ClothImage).Path
  $outputDir = Split-Path -Parent $OutputFile
  $headersDir = Split-Path -Parent $HeadersFile
  if ($outputDir) { New-Item -ItemType Directory -Force $outputDir | Out-Null }
  if ($headersDir) { New-Item -ItemType Directory -Force $headersDir | Out-Null }

  Write-Host "==> uploading garment and building cached try-on asset"
  $garmentCurlHeaders = @("-H", "Authorization: Bearer $apiKey", "-H", "Origin: $OriginUrl")
  if ($DashboardProxyToken) {
    $garmentCurlHeaders += @("-H", "x-drapixai-dashboard-proxy-token: $DashboardProxyToken")
  }
  $garmentArgs = @(
    "--fail", "--silent", "--show-error",
    "-X", "POST", "$ApiUrl/sdk/garments"
  ) + $garmentCurlHeaders + @(
    "-F", "cloth_image=@$clothPath",
    "-F", "garment_id=$GarmentId",
    "-F", "product_name=DrapixAI Smoke Upper Garment",
    "-F", "category=shirt"
  )
  $garmentRaw = & curl.exe @garmentArgs
  if ($LASTEXITCODE -ne 0) { throw "Garment upload failed with exit code $LASTEXITCODE" }
  $garmentJson = $garmentRaw | ConvertFrom-Json
  Require-Value "cacheKey from garment upload response" ([string]$garmentJson.cacheKey)

  Write-Host "==> syncing and confirming product mapping"
  $catalogPayload = @{
    items = @(
      @{
        productId = $ProductId
        productName = "DrapixAI Smoke Product"
        category = "shirt"
        garmentType = "upper"
      }
    )
  } | ConvertTo-Json -Depth 5 -Compress
  Invoke-RestMethod -Method Post -Uri "$ApiUrl/sdk/catalog/sync" -Headers $managementHeaders -ContentType "application/json" -Body $catalogPayload | Out-Null

  $confirmPayload = @{ productId = $ProductId } | ConvertTo-Json -Compress
  Invoke-RestMethod -Method Post -Uri "$ApiUrl/sdk/matches/$GarmentId/confirm" -Headers $managementHeaders -ContentType "application/json" -Body $confirmPayload | Out-Null

  if ($SkipTryOn) {
    Write-Host "Skipping SDK try-on because DRAPIXAI_SMOKE_SKIP_TRYON=1 or -SkipTryOn was provided."
    Write-Host "Smoke test completed successfully."
    exit 0
  }

  Write-Host "==> running SDK try-on through confirmed cached product mapping"
  Invoke-Curl @(
    "--fail", "--silent", "--show-error",
    "-X", "POST", "$ApiUrl/sdk/tryon",
    "-H", "Authorization: Bearer $apiKey",
    "-H", "Origin: $OriginUrl",
    "-F", "person_image=@$personPath",
    "-F", "productId=$ProductId",
    "-F", "garment_type=upper",
    "-F", "quality=standard",
    "-D", $HeadersFile,
    "-o", $OutputFile
  )

  if (-not (Test-Path $OutputFile) -or (Get-Item $OutputFile).Length -le 0) {
    throw "SDK try-on output was not created: $OutputFile"
  }

  $headers = Get-Content $HeadersFile
  foreach ($requiredHeader in @(
    "x-drapixai-quality-mode",
    "x-drapixai-latency-ms",
    "x-drapixai-candidate-count",
    "x-drapixai-garment-source",
    "x-drapixai-garment-cache-status"
  )) {
    if (-not ($headers | Where-Object { $_ -match "^$requiredHeader\s*:" })) {
      throw "Missing SDK response header: $requiredHeader"
    }
  }

  Write-Host "Saved try-on output to $OutputFile"
  Write-Host "Saved response headers to $HeadersFile"
  $headers | Select-String -Pattern "x-drapixai-(quality-score|latency-ms|processing-ms|warnings|candidate-count|garment-source|garment-cache-status|quality-mode)"
} else {
  Write-Host "Skipping try-on because PERSON_IMAGE and CLOTH_IMAGE were not provided."
}

Write-Host "Smoke test completed successfully."
