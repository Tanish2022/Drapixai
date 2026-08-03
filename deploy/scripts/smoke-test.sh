#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

if [[ -z "${API_URL:-}" ]]; then
  echo "Set API_URL before running smoke-test.sh" >&2
  exit 1
fi

json_field() {
  local field="$1"
  python3 -c 'import json, sys
data = json.load(sys.stdin)
value = data
for part in sys.argv[1].split("."):
    if isinstance(value, dict):
        value = value.get(part)
    else:
        value = None
        break
print("" if value is None else value)' "$field"
}

EMAIL="${REGISTER_EMAIL:-deploy-smoke-$(date +%s)@example.com}"
PASSWORD="${REGISTER_PASSWORD:-ChangeMe123!}"
DOMAIN="${DOMAIN:-staging.drapixai.com}"
ORIGIN_URL="${ORIGIN_URL:-https://${DOMAIN}}"
GARMENT_ID="${GARMENT_ID:-smoke-upper-garment}"
PRODUCT_ID="${PRODUCT_ID:-smoke-upper-product}"
GARMENT_CATEGORY="${GARMENT_CATEGORY:-shirt}"
OUTPUT_FILE="${OUTPUT_FILE:-/tmp/drapixai-smoke.png}"
HEADERS_FILE="${HEADERS_FILE:-/tmp/drapixai-smoke.headers}"
DASHBOARD_PROXY_TOKEN="${DRAPIXAI_DASHBOARD_PROXY_TOKEN:-${DASHBOARD_PROXY_TOKEN:-}}"
dashboard_proxy_header_args=()
if [[ -n "$DASHBOARD_PROXY_TOKEN" ]]; then
  dashboard_proxy_header_args=(-H "x-drapixai-dashboard-proxy-token: ${DASHBOARD_PROXY_TOKEN}")
fi

echo "==> registering ${EMAIL}"
otp="${REGISTER_OTP:-}"
if [[ -z "$otp" ]]; then
  otp_json="$(curl --fail --silent --show-error \
    -X POST "${API_URL%/}/auth/register/request-otp" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"${EMAIL}\"}")"
  otp="$(printf '%s' "$otp_json" | json_field debugOtp)"
fi

if [[ -z "$otp" ]]; then
  echo "Registration OTP was not provided and API did not return debugOtp." >&2
  echo "Set REGISTER_OTP for production-like smoke runs." >&2
  exit 1
fi

register_json="$(curl --fail --silent --show-error \
  -X POST "${API_URL%/}/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"companyName\":\"DrapixAI Smoke\",\"otp\":\"${otp}\"}")"

api_key="$(printf '%s' "$register_json" | json_field apiKey)"
token="$(printf '%s' "$register_json" | json_field token)"

if [[ -z "$api_key" || -z "$token" ]]; then
  echo "Registration succeeded but apiKey/token were missing." >&2
  echo "$register_json" >&2
  exit 1
fi

if [[ "${DRAPIXAI_SMOKE_PREPARE_ACCOUNT:-0}" == "1" ]]; then
  echo "==> preparing development-only verified smoke storefront"
  (
    cd "$APP_ROOT/apps/api"
    npx ts-node src/scripts/prepare-smoke-account.ts "$EMAIL" "$DOMAIN"
  )
fi

echo "==> validating SDK key"
curl --fail --silent --show-error \
  -X POST "${API_URL%/}/sdk/validate" \
  -H "Authorization: Bearer ${api_key}" \
  -H "Content-Type: application/json" \
  -H "Origin: ${ORIGIN_URL}" \
  -d "{\"domain\":\"${DOMAIN}\"}"
echo

if [[ -n "${PERSON_IMAGE:-}" && -n "${CLOTH_IMAGE:-}" ]]; then
  if [[ -z "$DASHBOARD_PROXY_TOKEN" ]]; then
    echo "DASHBOARD_PROXY_TOKEN/DRAPIXAI_DASHBOARD_PROXY_TOKEN is not set; production APIs that require the dashboard proxy token will reject management setup calls." >&2
  fi

  echo "==> uploading garment and building cached try-on asset"
  garment_json="$(curl --fail --silent --show-error \
    -X POST "${API_URL%/}/sdk/garments" \
    -H "Authorization: Bearer ${api_key}" \
    -H "Origin: ${ORIGIN_URL}" \
    "${dashboard_proxy_header_args[@]}" \
    -F "cloth_image=@${CLOTH_IMAGE}" \
    -F "garment_id=${GARMENT_ID}" \
    -F "product_name=DrapixAI Smoke Upper Garment" \
    -F "category=${GARMENT_CATEGORY}")"

  cache_key="$(printf '%s' "$garment_json" | json_field cacheKey)"
  if [[ -z "$cache_key" ]]; then
    echo "Garment upload succeeded but cacheKey was missing." >&2
    echo "$garment_json" >&2
    exit 1
  fi

  echo "==> syncing and confirming product mapping"
  curl --fail --silent --show-error \
    -X POST "${API_URL%/}/sdk/catalog/sync" \
    -H "Authorization: Bearer ${api_key}" \
    -H "Content-Type: application/json" \
    -H "Origin: ${ORIGIN_URL}" \
    "${dashboard_proxy_header_args[@]}" \
    -d "{\"items\":[{\"productId\":\"${PRODUCT_ID}\",\"productName\":\"DrapixAI Smoke Product\",\"category\":\"${GARMENT_CATEGORY}\",\"garmentType\":\"upper\"}]}" >/dev/null

  curl --fail --silent --show-error \
    -X POST "${API_URL%/}/sdk/matches/${GARMENT_ID}/confirm" \
    -H "Authorization: Bearer ${api_key}" \
    -H "Content-Type: application/json" \
    -H "Origin: ${ORIGIN_URL}" \
    "${dashboard_proxy_header_args[@]}" \
    -d "{\"productId\":\"${PRODUCT_ID}\"}" >/dev/null

  echo "==> running SDK try-on through confirmed cached product mapping"
  sdk_http_status="$(curl --silent --show-error \
    -X POST "${API_URL%/}/sdk/tryon" \
    -H "Authorization: Bearer ${api_key}" \
    -H "Origin: ${ORIGIN_URL}" \
    -F "person_image=@${PERSON_IMAGE}" \
    -F "productId=${PRODUCT_ID}" \
    -F "garment_type=upper" \
    -F "quality=standard" \
    -F "shopper_consent=true" \
    -F "privacy_policy_version=2026-08-04" \
    -D "$HEADERS_FILE" \
    -o "$OUTPUT_FILE" \
    -w '%{http_code}')"
  if [[ ! "$sdk_http_status" =~ ^2[0-9][0-9]$ ]]; then
    echo "SDK try-on failed with HTTP ${sdk_http_status}:" >&2
    cat "$OUTPUT_FILE" >&2
    echo >&2
    exit 1
  fi
  test -s "$OUTPUT_FILE"
  echo "Saved try-on output to $OUTPUT_FILE"
  echo "Saved response headers to $HEADERS_FILE"
  grep -iE 'x-drapixai-(quality-score|latency-ms|processing-ms|warnings|candidate-count|garment-source|garment-cache-status|quality-mode)' "$HEADERS_FILE" || true
  echo "==> asserting SDK launch quality gates"
  python3 "$(dirname "${BASH_SOURCE[0]}")/assert-smoke-headers.py" "$HEADERS_FILE"
else
  echo "Skipping try-on because PERSON_IMAGE and CLOTH_IMAGE were not provided."
fi

echo "Smoke test completed successfully."
