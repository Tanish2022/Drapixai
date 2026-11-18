#!/usr/bin/env bash
# Source only from the reviewed POSIX migration/restore wrappers. DATABASE_URL
# stays available to Prisma; native clients receive only an owner-only passfile.
set +x

drapixai_libpq_refuse() { echo 'PRIVATE_LIBPQ_CONFIGURATION_REFUSED' >&2; return 2; }
drapixai_decode_uri_field() {
  local value="$1" output='' char hex
  while [[ -n "$value" ]]; do
    if [[ "${value:0:1}" == '%' ]]; then
      hex="${value:1:2}"
      [[ "$hex" =~ ^[A-Fa-f0-9]{2}$ && "$hex" != '00' ]] || return 2
      printf -v char '%b' "\\x$hex"
      output+="$char"; value="${value:3}"
    else output+="${value:0:1}"; value="${value:1}"; fi
  done
  [[ "$output" != *$'\n'* && "$output" != *$'\r'* ]] || return 2
  printf '%s' "$output"
}
drapixai_pgpass_escape() {
  local value="$1"; value="${value//\\/\\\\}"; value="${value//:/\\:}"
  printf '%s' "$value"
}
drapixai_cleanup_libpq() {
  if [[ -n "${drapixai_libpq_directory:-}" && "$BASHPID" == "${drapixai_libpq_owner_pid:-}" ]]; then
    rm -f -- "$drapixai_libpq_directory/pgpass"
    rmdir -- "$drapixai_libpq_directory"
    unset drapixai_libpq_directory
  fi
}
drapixai_prepare_libpq() {
  [[ "$(uname -s)" == Linux ]] || { echo 'PRIVATE_LIBPQ_REQUIRES_LINUX' >&2; return 2; }
  local uri="${DATABASE_URL:-}" rest authority userinfo hostpart pathname query='' item key value password username host port=5432 database sslmode='' sslaccept=''
  [[ "$uri" == postgresql://* || "$uri" == postgres://* ]] || { drapixai_libpq_refuse; return 2; }
  [[ "$uri" != *'#'* && ! "$uri" =~ [[:space:]] ]] || { drapixai_libpq_refuse; return 2; }
  rest="${uri#*://}"; authority="${rest%%/*}"; pathname="${rest#*/}"
  [[ "$rest" != "$pathname" && "$authority" == *@* ]] || { drapixai_libpq_refuse; return 2; }
  userinfo="${authority%@*}"; hostpart="${authority##*@}"
  username="$(drapixai_decode_uri_field "${userinfo%%:*}")" || return 2
  if [[ "$userinfo" == *:* ]]; then password="$(drapixai_decode_uri_field "${userinfo#*:}")" || return 2
  else password="${PGPASSWORD:-}"; fi
  [[ "$password" != *$'\n'* && "$password" != *$'\r'* ]] || { drapixai_libpq_refuse; return 2; }
  if [[ "$hostpart" == '['* ]]; then
    host="${hostpart#\[}"; host="${host%%\]*}"
    [[ "$host" =~ ^[A-Fa-f0-9:]+$ && "$hostpart" == "[$host]"* ]] || { drapixai_libpq_refuse; return 2; }
    rest="${hostpart#*\]}"; [[ -z "$rest" || "$rest" == :* ]] || { drapixai_libpq_refuse; return 2; }
    [[ -z "$rest" ]] || port="${rest#:}"
  else
    host="${hostpart%%:*}"; [[ "$hostpart" != *:* ]] || port="${hostpart#*:}"
    [[ "$host" =~ ^[A-Za-z0-9.-]+$ ]] || { drapixai_libpq_refuse; return 2; }
  fi
  [[ "$port" =~ ^[0-9]{1,5}$ ]] && ((10#$port > 0 && 10#$port <= 65535)) || { drapixai_libpq_refuse; return 2; }
  [[ "$pathname" != *'?'* ]] || query="${pathname#*\?}"
  database="$(drapixai_decode_uri_field "${pathname%%\?*}")" || return 2
  [[ "$database" =~ ^[A-Za-z0-9_]{1,63}$ && "$username" =~ ^[A-Za-z0-9_.-]{1,63}$ ]] || { drapixai_libpq_refuse; return 2; }
  drapixai_libpq_options=(PGCONNECT_TIMEOUT=15 PGSSLMINPROTOCOLVERSION=TLSv1.2)
  local seen='|'
  while [[ -n "$query" ]]; do
    item="${query%%&*}"; if [[ "$query" == *'&'* ]]; then query="${query#*&}"; else query=''; fi
    [[ "$item" == *=* ]] || { drapixai_libpq_refuse; return 2; }
    key="${item%%=*}"; value="$(drapixai_decode_uri_field "${item#*=}")" || return 2
    [[ "$seen" != *"|$key|"* ]] || { drapixai_libpq_refuse; return 2; }; seen+="$key|"
    case "$key" in
      sslmode) sslmode="$value";;
      sslaccept) sslaccept="$value";;
      sslrootcert) drapixai_libpq_options+=("PGSSLROOTCERT=$value");;
      sslcert) drapixai_libpq_options+=("PGSSLCERT=$value");;
      sslkey) drapixai_libpq_options+=("PGSSLKEY=$value");;
      sslcrl) drapixai_libpq_options+=("PGSSLCRL=$value");;
      channel_binding) [[ "$value" == require || "$value" == prefer || "$value" == disable ]] || { drapixai_libpq_refuse; return 2; }; drapixai_libpq_options+=("PGCHANNELBINDING=$value");;
      connect_timeout) [[ "$value" =~ ^[0-9]{1,2}$ && "$value" -gt 0 && "$value" -le 60 ]] || { drapixai_libpq_refuse; return 2; }; drapixai_libpq_options+=("PGCONNECT_TIMEOUT=$value");;
      schema) [[ "$value" == public ]] || { drapixai_libpq_refuse; return 2; };;
      connection_limit|pool_timeout|socket_timeout) [[ "$value" =~ ^[0-9]+$ ]] || { drapixai_libpq_refuse; return 2; };;
      pgbouncer) [[ "$value" == true || "$value" == false ]] || { drapixai_libpq_refuse; return 2; };;
      *) drapixai_libpq_refuse; return 2;;
    esac
  done
  # Native Prisma's require+strict maps to libpq verify-full; never weaken
  # certificate/hostname checks when converting between connector options.
  [[ -z "$sslaccept" || "$sslaccept" == strict ]] || { drapixai_libpq_refuse; return 2; }
  [[ -z "$sslaccept" || "$sslmode" == require || "$sslmode" == verify-full ]] || { drapixai_libpq_refuse; return 2; }
  if [[ "$sslaccept" == strict && "$sslmode" == require ]]; then sslmode=verify-full; fi
  if [[ "${DRAPIXAI_DEPLOY_ENV:-}" == sandbox && ( "$host" == localhost || "$host" == 127.0.0.1 || "$host" == ::1 ) ]]; then
    [[ -n "$sslmode" ]] || sslmode=disable
    [[ "$sslmode" == disable || "$sslmode" == verify-full ]] || { drapixai_libpq_refuse; return 2; }
  else [[ "$sslmode" == verify-full ]] || { drapixai_libpq_refuse; return 2; }; fi
  if [[ "$sslmode" == verify-full && "$seen" != *'|sslrootcert|'* ]]; then
    # libpq 16+ can use the OS trust store without a user's ~/.postgresql file.
    drapixai_libpq_options+=(PGSSLROOTCERT=system)
  fi
  drapixai_libpq_directory="$(mktemp -d "${TMPDIR:-/tmp}/drapixai-libpq.XXXXXXXX")"
  drapixai_libpq_owner_pid="$BASHPID"
  chmod 700 "$drapixai_libpq_directory"
  trap drapixai_cleanup_libpq EXIT
  trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
  (set -o noclobber; printf '%s:%s:%s:%s:%s\n' "$(drapixai_pgpass_escape "$host")" "$port" "$(drapixai_pgpass_escape "$database")" "$(drapixai_pgpass_escape "$username")" "$(drapixai_pgpass_escape "$password")" > "$drapixai_libpq_directory/pgpass")
  chmod 600 "$drapixai_libpq_directory/pgpass"
  [[ "$(stat -c '%a' "$drapixai_libpq_directory")" == 700 && "$(stat -c '%a' "$drapixai_libpq_directory/pgpass")" == 600 && "$(stat -c '%u' "$drapixai_libpq_directory/pgpass")" == "$(id -u)" ]] || { drapixai_libpq_refuse; return 2; }
  drapixai_libpq_options+=("PGHOST=$host" "PGPORT=$port" "PGUSER=$username" "PGDATABASE=$database" "PGSSLMODE=$sslmode" "PGPASSFILE=$drapixai_libpq_directory/pgpass")
  drapixai_libpq_database="$database"
  unset password userinfo uri
}
drapixai_private_pg() {
  local command="$1" arg; shift
  [[ "$command" == psql || "$command" == pg_dump || "$command" == pg_restore ]] || return 2
  for arg in "$@"; do
    case "$arg" in -d|-h|-p|-U|--dbname*|--host*|--port*|--username*) drapixai_libpq_refuse; return 2;; esac
  done
  # env itself carries only credential-free fields and the private filename.
  if [[ "$command" == pg_restore && " $* " != *' --list '* && " $* " != *' -l '* ]]; then
    env -i "PATH=$PATH" LANG=C LC_ALL=C "${drapixai_libpq_options[@]}" "$command" --dbname="$drapixai_libpq_database" "$@"
    return
  fi
  env -i "PATH=$PATH" LANG=C LC_ALL=C "${drapixai_libpq_options[@]}" "$command" "$@"
}
