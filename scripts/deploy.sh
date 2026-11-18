#!/usr/bin/env bash
# ControlSphere – safe deploy for the native (systemd) installation.
#
# Builds into server/.next-staging while the service keeps serving the current
# build, then stops the service, swaps the build directories, starts the
# service again and waits for a health check. If the check fails, the previous
# build is restored automatically.
#
# Requirements (once, as root – see docs / setup-server.sh):
#   /etc/sudoers.d/controlsphere:
#   tim ALL=(root) NOPASSWD: /usr/bin/systemctl start controlsphere.service, \
#     /usr/bin/systemctl stop controlsphere.service, \
#     /usr/bin/systemctl restart controlsphere.service, \
#     /usr/bin/systemctl start controlsphere-update.service
#
# Usage: scripts/deploy.sh [--build-only] [--install] [--skip-migrate]
#                          [--rollback] [--health-timeout SECONDS]
#   --build-only      build into .next-staging only, do not touch the service
#   --install         force `npm ci --include=dev` (default: only when
#                     package-lock.json changed since the last deploy)
#   --skip-migrate    do not run `prisma migrate deploy`
#   --rollback        swap .next-prev back into place and restart
#
# Notes:
#   * Migrations run BEFORE the service is stopped, so they must be additive
#     (old code must keep working against the new schema).
#   * Rollback only restores the Next.js build (.next). Server-side code under
#     src/ is loaded from the working tree at start; if that is broken, check
#     out the last good commit printed by this script and run it again.

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
SERVER_DIR="$REPO_DIR/server"

SERVICE="${CS_SERVICE:-controlsphere.service}"
HEALTH_URL="${CS_HEALTH_URL:-http://127.0.0.1:3000/api/auth/status}"
HEALTH_TIMEOUT="${CS_HEALTH_TIMEOUT:-180}"
SYSTEMCTL=/usr/bin/systemctl

STAGING=".next-staging"
CURRENT=".next"
PREV=".next-prev"
FAILED=".next-failed"
LOCK_STAMP="node_modules/.cs-deploy-lock.sha256"
LAST_GOOD="$SERVER_DIR/.deploy-last-good"

BUILD_ONLY=false
FORCE_INSTALL=false
SKIP_MIGRATE=false
ROLLBACK=false

while [ $# -gt 0 ]; do
  case "$1" in
    --build-only)     BUILD_ONLY=true ;;
    --install)        FORCE_INSTALL=true ;;
    --skip-migrate)   SKIP_MIGRATE=true ;;
    --rollback)       ROLLBACK=true ;;
    --health-timeout) shift; HEALTH_TIMEOUT="${1:?missing value}" ;;
    -h|--help)        sed -n '2,30p' "$0"; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 2 ;;
  esac
  shift
done

log()  { printf '[deploy %s] %s\n' "$(date +%H:%M:%S)" "$*"; }
fail() { log "ERROR: $*"; exit 1; }

cd "$SERVER_DIR"

# ── single instance ──────────────────────────────────────────────────────
exec 9>"$SERVER_DIR/.deploy.lock"
flock -n 9 || fail "another deploy is running"

# ── helpers ──────────────────────────────────────────────────────────────
svc() {
  # Only the exact commands from the sudoers rule are used.
  sudo -n "$SYSTEMCTL" "$1" "$SERVICE"
}

check_sudo() {
  local action
  for action in stop start; do
    sudo -n -l "$SYSTEMCTL" "$action" "$SERVICE" >/dev/null 2>&1 || \
      fail "passwordless sudo for '$SYSTEMCTL $action $SERVICE' is missing (see header of $0)"
  done
}

wait_healthy() {
  local deadline=$(( $(date +%s) + HEALTH_TIMEOUT ))
  while [ "$(date +%s)" -lt "$deadline" ]; do
    if curl -fsS -o /dev/null --max-time 5 "$HEALTH_URL" 2>/dev/null; then
      return 0
    fi
    # A crashing service is restarted by systemd (Restart=always); keep
    # polling until the deadline.
    sleep 2
  done
  return 1
}

