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
  -d "{\"domain\":\"${DOMAIN}\"}"
echo

if [[ -n "${PERSON_IMAGE:-}" && -n "${CLOTH_IMAGE:-}" ]]; then
  echo "==> running direct try-on"
  curl --fail --silent --show-error \
    -X POST "${API_URL%/}/sdk/tryon" \
    -H "Authorization: Bearer ${api_key}" \
    -F "person_image=@${PERSON_IMAGE}" \
    -F "cloth_image=@${CLOTH_IMAGE}" \
    -F "garment_type=upper" \
    -o "$OUTPUT_FILE"
  test -s "$OUTPUT_FILE"
  echo "Saved try-on output to $OUTPUT_FILE"
else
  echo "Skipping try-on because PERSON_IMAGE and CLOTH_IMAGE were not provided."
fi

echo "Smoke test completed successfully."

