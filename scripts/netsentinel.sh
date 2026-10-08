#!/usr/bin/env bash
# NetSentinel helper for macOS / Linux (Docker). Same commands as NetSentinel.bat on Windows:
#   ./scripts/netsentinel.sh start | stop | update | status | logs | backup | restore [file] | open
set -uo pipefail
cd "$(dirname "$0")/.."

APP_URL="http://localhost:5173"
READY_URL="http://localhost:8000/api/health/ready"
BACKUP_DIR="backups"
KEEP=10

ok()   { printf '  \033[32m[ok]\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m[!]\033[0m %s\n' "$*"; }
fail() { printf '  \033[31m[x]\033[0m %s\n' "$*"; }

env_value() { # name default
  local v=""
  [ -f .env ] && v=$(grep -E "^\s*$1\s*=" .env | tail -1 | sed -E 's/^[^=]*=\s*([^#[:space:]]*).*/\1/')
  echo "${v:-$2}"
}

need_docker() {
  command -v docker >/dev/null || { fail "Docker isn't installed."; exit 1; }
  docker info >/dev/null 2>&1 || { fail "Docker isn't running. Start Docker and try again."; exit 1; }
}

ensure_env() { [ -f .env ] || { cp .env.example .env; ok "Created .env from .env.example"; }; }

open_url() { (command -v xdg-open >/dev/null && xdg-open "$1") || (command -v open >/dev/null && open "$1") || echo "  Open $1 in your browser."; }

wait_ready() {
  echo "  Waiting for NetSentinel to be ready..."
  for _ in $(seq 1 60); do
    if curl -fsS "$READY_URL" >/dev/null 2>&1; then ok "Backend is ready"; return 0; fi
    sleep 3; printf '.'
  done
  echo; warn "Not ready after 3 minutes. Run './scripts/netsentinel.sh logs' to see why."; return 1
}

do_backup() {
  need_docker
  local user db name
  user=$(env_value POSTGRES_USER netsentinel); db=$(env_value POSTGRES_DB netsentinel)
  docker compose ps --status running --services 2>/dev/null | grep -qx db || { docker compose up -d db; sleep 5; }
  mkdir -p "$BACKUP_DIR"
  name="netsentinel-$(date +%Y%m%d-%H%M%S).dump"
  docker compose exec -T db pg_dump -U "$user" -d "$db" -Fc -f /tmp/netsentinel.dump || { fail "Backup failed"; exit 1; }
  docker compose cp db:/tmp/netsentinel.dump "$BACKUP_DIR/$name" && docker compose exec -T db rm -f /tmp/netsentinel.dump
  ok "Saved $BACKUP_DIR/$name"
  ls -1t "$BACKUP_DIR"/netsentinel-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f
}

do_restore() {
  need_docker
  local user db file
  user=$(env_value POSTGRES_USER netsentinel); db=$(env_value POSTGRES_DB netsentinel)
  file="${1:-$(ls -1t "$BACKUP_DIR"/netsentinel-*.dump 2>/dev/null | head -1)}"
  [ -n "$file" ] && [ -f "$file" ] || { fail "No backup found."; exit 1; }
  warn "This replaces everything in the database with $file."
  read -r -p "  Type YES to continue: " answer
  [ "$answer" = "YES" ] || { echo "  Cancelled."; return; }
  docker compose up -d db && sleep 3
  docker compose stop backend
  docker compose cp "$file" db:/tmp/restore.dump
  docker compose exec -T db pg_restore --clean --if-exists --no-owner -U "$user" -d "$db" /tmp/restore.dump
  docker compose exec -T db rm -f /tmp/restore.dump
  docker compose up -d && wait_ready && ok "Database restored"
}

case "${1:-}" in
  start)  need_docker; ensure_env; docker compose up -d --build && wait_ready && open_url "$APP_URL" ;;
  stop)   need_docker; docker compose down && ok "Stopped (data kept)" ;;
  update)
    need_docker; ensure_env
    docker compose ps --status running --services 2>/dev/null | grep -qx db && do_backup
    if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
      fail "Local changes found, update not applied:"; git status --short --untracked-files=no; exit 1
    fi
    git pull --ff-only || { fail "git pull failed"; exit 1; }
    docker compose down && docker compose build --pull && docker compose up -d && wait_ready && open_url "$APP_URL" ;;
  status)
    need_docker; docker compose ps; echo
    curl -fsS "$READY_URL" && echo && ok "Ready" || fail "Backend isn't answering at $READY_URL" ;;
  logs)    need_docker; docker compose logs -f --tail 100 backend ;;
  backup)  do_backup ;;
  restore) do_restore "${2:-}" ;;
  open)    open_url "$APP_URL" ;;
  *) echo "Usage: $0 start | stop | update | status | logs | backup | restore [file] | open"; exit 1 ;;
esac
