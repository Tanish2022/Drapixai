#!/bin/sh
# Redis credentials enter via a mounted file (preferred) or the existing env.
# They never enter redis-server/redis-cli argv. No application env is inherited.
set -eu
set +x
mode=${1:-}
if [ -n "${2:-}" ]; then password=$(cat "$2")
else password=${DRAPIXAI_REDIS_PASSWORD:-}; fi
case "$password" in ''|*[!A-Za-z0-9_-]*|replace-with*) echo REDIS_PRIVATE_SECRET_INVALID >&2; exit 2;; esac
[ "${#password}" -ge 32 ] && [ "${#password}" -le 256 ] || { echo REDIS_PRIVATE_SECRET_INVALID >&2; exit 2; }
umask 077
if [ "$mode" = health ]; then
  redis_cli=$(command -v redis-cli)
  result=$({ printf 'AUTH %s\nPING\n' "$password"; } | env -i "PATH=$PATH" REDISCLI_HISTFILE=/dev/null "$redis_cli" --raw 2>/dev/null) || exit 1
  # PING alone is insufficient: an accidentally unauthenticated Redis returns
  # PONG even after AUTH failed. Require both exact authenticated replies.
  [ "$result" = "$(printf 'OK\nPONG')" ]
  exit
fi
[ "$mode" = server ] || [ "$mode" = daemon ] || { echo REDIS_PRIVATE_MODE_INVALID >&2; exit 2; }
if [ "$mode" = daemon ]; then
  directory=${DRAPIXAI_REDIS_RUNTIME_DIR:?set private Redis runtime directory}
  [ ! -L "$directory" ] || exit 2
  if [ ! -d "$directory" ]; then mkdir -p "$directory"; chmod 700 "$directory"; fi
  [ "$(stat -c '%a' "$directory")" = 700 ] && [ "$(stat -c '%u' "$directory")" = "$(id -u)" ] || { echo REDIS_PRIVATE_DIRECTORY_REQUIRED >&2; exit 2; }
else directory=$(mktemp -d /tmp/drapixai-redis.XXXXXXXX); fi
config=$(mktemp "$directory/redis.conf.XXXXXXXX")
cleanup() { rm -f -- "$config"; if [ "$mode" = server ]; then rmdir -- "$directory"; fi; }
trap cleanup EXIT
printf 'save ""\nappendonly no\nprotected-mode yes\nrequirepass "%s"\n' "$password" > "$config"
chmod 600 "$config"
unset password DRAPIXAI_REDIS_PASSWORD REDISCLI_AUTH
redis_server=$(command -v redis-server)
if [ "$mode" = daemon ]; then
  env -i "PATH=$PATH" "$redis_server" "$config" --daemonize yes --bind 127.0.0.1 --dir "$directory" --dbfilename dump.rdb
else
  env -i "PATH=$PATH" "$redis_server" "$config" &
  child=$!
  trap 'kill -TERM "$child" 2>/dev/null || true' HUP INT TERM
  status=0; wait "$child" || status=$?
  exit "$status"
fi