# The running server has the Prisma query engine (.so.node) mmapped.
# `prisma generate` overwrites it in place (O_TRUNC), which can crash the
# running process (SIGBUS). Give each engine file a fresh inode first; the
# running process keeps the old, now unlinked one.
detach_prisma_engines() {
  local f
  for f in node_modules/.prisma/client/*.so.node; do
    [ -f "$f" ] || continue
    cp -p "$f" "$f.cs-tmp" && mv -f "$f.cs-tmp" "$f"
  done
}

swap_in() {   # $1 = dir to activate, current .next goes to $2
  local new="$1" old_target="$2"
  rm -rf "$old_target"
  if [ -d "$CURRENT" ]; then mv "$CURRENT" "$old_target"; fi
  mv "$new" "$CURRENT"
}

start_and_check() {
  log "starting $SERVICE"
  svc start
  log "waiting for health check ($HEALTH_URL, max ${HEALTH_TIMEOUT}s)"
  wait_healthy
}

# ── rollback mode ────────────────────────────────────────────────────────
if $ROLLBACK; then
  [ -d "$PREV" ] || fail "no $PREV to roll back to"
  check_sudo
  log "rolling back to $PREV"
  svc stop
  swap_in "$PREV" "$FAILED"
  if start_and_check; then
    log "rollback OK"
    exit 0
  fi
  fail "service not healthy after rollback – check 'systemctl status $SERVICE'"
fi

# ── preflight ────────────────────────────────────────────────────────────
$BUILD_ONLY || check_sudo
command -v flock >/dev/null || fail "flock missing"

HEAD_SHA="$(git -C "$REPO_DIR" rev-parse --short HEAD)"
log "deploying $(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD)@$HEAD_SHA"
if [ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]; then
  log "WARNING: working tree has uncommitted changes – they will be deployed"
fi

# ── dependencies ─────────────────────────────────────────────────────────
LOCK_HASH="$(sha256sum package-lock.json | cut -d' ' -f1)"
if $FORCE_INSTALL || { [ -f "$LOCK_STAMP" ] && [ "$(cat "$LOCK_STAMP")" != "$LOCK_HASH" ]; }; then
  log "package-lock.json changed → npm ci --include=dev"
  detach_prisma_engines
  npm ci --include=dev --no-audit --no-fund
  echo "$LOCK_HASH" > "$LOCK_STAMP"
elif [ ! -f "$LOCK_STAMP" ]; then
  # First run: the installed node_modules is what the service runs on.
  log "no install stamp yet – assuming node_modules matches package-lock.json"
  echo "$LOCK_HASH" > "$LOCK_STAMP"
fi

# ── migrations (additive only) ───────────────────────────────────────────
if ! $SKIP_MIGRATE; then
  log "prisma migrate deploy"
  npx --no-install prisma migrate deploy
fi

# ── build into staging ───────────────────────────────────────────────────
log "building into $STAGING"
rm -rf "$STAGING"
detach_prisma_engines
BUILD_SHA="$HEAD_SHA" NEXT_DIST_DIR="$STAGING" npm run build
[ -f "$STAGING/BUILD_ID" ] || fail "build produced no $STAGING/BUILD_ID"
log "build OK ($(cat "$STAGING/BUILD_ID"))"

if $BUILD_ONLY; then
  log "--build-only: leaving $STAGING in place, service untouched"
  exit 0
fi

# ── swap + restart ───────────────────────────────────────────────────────
log "stopping $SERVICE"
svc stop
swap_in "$STAGING" "$PREV"

if start_and_check; then
  git -C "$REPO_DIR" rev-parse HEAD > "$LAST_GOOD"
  log "deploy OK – $HEAD_SHA is live (previous build kept in $PREV)"
  exit 0
fi

# ── automatic rollback ───────────────────────────────────────────────────
log "health check FAILED – rolling back to previous build"
svc stop || true
if [ -d "$PREV" ]; then
  swap_in "$PREV" "$FAILED"
  if start_and_check; then
    log "rollback OK – previous build is live again; failed build kept in $FAILED"
  else
    log "service still unhealthy after rollback"
  fi
fi
if [ -f "$LAST_GOOD" ]; then
  log "last known good commit: $(cat "$LAST_GOOD")"
fi
fail "deploy of $HEAD_SHA failed"
