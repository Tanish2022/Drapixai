#!/usr/bin/env bash
set -euo pipefail

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
OUTPUT_FILE="${OUTPUT_FILE:-/tmp/drapixai-smoke.png}"

echo "==> registering ${EMAIL}"
register_json="$(curl --fail --silent --show-error \
  -X POST "${API_URL%/}/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\",\"companyName\":\"DrapixAI Smoke\"}")"

api_key="$(printf '%s' "$register_json" | json_field apiKey)"
token="$(printf '%s' "$register_json" | json_field token)"

if [[ -z "$api_key" || -z "$token" ]]; then
  echo "Registration succeeded but apiKey/token were missing." >&2
  echo "$register_json" >&2
  exit 1
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
  echo "==> uploading garment and building cached try-on asset"
  garment_json="$(curl --fail --silent --show-error \
    -X POST "${API_URL%/}/sdk/garments" \
    -H "Authorization: Bearer ${api_key}" \
    -H "Origin: ${ORIGIN_URL}" \
    -F "cloth_image=@${CLOTH_IMAGE}" \
    -F "garment_id=${GARMENT_ID}" \
    -F "product_name=DrapixAI Smoke Upper Garment" \
    -F "category=shirt")"

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
    -d "{\"items\":[{\"productId\":\"${PRODUCT_ID}\",\"productName\":\"DrapixAI Smoke Product\",\"category\":\"shirt\",\"garmentType\":\"upper\"}]}" >/dev/null

  curl --fail --silent --show-error \
    -X POST "${API_URL%/}/sdk/matches/${GARMENT_ID}/confirm" \
    -H "Authorization: Bearer ${api_key}" \
    -H "Content-Type: application/json" \
    -H "Origin: ${ORIGIN_URL}" \
    -d "{\"productId\":\"${PRODUCT_ID}\"}" >/dev/null

  echo "==> running SDK try-on through confirmed cached product mapping"
  curl --fail --silent --show-error \
    -X POST "${API_URL%/}/sdk/tryon" \
    -H "Authorization: Bearer ${api_key}" \
    -H "Origin: ${ORIGIN_URL}" \
    -F "person_image=@${PERSON_IMAGE}" \
    -F "productId=${PRODUCT_ID}" \
    -F "garment_type=upper" \
    -F "quality=standard" \
    -o "$OUTPUT_FILE"
  test -s "$OUTPUT_FILE"
  echo "Saved try-on output to $OUTPUT_FILE"
else
  echo "Skipping try-on because PERSON_IMAGE and CLOTH_IMAGE were not provided."
fi

echo "Smoke test completed successfully."
