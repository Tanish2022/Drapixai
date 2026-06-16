#!/usr/bin/env bash
set -Eeuo pipefail

APP_ROOT="${DRAPIXAI_APP_ROOT:-/workspace/drapixai}"
API_PORT="${PORT:-8000}"
API_ENV_FILE="${DRAPIXAI_API_ENV_FILE:-$APP_ROOT/apps/api/.env}"
AI_ENV_FILE="${DRAPIXAI_AI_ENV_FILE:-$APP_ROOT/deploy/env/ai.production.env}"
LOG_DIR="$APP_ROOT/runtime/logs"
MINIO_DATA_DIR="${DRAPIXAI_MINIO_DATA_DIR:-$APP_ROOT/runtime/minio}"
MINIO_BUCKET="${S3_BUCKET:-drapixai-local}"
MINIO_ROOT_USER="${MINIO_ROOT_USER:-drapixai}"
MINIO_ROOT_PASSWORD="${MINIO_ROOT_PASSWORD:-drapixai-local-secret}"
POSTGRES_DB="${POSTGRES_DB:-drapixai}"
POSTGRES_USER="${POSTGRES_USER:-drapixai}"
POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-drapixai}"

log() {
  printf '\n[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

generate_secret() {
  python3 - <<'PY'
import secrets
import string

alphabet = string.ascii_letters + string.digits + "-_"
print("".join(secrets.choice(alphabet) for _ in range(64)))
PY
}

require_root_or_sudo() {
  APT_PREFIX=()
  if [[ "$(id -u)" -ne 0 ]]; then
    if ! command -v sudo >/dev/null 2>&1; then
      echo "This script needs root or sudo access to install API dependencies." >&2
      exit 1
    fi
    APT_PREFIX=(sudo)
  fi
}

install_system_packages() {
  log "Installing API/SDK system packages"
  require_root_or_sudo
  "${APT_PREFIX[@]}" apt-get update
  "${APT_PREFIX[@]}" apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    gnupg \
    postgresql \
    postgresql-contrib \
    redis-server
}

install_node_if_needed() {
  if command -v node >/dev/null 2>&1; then
    local major
    major="$(node -p "process.versions.node.split('.')[0]")"
    if [[ "$major" -ge 18 ]]; then
      log "Node $(node --version) is ready"
      return
    fi
  fi

  log "Installing Node.js 20"
  curl -fsSL https://deb.nodesource.com/setup_20.x -o /tmp/drapixai-nodesource-setup.sh
  "${APT_PREFIX[@]}" bash /tmp/drapixai-nodesource-setup.sh
  "${APT_PREFIX[@]}" apt-get install -y nodejs
  node --version
  npm --version
}

start_postgres() {
  log "Starting PostgreSQL and ensuring DrapixAI database"
  if command -v service >/dev/null 2>&1; then
    "${APT_PREFIX[@]}" service postgresql start || true
  fi
  if command -v pg_lsclusters >/dev/null 2>&1; then
    while read -r version cluster _status _owner _data _log; do
      [[ -z "$version" || "$version" == "Ver" ]] && continue
      "${APT_PREFIX[@]}" pg_ctlcluster "$version" "$cluster" start || true
    done < <(pg_lsclusters)
  fi

  if ! "${APT_PREFIX[@]}" runuser -u postgres -- psql -tAc "SELECT 1" >/dev/null 2>&1; then
    echo "PostgreSQL did not start." >&2
    exit 1
  fi

  if ! "${APT_PREFIX[@]}" runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${POSTGRES_USER}'" | grep -q 1; then
    "${APT_PREFIX[@]}" runuser -u postgres -- psql -c "CREATE USER ${POSTGRES_USER} WITH PASSWORD '${POSTGRES_PASSWORD}';"
  fi
  if ! "${APT_PREFIX[@]}" runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='${POSTGRES_DB}'" | grep -q 1; then
    "${APT_PREFIX[@]}" runuser -u postgres -- createdb -O "$POSTGRES_USER" "$POSTGRES_DB"
  fi
}

start_redis() {
  log "Starting Redis"
  if ! redis-cli ping >/dev/null 2>&1; then
    redis-server --daemonize yes
    sleep 2
  fi
  redis-cli ping
}

install_minio_if_needed() {
  log "Preparing local MinIO object storage"
  if ! command -v minio >/dev/null 2>&1; then
    curl -fsSL https://dl.min.io/server/minio/release/linux-amd64/minio -o /usr/local/bin/minio
    chmod +x /usr/local/bin/minio
  fi
  if ! command -v mc >/dev/null 2>&1; then
    curl -fsSL https://dl.min.io/client/mc/release/linux-amd64/mc -o /usr/local/bin/mc
    chmod +x /usr/local/bin/mc
  fi

  mkdir -p "$MINIO_DATA_DIR" "$LOG_DIR"
  pkill -f "minio server .*${MINIO_DATA_DIR}" 2>/dev/null || true
  MINIO_ROOT_USER="$MINIO_ROOT_USER" MINIO_ROOT_PASSWORD="$MINIO_ROOT_PASSWORD" \
    nohup minio server "$MINIO_DATA_DIR" --address 127.0.0.1:9000 --console-address 127.0.0.1:9001 \
      > "$LOG_DIR/minio.log" 2>&1 &

  for _ in {1..30}; do
    if curl -fsS http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done

  mc alias set drapixai-local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
  mc mb --ignore-existing "drapixai-local/${MINIO_BUCKET}" >/dev/null
}

write_api_env() {
  log "Writing API env for local RunPod SDK validation"
  local ai_token
  ai_token="$(grep '^DRAPIXAI_AI_SERVICE_TOKEN=' "$AI_ENV_FILE" | tail -n 1 | cut -d= -f2- || true)"
  if [[ -z "$ai_token" || "$ai_token" == replace-with-* ]]; then
    echo "Missing DRAPIXAI_AI_SERVICE_TOKEN in $AI_ENV_FILE. Run setup-fresh-runpod.sh first." >&2
    exit 1
  fi

  mkdir -p "$(dirname "$API_ENV_FILE")"
  cat > "$API_ENV_FILE" <<EOF
NODE_ENV=development
PORT=${API_PORT}
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}
REDIS_URL=redis://127.0.0.1:6379
JWT_SECRET=$(generate_secret)
DRAPIXAI_AI_URL=http://127.0.0.1:8080
DRAPIXAI_AI_SERVICE_TOKEN=${ai_token}
DRAPIXAI_CORS_ORIGINS=http://127.0.0.1:3000,http://localhost:3000,https://staging.drapixai.com
DRAPIXAI_TRUST_PROXY=1
DRAPIXAI_EXPOSE_READY_DETAILS=1
DRAPIXAI_MAX_UPLOAD_BYTES=10485760
DRAPIXAI_REQUIRE_GARMENT_CACHE=1
DRAPIXAI_SDK_PREFER_ORIGINAL_GARMENT_FOR_TRYON=0
DRAPIXAI_SDK_GENERATION_SOURCE=original_verified
DRAPIXAI_GARMENT_APPROVAL_REQUIRED=0
DRAPIXAI_GARMENT_CACHE_VERSION=v3-1024x1365
DRAPIXAI_GARMENT_TARGET_WIDTH=1024
DRAPIXAI_GARMENT_TARGET_HEIGHT=1365
DRAPIXAI_TARGET_TRYON_MS=12000
DRAPIXAI_ADMIN_TOKEN=$(generate_secret)
DRAPIXAI_ADMIN_EMAIL=admin@drapixai.local
DRAPIXAI_ADMIN_PASSWORD=ChangeMe123!
DRAPIXAI_ADMIN_USER_ID=0
DRAPIXAI_ENTERPRISE_QUOTA=100000
BILLING_UPGRADE_URL=https://drapixai.com/pricing
S3_BUCKET=${MINIO_BUCKET}
AWS_REGION=us-east-1
S3_ENDPOINT=http://127.0.0.1:9000
S3_FORCE_PATH_STYLE=1
AWS_ACCESS_KEY_ID=${MINIO_ROOT_USER}
AWS_SECRET_ACCESS_KEY=${MINIO_ROOT_PASSWORD}
SMTP_HOST=
SMTP_PORT=587
SMTP_SECURE=0
SMTP_USER=
SMTP_PASS=
SMTP_FROM=no-reply@drapixai.local
EOF
}

install_api_dependencies() {
  log "Installing and building DrapixAI API"
  cd "$APP_ROOT"
  npm --prefix apps/api install
  npm --prefix apps/api run prisma:generate
  npm --prefix apps/api run prisma:push
  npm --prefix apps/api run build
}

start_api() {
  log "Starting DrapixAI API on port $API_PORT"
  mkdir -p "$LOG_DIR"
  pkill -f "node .*apps/api/dist/server.js" 2>/dev/null || true
  (
    cd "$APP_ROOT/apps/api"
    nohup npm run start > "$LOG_DIR/api.log" 2>&1 &
  )

  for _ in {1..45}; do
    if curl -fsS "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1; then
      curl -fsS "http://127.0.0.1:${API_PORT}/ready" || true
      printf '\nAPI is running on http://127.0.0.1:%s\n' "$API_PORT"
      return
    fi
    sleep 2
  done

  echo "API did not become healthy. Last log lines:" >&2
  tail -n 160 "$LOG_DIR/api.log" >&2 || true
  exit 1
}

main() {
  cd "$APP_ROOT"
  install_system_packages
  install_node_if_needed
  start_postgres
  start_redis
  install_minio_if_needed
  write_api_env
  install_api_dependencies
  start_api

  cat <<EOF

============================================================
DrapixAI SDK/API stack is ready
============================================================

API:
  http://127.0.0.1:${API_PORT}

Storage:
  MinIO bucket ${MINIO_BUCKET} at http://127.0.0.1:9000

Logs:
  ${LOG_DIR}/api.log
  ${LOG_DIR}/minio.log

Run SDK smoke after placing person.jpg and garment.jpg in runtime/test_assets:
  cd ${APP_ROOT}
  bash deploy/runpod/run-launch-tryon-test.sh

EOF
}

main "$@"
